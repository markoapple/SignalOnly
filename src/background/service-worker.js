const SETTINGS_KEY = "signalonly.settings";
const COOKIE_JAR_KEY = "signalonly.cookieJars";
const RELOAD_REQUIRED_KEY = "signalonly.reloadRequired";
const SCHEMA_VERSION = 6;

const HEADER_RULE_ID_BASE = 7100;
const PER_SITE_HEADER_RULE_ID_BASE = 7200;
const PER_SITE_HEADER_RULE_ID_MAX = 7999;
const THIRD_PARTY_RULE_ID = 7101;
const ETAG_RULE_ID = 7102;
const EXCLUDED_INITIATOR_ALLOW_RULE_ID = 7103;
const EXCLUDED_REQUEST_ALLOW_RULE_ID = 7104;
const GLOBAL_HEADER_RULE_ID = 7105;
const PII_REFERER_RULE_ID = 7106;
const RESERVED_DYNAMIC_RULE_IDS = [
  THIRD_PARTY_RULE_ID,
  ETAG_RULE_ID,
  EXCLUDED_INITIATOR_ALLOW_RULE_ID,
  EXCLUDED_REQUEST_ALLOW_RULE_ID,
  GLOBAL_HEADER_RULE_ID,
  PII_REFERER_RULE_ID
];

const COOKIE_SWEEP_ALARM = "signalonly:cookie-sweep";
const COOKIE_SWEEP_PERIOD_MIN = 30;

const RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];

const ACCENTS = ["#ff006e", "#0057ff", "#00c2d1", "#ff4b1f"];
const PROFILE_NAMES = ["Standard", "Strict", "Travel", "Accounts"];

const DEFAULT_EXCLUDED_HOSTS = [
  "accounts.google.com", "myaccount.google.com", "oauth2.googleapis.com",
  "accounts.youtube.com", "pay.google.com",
  "appleid.apple.com", "idmsa.apple.com",
  "login.microsoftonline.com", "login.live.com", "login.microsoft.com",
  "login.yahoo.com", "github.com", "id.atlassian.com", "auth.openai.com",
  "auth0.com", "okta.com", "duosecurity.com",
  "checkout.stripe.com", "js.stripe.com", "paypal.com", "www.paypal.com"
];

const DEFAULT_SITE_MODULES = Object.freeze({
  fingerprint: true,
  storage: false,
  sensors: true,
  behavior: false,
  piiShield: false,
  blockServiceWorkers: false,
  cleanup: {
    recommendations: true,
    comments: true,
    metrics: true,
    overlays: true,
    sticky: false,
    motion: true
  }
});

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  proxyEnabled: false,
  proxyHost: "127.0.0.1",
  proxyPort: 9150,
  privacyControls: true,
  webRtcMode: "soft",
  networkHeaders: true,
  spoofUserAgentHeader: false,
  thirdPartyIsolation: false,
  blockTrackingHeaders: true,
  fingerprintShield: true,
  storageShield: false,
  sensorShield: true,
  piiShield: false,
  behaviorNoise: false,
  blockServiceWorkers: false,
  applyShieldsGlobally: false,
  blockTopics: true,
  blockAutofill: false,
  blockReferrers: false,
  cookieExpiryCapDays: 7,
  autoClearOnSwitch: true,
  activeProfileId: "",
  profiles: [],
  siteAssignments: {},
  excludedHosts: [],
  excludedHostsSeeded: false,
  lastProxyMode: "disabled"
};

const USER_AGENT_PRESETS = [
  { label: "Chrome Windows", platform: "Win32", uaPlatform: "Windows NT 10.0; Win64; x64", uaPlatformBrand: "Windows",
    language: "en-US", languages: ["en-US","en"], timezone: "America/New_York", timezoneOffset: 240,
    cores: [4,6,8,12], memory: [4,8,16], touch: [0],
    sizes: [[1366,768],[1536,864],[1600,900],[1920,1080]], ratios: [1,1.25,1.5],
    webgl: [["Google Inc. (Intel)","ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"],
            ["Google Inc. (AMD)","ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"]] },
  { label: "Chrome macOS", platform: "MacIntel", uaPlatform: "Macintosh; Intel Mac OS X 10_15_7", uaPlatformBrand: "macOS",
    language: "en-GB", languages: ["en-GB","en"], timezone: "Europe/London", timezoneOffset: -60,
    cores: [8,10], memory: [8,16], touch: [0],
    sizes: [[1440,900],[1512,982],[1728,1117]], ratios: [2],
    webgl: [["Google Inc. (Apple)","ANGLE (Apple, Apple M-Series, Metal)"]] },
  { label: "Chrome Linux", platform: "Linux x86_64", uaPlatform: "X11; Linux x86_64", uaPlatformBrand: "Linux",
    language: "en-US", languages: ["en-US","en"], timezone: "UTC", timezoneOffset: 0,
    cores: [4,6,8], memory: [4,8], touch: [0],
    sizes: [[1366,768],[1600,900],[1920,1080]], ratios: [1],
    webgl: [["Google Inc. (Mesa)","ANGLE (Mesa, llvmpipe, OpenGL)"]] }
];

let settingsCache = null;
let staticRuleCountCache = null;
const tabHostMap = new Map();
const reloadRequiredTabs = new Set();

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COOKIE_SWEEP_ALARM) void periodicCookieSweep();
});

chrome.tabs.onActivated.addListener(({ tabId }) => void updateBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    const host = getHost(tab?.url);
    if (host) {
      tabHostMap.set(tabId, host);
      // Persist so handleTabClose works after a service-worker restart.
      void chrome.storage.session?.set?.({ [`tabHost:${tabId}`]: host }).catch(() => {});
    }
  }
  if (changeInfo.status === "complete") {
    void clearReloadRequired(tabId);
    void updateBadgeForTab(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearReloadRequired(tabId);
  void handleTabClose(tabId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) settingsCache = null;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

void boot();

async function boot() {
  await ensureSettings();
  await hydrateReloadRequiredTabs();
  await applyControls();
  await updateDynamicRules();
  await ensureCookieSweepAlarm();
  await chrome.action.setBadgeBackgroundColor({ color: "#ff006e" }).catch(() => {});
  await updateActiveBadge();
}

async function ensureCookieSweepAlarm() {
  const existing = await chrome.alarms.get(COOKIE_SWEEP_ALARM).catch(() => null);
  if (!existing) {
    await chrome.alarms.create(COOKIE_SWEEP_ALARM, { periodInMinutes: COOKIE_SWEEP_PERIOD_MIN, delayInMinutes: 1 }).catch(() => {});
  }
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "getState": return { ok: true, ...(await getState(message.url)) };
    case "saveSettings": return saveSettings(message.settings || {});
    case "getContentConfig": return getContentConfig(message.url || sender?.url);
    case "addExclusion": return addExclusion(message.host);
    case "removeExclusion": return removeExclusion(message.host);
    case "restoreDefaultExclusions": return restoreDefaultExclusions();
    case "applySiteProfile": return applySiteProfile(message.host, message.profileId, message.enabled, message.clearCookies, message.modules, message.cookiePolicy);
    case "updateSiteModules": return updateSiteModules(message.host, message.modules);
    case "resetSiteProfile": return resetSiteProfile(message.host);
    case "clearSiteCookies": return clearSiteCookiesForHost(message.host);
    case "injectShield": return injectShieldFromBackground(sender?.tab?.id, sender?.frameId, message.bootstrap);
    case "createProfile": return createProfileFromRequest(message);
    case "duplicateProfile": return duplicateProfile(message.profileId);
    case "regenerateProfile": return regenerateProfile(message.profileId);
    case "saveProfile": return saveProfile(message.profile);
    case "deleteProfile": return deleteProfile(message.profileId);
    case "getCookieJars": return getCookieJars();
    case "deleteCookieJar": return deleteCookieJar(message.host, message.profileId);
    case "signalReloadRequired": return signalReloadRequired(sender?.tab?.id);
    case "exportConfig": return exportConfig();
    case "importConfig": return importConfig(message.config);
    case "openOptions": await chrome.runtime.openOptionsPage(); return { ok: true };
    default: return { ok: false, error: "Unknown message" };
  }
}

async function getState(url = "") {
  const settings = await getSettings();
  const activeTab = url ? null : await getActiveTab();
  const tabId = activeTab?.id;
  const reloadRequired = tabId ? await isReloadRequired(tabId) : false;
  const host = getHost(url || activeTab?.url || "");
  const assignment = host ? getSiteAssignment(settings, host) : null;
  const currentProfile = getProfile(settings, assignment?.profileId || settings.activeProfileId);
  const telemetry = await getTelemetry(settings, host);
  return {
    settings,
    defaults: { excludedHosts: normalizeHostList(DEFAULT_EXCLUDED_HOSTS), siteModules: structuredClone(DEFAULT_SITE_MODULES) },
    telemetry,
    version: chrome.runtime.getManifest().version,
    context: {
      host,
      siteEnabled: Boolean(assignment?.enabled),
      assignment,
      effectiveModules: host ? effectiveSiteConfig(settings, host).modules : null,
      currentProfile,
      excluded: host ? isExcluded(host, settings) : false,
      defaultExcluded: host ? matchesDomainList(host, DEFAULT_EXCLUDED_HOSTS) : false,
      reloadRequired
    }
  };
}

async function signalReloadRequired(tabId) {
  if (tabId) {
    await markReloadRequired(tabId);
    await updateBadgeForTab(tabId);
  }
  return { ok: true };
}

async function hydrateReloadRequiredTabs() {
  if (!chrome.storage?.session) return;
  const data = await chrome.storage.session.get(RELOAD_REQUIRED_KEY).catch(() => ({}));
  const ids = Array.isArray(data[RELOAD_REQUIRED_KEY]) ? data[RELOAD_REQUIRED_KEY] : [];
  reloadRequiredTabs.clear();
  ids.forEach((id) => {
    const numericId = Number(id);
    if (Number.isInteger(numericId) && numericId > 0) reloadRequiredTabs.add(numericId);
  });
}

async function persistReloadRequiredTabs() {
  if (!chrome.storage?.session) return;
  await chrome.storage.session.set({ [RELOAD_REQUIRED_KEY]: [...reloadRequiredTabs] }).catch(() => {});
}

async function markReloadRequired(tabId) {
  const numericId = Number(tabId);
  if (!Number.isInteger(numericId) || numericId <= 0) return;
  reloadRequiredTabs.add(numericId);
  await persistReloadRequiredTabs();
}

async function clearReloadRequired(tabId) {
  const numericId = Number(tabId);
  if (!Number.isInteger(numericId) || numericId <= 0) return;
  if (reloadRequiredTabs.delete(numericId)) await persistReloadRequiredTabs();
}

async function isReloadRequired(tabId) {
  const numericId = Number(tabId);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  if (reloadRequiredTabs.has(numericId)) return true;
  await hydrateReloadRequiredTabs();
  return reloadRequiredTabs.has(numericId);
}

// Inject the page-world shield via chrome.scripting.executeScript, which
// bypasses page CSP. The shield is injected as a function with the bootstrap
// config baked in as args, so no <script src> is needed and CSP can't block us.
async function injectShieldFromBackground(tabId, frameId, bootstrap) {
  if (!chrome.scripting?.executeScript || typeof tabId !== "number") {
    return { ok: false, error: "scripting API unavailable" };
  }
  try {
    // First inject the shield file in MAIN world.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: typeof frameId === "number" ? [frameId] : undefined },
      files: ["src/injected/fingerprint.js"],
      world: "MAIN",
      injectImmediately: true
    });
    // Then push the bootstrap config to it via the same window-message bridge
    // the content script uses, but executed in MAIN world so it can't be
    // intercepted by isolated-world listeners.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: typeof frameId === "number" ? [frameId] : undefined },
      func: (cfg) => {
        try {
          window.postMessage({ __signalonly: true, type: "signalonly:configure", ...cfg }, "*");
        } catch {}
      },
      args: [bootstrap || {}],
      world: "MAIN"
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function addExclusion(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, error: "No valid host" };
  const settings = await getSettings();
  settings.excludedHosts = normalizeHostList([...(settings.excludedHosts || []), cleanHost]);
  settings.excludedHostsSeeded = true;
  await setSettings(settings);
  await applyControls();
  await updateDynamicRules();
  await notifyAllTabs();
  await updateActiveBadge();
  return { ok: true, host: cleanHost, ...(await getState(`https://${cleanHost}/`)) };
}

async function removeExclusion(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, error: "No valid host" };
  const settings = await getSettings();
  settings.excludedHosts = normalizeHostList(settings.excludedHosts || []).filter((entry) => entry !== cleanHost);
  settings.excludedHostsSeeded = true;
  await setSettings(settings);
  await applyControls();
  await updateDynamicRules();
  await notifyAllTabs();
  await updateActiveBadge();
  return { ok: true, host: cleanHost, ...(await getState(`https://${cleanHost}/`)) };
}

async function restoreDefaultExclusions() {
  const settings = await getSettings();
  settings.excludedHosts = normalizeHostList([...(settings.excludedHosts || []), ...DEFAULT_EXCLUDED_HOSTS]);
  settings.excludedHostsSeeded = true;
  await setSettings(settings);
  await applyControls();
  await updateDynamicRules();
  await notifyAllTabs();
  await updateActiveBadge();
  return { ok: true, ...(await getState()) };
}

async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...sanitizeSettingsPatch(patch) };
  if (!getProfile(settings, settings.activeProfileId)) {
    settings.activeProfileId = settings.profiles[0]?.id || "";
  }
  await setSettings(settings);
  await applyControls();
  await updateDynamicRules();
  await notifyAllTabs();
  await updateActiveBadge();
  return { ok: true, ...(await getState()) };
}

async function getContentConfig(url) {
  const settings = await getSettings();
  const host = getHost(url);
  const excluded = !host || isExcluded(host, settings);
  const assignment = host ? getSiteAssignment(settings, host) : null;
  const profile = getProfile(settings, assignment?.profileId || settings.activeProfileId);
  const siteEnabled = Boolean(assignment?.enabled);
  const effective = host ? effectiveSiteConfig(settings, host) : { modules: null, applyShields: false };

  const shieldsActive = Boolean(
    settings.enabled && !excluded && profile && (siteEnabled || settings.applyShieldsGlobally)
  );
  // Visual cleanup is independent of fingerprint shields. It only requires
  // the extension to be enabled, the host not excluded, the site assigned
  // and enabled, and a profile available for the site styling tokens.
  const cleanupEnabled = Boolean(
    settings.enabled && !excluded && profile && siteEnabled
  );

  return {
    ok: true,
    enabled: shieldsActive,
    host,
    settings: publicContentSettings(settings, effective.modules),
    // Profile is needed by the content script for both shields and visual cleanup tokens.
    profile: (shieldsActive || cleanupEnabled) ? profile : null,
    site: {
      enabled: siteEnabled,
      assignment,
      excluded,
      assigned: Boolean(assignment),
      modules: effective.modules,
      cleanupEnabled
    }
  };
}

function effectiveSiteConfig(settings, host) {
  const assignment = host ? getSiteAssignment(settings, host) : null;
  const baseModules = structuredClone(DEFAULT_SITE_MODULES);
  const globalDefaults = {
    fingerprint: settings.fingerprintShield,
    storage: settings.storageShield,
    sensors: settings.sensorShield,
    behavior: settings.behaviorNoise,
    piiShield: settings.piiShield,
    blockServiceWorkers: settings.blockServiceWorkers,
    cleanup: baseModules.cleanup
  };
  if (!assignment) {
    return { modules: globalDefaults, applyShields: settings.applyShieldsGlobally };
  }
  const overrides = assignment.modules || {};
  return {
    modules: {
      fingerprint: "fingerprint" in overrides ? Boolean(overrides.fingerprint) : globalDefaults.fingerprint,
      storage: "storage" in overrides ? Boolean(overrides.storage) : globalDefaults.storage,
      sensors: "sensors" in overrides ? Boolean(overrides.sensors) : globalDefaults.sensors,
      behavior: "behavior" in overrides ? Boolean(overrides.behavior) : globalDefaults.behavior,
      piiShield: "piiShield" in overrides ? Boolean(overrides.piiShield) : globalDefaults.piiShield,
      blockServiceWorkers: "blockServiceWorkers" in overrides ? Boolean(overrides.blockServiceWorkers) : globalDefaults.blockServiceWorkers,
      cleanup: { ...baseModules.cleanup, ...(overrides.cleanup || {}) }
    },
    applyShields: Boolean(assignment.enabled)
  };
}

async function applySiteProfile(host, profileId, enabled = true, clearCookies = false, modules = null, cookiePolicy = undefined) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, error: "No valid host" };
  const settings = await getSettings();
  if (isExcluded(cleanHost, settings)) {
    return { ok: false, error: "Host is excluded. Remove the exclusion before applying a site profile." };
  }
  const oldAssignment = settings.siteAssignments[cleanHost];
  const profile = getProfile(settings, profileId) || getProfile(settings, settings.activeProfileId) || settings.profiles[0];
  if (!profile) return { ok: false, error: "No profiles configured" };

  const profileChanged = oldAssignment && oldAssignment.profileId !== profile.id;
  const oldProfile = oldAssignment ? getProfile(settings, oldAssignment.profileId) : null;
  const oldPolicy = resolveCookiePolicy(oldAssignment, oldProfile);
  const assignmentPolicy = cookiePolicy === undefined
    ? oldAssignment?.cookiePolicy || ""
    : sanitizeAssignmentCookiePolicy(cookiePolicy);
  const newPolicy = resolveCookiePolicy({ cookiePolicy: assignmentPolicy }, profile);
  const policySaysClear = profileChanged && (oldPolicy === "clear-on-switch" || newPolicy === "clear-on-switch");
  const shouldClear = clearCookies || policySaysClear || (profileChanged && settings.autoClearOnSwitch);

  let jarSaved = 0;
  let jarRestored = 0;
  if (profileChanged && oldAssignment) {
    jarSaved = await saveCookieJar(cleanHost, oldAssignment.profileId);
  }

  settings.siteAssignments[cleanHost] = {
    enabled: Boolean(enabled),
    profileId: profile.id,
    cookiePolicy: assignmentPolicy,
    modules: sanitizeSiteModules(modules ?? oldAssignment?.modules ?? null),
    updatedAt: Date.now()
  };
  await setSettings(settings);

  let cookiesCleared = 0;
  if (profileChanged) {
    cookiesCleared = (await clearSiteCookiesForHost(cleanHost)).cleared || 0;
    jarRestored = await restoreCookieJar(cleanHost, profile.id);
  } else if (shouldClear) {
    cookiesCleared = (await clearSiteCookiesForHost(cleanHost)).cleared || 0;
  }

  await updateDynamicRules();
  await applyControls();
  await notifyHost(cleanHost);
  await updateActiveBadge();
  return { ok: true, cookiesCleared, jarSaved, jarRestored, ...(await getState(`https://${cleanHost}/`)) };
}

async function updateSiteModules(host, modules) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, error: "No valid host" };
  const settings = await getSettings();
  const assignment = settings.siteAssignments[cleanHost];
  if (!assignment) return { ok: false, error: "Site is not assigned" };
  assignment.modules = sanitizeSiteModules({ ...(assignment.modules || {}), ...(modules || {}) });
  assignment.updatedAt = Date.now();
  settings.siteAssignments[cleanHost] = assignment;
  await setSettings(settings);
  await updateDynamicRules();
  await notifyHost(cleanHost);
  await updateActiveBadge();
  return { ok: true, ...(await getState(`https://${cleanHost}/`)) };
}

async function clearSiteCookiesForHost(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, cleared: 0, error: "No valid host" };
  const settings = await getSettings();
  if (isExcluded(cleanHost, settings)) return { ok: false, cleared: 0, error: "Host is excluded" };
  let cleared = 0;
  try {
    const cookies = await chrome.cookies.getAll({ domain: cleanHost }).catch(() => []);
    await Promise.all(cookies.map(async (cookie) => {
      const scheme = cookie.secure ? "https" : "http";
      const domain = cookie.domain.replace(/^\./, "");
      const url = `${scheme}://${domain}${cookie.path || "/"}`;
      const removed = await chrome.cookies.remove({ url, name: cookie.name }).catch(() => null);
      if (removed) cleared += 1;
    }));
  } catch {}
  return { ok: true, cleared };
}

async function saveCookieJar(host, profileId) {
  if (!host || !profileId) return 0;
  try {
    const cookies = await chrome.cookies.getAll({ domain: host }).catch(() => []);
    const jars = await loadJars();
    jars[`${host}|${profileId}`] = {
      savedAt: Date.now(),
      cookies: cookies.map((c) => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || "unspecified",
        expirationDate: c.expirationDate, hostOnly: c.hostOnly, storeId: c.storeId
      }))
    };
    await chrome.storage.local.set({ [COOKIE_JAR_KEY]: jars });
    return cookies.length;
  } catch { return 0; }
}

async function restoreCookieJar(host, profileId) {
  if (!host || !profileId) return 0;
  try {
    const jars = await loadJars();
    const jar = jars[`${host}|${profileId}`];
    if (!jar?.cookies?.length) return 0;
    let restored = 0;
    for (const c of jar.cookies) {
      const scheme = c.secure ? "https" : "http";
      const domain = (c.domain || host).replace(/^\./, "");
      const url = `${scheme}://${domain}${c.path || "/"}`;
      const setArgs = {
        url, name: c.name, value: c.value, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly
      };
      // chrome.cookies.set rejects sameSite="unspecified" together with secure=false on some Chrome versions.
      // Only forward sameSite when explicitly set to a non-default value.
      if (c.sameSite && c.sameSite !== "unspecified") setArgs.sameSite = c.sameSite;
      if (!c.hostOnly && c.domain) setArgs.domain = c.domain;
      if (c.expirationDate && c.expirationDate * 1000 > Date.now()) setArgs.expirationDate = c.expirationDate;
      if (c.storeId) setArgs.storeId = c.storeId;
      const result = await chrome.cookies.set(setArgs).catch(() => null);
      if (result) restored += 1;
    }
    return restored;
  } catch { return 0; }
}

async function loadJars() {
  const data = await chrome.storage.local.get(COOKIE_JAR_KEY).catch(() => ({}));
  return data[COOKIE_JAR_KEY] && typeof data[COOKIE_JAR_KEY] === "object" ? data[COOKIE_JAR_KEY] : {};
}

async function getCookieJars() {
  const jars = await loadJars();
  const summary = Object.entries(jars).map(([key, jar]) => {
    const [host, profileId] = key.split("|");
    return { host, profileId, cookieCount: jar.cookies?.length || 0, savedAt: jar.savedAt };
  });
  return { ok: true, jars: summary };
}

async function deleteCookieJar(host, profileId) {
  const jars = await loadJars();
  const key = `${host}|${profileId}`;
  if (jars[key]) {
    delete jars[key];
    await chrome.storage.local.set({ [COOKIE_JAR_KEY]: jars });
  }
  return { ok: true };
}

async function resetSiteProfile(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) return { ok: false, error: "No valid host" };
  const settings = await getSettings();
  const assignment = settings.siteAssignments[cleanHost];
  if (assignment) {
    await saveCookieJar(cleanHost, assignment.profileId);
  }
  delete settings.siteAssignments[cleanHost];
  await setSettings(settings);
  await updateDynamicRules();
  await applyControls();
  await notifyHost(cleanHost);
  await updateActiveBadge();
  return { ok: true, ...(await getState(`https://${cleanHost}/`)) };
}

async function createProfileFromRequest(message) {
  const settings = await getSettings();
  const profile = createRandomProfile({
    name: message.name || `Profile ${settings.profiles.length + 1}`,
    code: `PR-${String(settings.profiles.length + 1).padStart(2, "0")}`,
    accent: ACCENTS[settings.profiles.length % ACCENTS.length]
  });
  settings.profiles.push(profile);
  settings.activeProfileId = profile.id;
  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function duplicateProfile(profileId) {
  const settings = await getSettings();
  const source = getProfile(settings, profileId);
  if (!source) return { ok: false, error: "Profile not found" };
  const copy = structuredClone(source);
  copy.id = createProfileId();
  copy.name = `${source.name} Copy`.slice(0, 32);
  copy.code = `PR-${String(settings.profiles.length + 1).padStart(2, "0")}`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  settings.profiles.push(copy);
  settings.activeProfileId = copy.id;
  await setSettings(settings);
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function regenerateProfile(profileId) {
  const settings = await getSettings();
  const index = settings.profiles.findIndex((p) => p.id === profileId);
  if (index < 0) return { ok: false, error: "Profile not found" };
  const old = settings.profiles[index];
  const regenerated = createRandomProfile({ name: old.name, code: old.code, accent: old.accent, defaultCleanup: old.defaultCleanup });
  settings.profiles[index] = {
    ...regenerated, id: old.id, cookiePolicy: old.cookiePolicy || regenerated.cookiePolicy,
    createdAt: old.createdAt, updatedAt: Date.now()
  };
  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function saveProfile(profile) {
  const settings = await getSettings();
  const clean = sanitizeProfile(profile, settings.profiles.length + 1);
  if (!clean) return { ok: false, error: "Invalid profile" };
  const index = settings.profiles.findIndex((item) => item.id === clean.id);
  if (index >= 0) {
    settings.profiles[index] = { ...settings.profiles[index], ...clean, updatedAt: Date.now() };
  } else {
    settings.profiles.push(clean);
  }
  settings.activeProfileId = clean.id;
  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function deleteProfile(profileId) {
  const settings = await getSettings();
  if (settings.profiles.length <= 1) return { ok: false, error: "At least one profile must remain" };
  const profile = getProfile(settings, profileId);
  if (!profile) return { ok: false, error: "Profile not found" };
  settings.profiles = settings.profiles.filter((item) => item.id !== profileId);
  deleteAssignmentsForProfile(settings, profileId);
  if (settings.activeProfileId === profileId) settings.activeProfileId = settings.profiles[0].id;
  const jars = await loadJars();
  for (const key of Object.keys(jars)) {
    if (key.endsWith(`|${profileId}`)) delete jars[key];
  }
  await chrome.storage.local.set({ [COOKIE_JAR_KEY]: jars });
  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function exportConfig() {
  const settings = await getSettings();
  const jars = await loadJars();
  return { ok: true, config: { exportedAt: new Date().toISOString(), version: SCHEMA_VERSION, settings, cookieJars: jars } };
}

async function importConfig(config) {
  let imported;
  try { imported = typeof config === "string" ? JSON.parse(config) : config; }
  catch { return { ok: false, error: "Invalid JSON" }; }
  const settings = normalizeSettings(imported?.settings || imported || {});
  await setSettings(settings);
  if (imported?.cookieJars && typeof imported.cookieJars === "object") {
    await chrome.storage.local.set({ [COOKIE_JAR_KEY]: imported.cookieJars });
  }
  await applyControls();
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function ensureSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = normalizeSettings(data[SETTINGS_KEY] || {});
  await setSettings(settings);
  return settings;
}

async function getSettings() {
  if (settingsCache) return structuredClone(settingsCache);
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  settingsCache = normalizeSettings(data[SETTINGS_KEY] || {});
  return structuredClone(settingsCache);
}

async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  settingsCache = settings;
}

function normalizeSettings(stored) {
  const migrated = migrateSettings(stored);
  const settings = { ...DEFAULT_SETTINGS, ...migrated };
  settings.profiles = normalizeProfiles(migrated.profiles);
  settings.siteAssignments = normalizeSiteAssignments(migrated.siteAssignments);
  settings.excludedHosts = normalizeHostList(migrated.excludedHosts);
  if (!settings.excludedHostsSeeded) {
    settings.excludedHosts = normalizeHostList([...settings.excludedHosts, ...DEFAULT_EXCLUDED_HOSTS]);
    settings.excludedHostsSeeded = true;
  }
  if (!settings.profiles.length) {
    settings.profiles = PROFILE_NAMES.map((name, index) => createRandomProfile({
      name, code: `PR-${String(index + 1).padStart(2, "0")}`, accent: ACCENTS[index % ACCENTS.length]
    }));
  }
  if (!getProfile(settings, settings.activeProfileId)) settings.activeProfileId = settings.profiles[0].id;
  settings.schemaVersion = SCHEMA_VERSION;
  return settings;
}

function migrateSettings(stored) {
  let next = stored && typeof stored === "object" ? { ...stored } : {};
  if (!Array.isArray(next.profiles) && Array.isArray(next.focusProfiles)) {
    const profiles = next.focusProfiles.map((legacy, index) => createRandomProfile({
      name: legacy.name || PROFILE_NAMES[index] || `Profile ${index + 1}`,
      code: legacy.code || `PR-${String(index + 1).padStart(2, "0")}`,
      accent: legacy.accent || ACCENTS[index % ACCENTS.length],
      defaultCleanup: legacy.modules
    }));
    const idMap = new Map();
    next.focusProfiles.forEach((legacy, index) => idMap.set(legacy.id, profiles[index]?.id));
    const siteAssignments = {};
    for (const [host, assignment] of Object.entries(next.siteAssignments || {})) {
      siteAssignments[host] = { ...assignment, profileId: idMap.get(assignment.profileId) || profiles[0]?.id };
    }
    next = { ...next, profiles, activeProfileId: idMap.get(next.activeFocusProfileId) || profiles[0]?.id || "", siteAssignments };
  }
  if ((next.schemaVersion || 0) < 2) {
    if ("torEnabled" in next && !("proxyEnabled" in next)) next.proxyEnabled = Boolean(next.torEnabled);
    if ("torHost" in next && !("proxyHost" in next)) next.proxyHost = next.torHost;
    if ("torPort" in next && !("proxyPort" in next)) next.proxyPort = next.torPort;
    if (!("storageShield" in next)) next.storageShield = false;
    if (!("piiShield" in next)) next.piiShield = false;
    if (!("behaviorNoise" in next)) next.behaviorNoise = false;
    if (!("thirdPartyIsolation" in next)) next.thirdPartyIsolation = false;
    if (!("spoofUserAgentHeader" in next)) next.spoofUserAgentHeader = false;
    if (!("blockServiceWorkers" in next)) next.blockServiceWorkers = false;
    if (!("applyShieldsGlobally" in next)) next.applyShieldsGlobally = false;
    if (!("webRtcMode" in next)) next.webRtcMode = "soft";
  }
  if ((next.schemaVersion || 0) < 3) {
    if (!("cookieExpiryCapDays" in next)) next.cookieExpiryCapDays = 7;
    if (!("autoClearOnSwitch" in next)) next.autoClearOnSwitch = true;
    if (Array.isArray(next.profiles)) next.profiles.forEach((p) => { if (!p.cookiePolicy) p.cookiePolicy = "keep"; });
  }
  if ((next.schemaVersion || 0) < 4) {
    if ((next.proxyHost || DEFAULT_SETTINGS.proxyHost) === "127.0.0.1" && Number(next.proxyPort || 9050) === 9050) next.proxyPort = 9150;
  }
  if ((next.schemaVersion || 0) < 5) {
    if (next.siteAssignments && typeof next.siteAssignments === "object") {
      for (const [host, assignment] of Object.entries(next.siteAssignments)) {
        if (!assignment || typeof assignment !== "object") continue;
        if (!("modules" in assignment) || !assignment.modules || typeof assignment.modules !== "object") {
          assignment.modules = structuredClone(DEFAULT_SITE_MODULES);
        }
        if (!("cookiePolicy" in assignment)) assignment.cookiePolicy = "keep";
        next.siteAssignments[host] = assignment;
      }
    }
  }
  if ((next.schemaVersion || 0) < 6) {
    // Rename profile.modules (cleanup tokens) -> profile.defaultCleanup so it
    // doesn't share a name with siteAssignment.modules (full module set).
    if (Array.isArray(next.profiles)) {
      next.profiles = next.profiles.map((profile) => {
        if (!profile || typeof profile !== "object") return profile;
        const copy = { ...profile };
        if (!("defaultCleanup" in copy) && copy.modules && typeof copy.modules === "object") {
          copy.defaultCleanup = copy.modules;
        }
        delete copy.modules;
        return copy;
      });
    }
  }
  return next;
}

function sanitizeSettingsPatch(patch) {
  const clean = {};
  const booleanKeys = [
    "enabled","proxyEnabled","privacyControls","fingerprintShield","storageShield","sensorShield",
    "piiShield","behaviorNoise","networkHeaders","spoofUserAgentHeader","thirdPartyIsolation",
    "blockTrackingHeaders","blockServiceWorkers","applyShieldsGlobally","blockTopics",
    "blockAutofill","blockReferrers","autoClearOnSwitch"
  ];
  for (const key of booleanKeys) if (key in patch) clean[key] = Boolean(patch[key]);
  if ("proxyHost" in patch) clean.proxyHost = String(patch.proxyHost || DEFAULT_SETTINGS.proxyHost).trim() || DEFAULT_SETTINGS.proxyHost;
  if ("proxyPort" in patch) {
    const port = Number(patch.proxyPort);
    clean.proxyPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SETTINGS.proxyPort;
  }
  if ("webRtcMode" in patch) clean.webRtcMode = ["soft","strict","off"].includes(patch.webRtcMode) ? patch.webRtcMode : "soft";
  if ("cookieExpiryCapDays" in patch) {
    const days = Number(patch.cookieExpiryCapDays);
    clean.cookieExpiryCapDays = Number.isInteger(days) && days >= 0 && days <= 365 ? days : 7;
  }
  if ("activeProfileId" in patch) clean.activeProfileId = String(patch.activeProfileId || "");
  if ("excludedHosts" in patch) {
    clean.excludedHosts = normalizeHostList(patch.excludedHosts);
    clean.excludedHostsSeeded = true;
  }
  return clean;
}

function publicContentSettings(settings, modules) {
  const m = modules || {};
  return {
    fingerprintShield: "fingerprint" in m ? Boolean(m.fingerprint) : settings.fingerprintShield,
    storageShield: "storage" in m ? Boolean(m.storage) : settings.storageShield,
    sensorShield: "sensors" in m ? Boolean(m.sensors) : settings.sensorShield,
    piiShield: "piiShield" in m ? Boolean(m.piiShield) : settings.piiShield,
    behaviorNoise: "behavior" in m ? Boolean(m.behavior) : settings.behaviorNoise,
    blockServiceWorkers: "blockServiceWorkers" in m ? Boolean(m.blockServiceWorkers) : settings.blockServiceWorkers
  };
}

function normalizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.map((profile, index) => sanitizeProfile(profile, index + 1)).filter(Boolean);
}

function sanitizeProfile(profile, index) {
  if (!profile || typeof profile !== "object") return null;
  // Accept either the v6 `defaultCleanup` field or the legacy v5 `modules`
  // field for forward/backward source compatibility within this commit.
  const sourceCleanup = profile.defaultCleanup || profile.modules;
  const fallback = createRandomProfile({
    name: profile.name || `Profile ${index}`,
    code: profile.code || `PR-${String(index).padStart(2, "0")}`,
    accent: profile.accent || ACCENTS[(index - 1) % ACCENTS.length],
    defaultCleanup: sourceCleanup
  });
  const randomization = profile.randomization && typeof profile.randomization === "object"
    ? { ...fallback.randomization, ...profile.randomization }
    : fallback.randomization;
  const cleanup = { ...fallback.defaultCleanup, ...(sourceCleanup || {}) };
  return {
    id: sanitizeId(profile.id || fallback.id),
    name: String(profile.name || fallback.name).trim().slice(0, 32),
    code: String(profile.code || fallback.code).trim().slice(0, 12),
    accent: sanitizeColor(profile.accent) || fallback.accent,
    defaultCleanup: {
      recommendations: Boolean(cleanup.recommendations),
      comments: Boolean(cleanup.comments),
      metrics: Boolean(cleanup.metrics),
      overlays: Boolean(cleanup.overlays),
      sticky: Boolean(cleanup.sticky),
      motion: Boolean(cleanup.motion)
    },
    randomization: normalizeRandomization(randomization),
    cookiePolicy: ["keep","session","clear-on-switch"].includes(profile.cookiePolicy) ? profile.cookiePolicy : "keep",
    createdAt: Number(profile.createdAt || Date.now()),
    updatedAt: Number(profile.updatedAt || Date.now())
  };
}

function normalizeRandomization(randomization) {
  const fallback = createRandomProfile({ name: "Fallback" }).randomization;
  return { ...fallback, ...randomization,
    screen: { ...fallback.screen, ...(randomization?.screen || {}) },
    salts: { ...fallback.salts, ...(randomization?.salts || {}) }
  };
}

function normalizeSiteAssignments(assignments) {
  if (!assignments || typeof assignments !== "object") return {};
  const clean = {};
  for (const [host, assignment] of Object.entries(assignments)) {
    const cleanHost = sanitizeHost(host);
    if (!cleanHost) continue;
    clean[cleanHost] = {
      enabled: Boolean(assignment?.enabled),
      profileId: String(assignment?.profileId || ""),
      cookiePolicy: sanitizeAssignmentCookiePolicy(assignment?.cookiePolicy),
      modules: sanitizeSiteModules(assignment?.modules),
      updatedAt: Number(assignment?.updatedAt || Date.now())
    };
  }
  return clean;
}

function sanitizeSiteModules(modules) {
  if (!modules || typeof modules !== "object") return structuredClone(DEFAULT_SITE_MODULES);
  const cleanup = modules.cleanup && typeof modules.cleanup === "object" ? modules.cleanup : {};
  return {
    fingerprint: "fingerprint" in modules ? Boolean(modules.fingerprint) : DEFAULT_SITE_MODULES.fingerprint,
    storage: "storage" in modules ? Boolean(modules.storage) : DEFAULT_SITE_MODULES.storage,
    sensors: "sensors" in modules ? Boolean(modules.sensors) : DEFAULT_SITE_MODULES.sensors,
    behavior: "behavior" in modules ? Boolean(modules.behavior) : DEFAULT_SITE_MODULES.behavior,
    piiShield: "piiShield" in modules ? Boolean(modules.piiShield) : DEFAULT_SITE_MODULES.piiShield,
    blockServiceWorkers: "blockServiceWorkers" in modules ? Boolean(modules.blockServiceWorkers) : DEFAULT_SITE_MODULES.blockServiceWorkers,
    cleanup: {
      recommendations: "recommendations" in cleanup ? Boolean(cleanup.recommendations) : DEFAULT_SITE_MODULES.cleanup.recommendations,
      comments: "comments" in cleanup ? Boolean(cleanup.comments) : DEFAULT_SITE_MODULES.cleanup.comments,
      metrics: "metrics" in cleanup ? Boolean(cleanup.metrics) : DEFAULT_SITE_MODULES.cleanup.metrics,
      overlays: "overlays" in cleanup ? Boolean(cleanup.overlays) : DEFAULT_SITE_MODULES.cleanup.overlays,
      sticky: "sticky" in cleanup ? Boolean(cleanup.sticky) : DEFAULT_SITE_MODULES.cleanup.sticky,
      motion: "motion" in cleanup ? Boolean(cleanup.motion) : DEFAULT_SITE_MODULES.cleanup.motion
    }
  };
}

function sanitizeCookiePolicy(value, fallback = "keep") {
  return ["keep","session","clear-on-switch"].includes(value) ? value : fallback;
}

function sanitizeAssignmentCookiePolicy(value) {
  return value === "" || value == null ? "" : sanitizeCookiePolicy(value, "");
}

function resolveCookiePolicy(assignment, profile) {
  return sanitizeAssignmentCookiePolicy(assignment?.cookiePolicy) || sanitizeCookiePolicy(profile?.cookiePolicy, "keep");
}

function createRandomProfile({ name = "Profile", code = "PR-00", accent = "#ff006e", defaultCleanup } = {}) {
  const seedHex = randomHex(32);
  const rng = rngFor(seedHex, "fingerprint");
  const preset = pick(USER_AGENT_PRESETS, rng);
  const [width, height] = pick(preset.sizes, rng);
  const [webglVendor, webglRenderer] = pick(preset.webgl, rng);
  const majorVersion = String(140 + Math.floor(rng() * 4));
  const fullVersion = `${majorVersion}.0.0.0`;
  const chromePart = `Chrome/${fullVersion}`;
  return {
    id: createProfileId(),
    name: String(name).trim().slice(0, 32) || "Profile",
    code, accent: sanitizeColor(accent) || "#ff006e",
    defaultCleanup: {
      recommendations: defaultCleanup?.recommendations ?? true,
      comments: defaultCleanup?.comments ?? true,
      metrics: defaultCleanup?.metrics ?? true,
      overlays: defaultCleanup?.overlays ?? true,
      sticky: defaultCleanup?.sticky ?? false,
      motion: defaultCleanup?.motion ?? true
    },
    cookiePolicy: "keep",
    randomization: {
      profileId: `PRF-${deriveHex(seedHex, "profile-id", 4).toUpperCase()}`,
      seedHex,
      model: preset.label,
      userAgent: `Mozilla/5.0 (${preset.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromePart} Safari/537.36`,
      platform: preset.platform,
      uaPlatformBrand: preset.uaPlatformBrand,
      browserMajorVersion: majorVersion,
      language: preset.language,
      languages: preset.languages,
      acceptLanguage: `${preset.languages[0]},${preset.languages[1]};q=0.9`,
      timezone: preset.timezone,
      timezoneOffset: preset.timezoneOffset,
      screen: {
        width, height,
        availWidth: width - Math.floor(rng() * 24),
        availHeight: height - 40 - Math.floor(rng() * 28),
        colorDepth: 24, pixelDepth: 24,
        devicePixelRatio: pick(preset.ratios, rng)
      },
      hardwareConcurrency: pick(preset.cores, rng),
      deviceMemory: pick(preset.memory, rng),
      maxTouchPoints: pick(preset.touch, rng),
      webglVendor, webglRenderer,
      canvasNoiseSeed: deriveHex(seedHex, "canvas-noise", 16),
      audioNoiseSeed: deriveHex(seedHex, "audio-noise", 16),
      behaviorJitterSeed: deriveHex(seedHex, "behavior-jitter", 16),
      trackerRuleSalt: deriveHex(seedHex, "tracker-rule", 16),
      salts: {
        storage: deriveHex(seedHex, "storage-salt", 16),
        indexedDB: deriveHex(seedHex, "indexeddb-salt", 16),
        cache: deriveHex(seedHex, "cache-salt", 16),
        broadcastChannel: deriveHex(seedHex, "broadcastchannel-salt", 16)
      }
    },
    createdAt: Date.now(), updatedAt: Date.now()
  };
}

async function handleTabClose(tabId) {
  let host = tabHostMap.get(tabId);
  if (!host && chrome.storage.session) {
    const data = await chrome.storage.session.get(`tabHost:${tabId}`).catch(() => ({}));
    host = data[`tabHost:${tabId}`];
    await chrome.storage.session.remove(`tabHost:${tabId}`).catch(() => {});
  }
  tabHostMap.delete(tabId);
  if (!host) return;
  const settings = await getSettings();
  if (!settings.enabled) return;
  const assignment = getSiteAssignment(settings, host);
  if (!assignment?.enabled) return;
  const profile = getProfile(settings, assignment.profileId);
  const policy = resolveCookiePolicy(assignment, profile);
  if (policy !== "session") return;
  const remaining = await chrome.tabs.query({ url: [`http://${host}/*`, `https://${host}/*`] }).catch(() => []);
  if (remaining.length > 0) return;
  await saveCookieJar(host, assignment.profileId);
  await clearSiteCookiesForHost(host);
}

async function periodicCookieSweep() {
  const settings = await getSettings();
  if (!settings.enabled) return;
  const capDays = settings.cookieExpiryCapDays || 0;
  if (capDays <= 0) return;
  const maxAgeSeconds = capDays * 86400;
  const now = Math.floor(Date.now() / 1000);
  const assignedHosts = Object.keys(settings.siteAssignments);
  if (!assignedHosts.length) return;
  for (const host of assignedHosts) {
    const assignment = settings.siteAssignments[host];
    if (!assignment?.enabled) continue;
    if (isExcluded(host, settings)) continue;
    try {
      const cookies = await chrome.cookies.getAll({ domain: host }).catch(() => []);
      for (const cookie of cookies) {
        if (!cookie.expirationDate) continue;
        const remaining = cookie.expirationDate - now;
        if (remaining > maxAgeSeconds) {
          const scheme = cookie.secure ? "https" : "http";
          const domain = cookie.domain.replace(/^\./, "");
          const url = `${scheme}://${domain}${cookie.path || "/"}`;
          await chrome.cookies.set({
            url, name: cookie.name, value: cookie.value, domain: cookie.domain,
            path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite || "unspecified", expirationDate: now + maxAgeSeconds
          }).catch(() => {});
        }
      }
    } catch {}
  }
  const trackingNames = [
    "_ga","_gid","_gat","_fbp","_fbc","_gcl_au","_gcl_aw",
    "IDE","DSID","ANID","__utma","__utmb","__utmc","__utmz",
    "_hjid","_hjSession","_hjSessionUser","_clck","_clsk",
    "ajs_user_id","ajs_anonymous_id"
  ];
  try {
    for (const name of trackingNames) {
      const cookies = await chrome.cookies.getAll({ name }).catch(() => []);
      for (const cookie of cookies) {
        const cookieHost = cookie.domain.replace(/^\./, "");
        if (!getSiteAssignment(settings, cookieHost)) continue;
        const scheme = cookie.secure ? "https" : "http";
        const url = `${scheme}://${cookieHost}${cookie.path || "/"}`;
        await chrome.cookies.remove({ url, name: cookie.name }).catch(() => {});
      }
    }
  } catch {}
}

async function applyControls() {
  const settings = await getSettings();
  await Promise.all([applyProxy(settings), applyPrivacySettings(settings)]);
}

async function applyProxy(settings) {
  if (!settings.enabled || !settings.proxyEnabled) {
    await clearChromeSetting(chrome.proxy.settings);
    settings.lastProxyMode = "disabled";
    await setSettings(settings);
    return;
  }
  const excludedHosts = normalizeHostList(settings.excludedHosts);
  if (excludedHosts.length) {
    const pacScript = buildPacScript(settings.proxyHost, settings.proxyPort, excludedHosts);
    const ok = await setChromeSetting(chrome.proxy.settings, { mode: "pac_script", pacScript: { data: pacScript } });
    settings.lastProxyMode = ok === false ? "fixed" : "pac";
    if (ok !== false) { await setSettings(settings); return; }
  }
  const ok = await setChromeSetting(chrome.proxy.settings, {
    mode: "fixed_servers",
    rules: { singleProxy: { scheme: "socks5", host: settings.proxyHost, port: settings.proxyPort },
             bypassList: ["<local>","localhost","127.0.0.1","::1"] }
  });
  settings.lastProxyMode = ok === false ? "disabled" : "fixed";
  await setSettings(settings);
}

async function applyPrivacySettings(settings) {
  const anyAssignedPii = Object.values(settings.siteAssignments || {}).some((a) => a?.enabled && a?.modules?.piiShield);
  if (!settings.enabled || !settings.privacyControls) {
    await Promise.all([
      clearChromeSetting(chrome.privacy?.network?.networkPredictionEnabled),
      clearChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy),
      clearChromeSetting(chrome.privacy?.services?.alternateErrorPagesEnabled),
      clearChromeSetting(chrome.privacy?.services?.autofillAddressEnabled),
      clearChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled),
      clearChromeSetting(chrome.privacy?.services?.searchSuggestEnabled),
      clearChromeSetting(chrome.privacy?.services?.spellingServiceEnabled),
      clearChromeSetting(chrome.privacy?.services?.translationServiceEnabled),
      clearChromeSetting(chrome.privacy?.websites?.thirdPartyCookiesAllowed),
      clearChromeSetting(chrome.privacy?.websites?.hyperlinkAuditingEnabled),
      clearChromeSetting(chrome.privacy?.websites?.referrersEnabled),
      clearChromeSetting(chrome.privacy?.websites?.doNotTrackEnabled),
      clearChromeSetting(chrome.privacy?.websites?.topicsEnabled),
      clearChromeSetting(chrome.privacy?.websites?.fledgeEnabled),
      clearChromeSetting(chrome.privacy?.websites?.adMeasurementEnabled),
      clearChromeSetting(chrome.privacy?.websites?.relatedWebsiteSetsEnabled),
      clearChromeSetting(chrome.privacy?.websites?.protectedContentEnabled)
    ]);
    return;
  }
  const webRtcPolicy = settings.webRtcMode === "off" ? null
    : settings.webRtcMode === "strict" || settings.proxyEnabled
      ? "disable_non_proxied_udp" : "default_public_interface_only";
  const blockAutofill = settings.blockAutofill || anyAssignedPii;
  const blockReferrers = settings.blockReferrers || anyAssignedPii;
  await Promise.all([
    setChromeSetting(chrome.privacy?.network?.networkPredictionEnabled, false),
    webRtcPolicy ? setChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy, webRtcPolicy)
                 : clearChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy),
    setChromeSetting(chrome.privacy?.services?.alternateErrorPagesEnabled, false),
    blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillAddressEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillAddressEnabled),
    blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled),
    setChromeSetting(chrome.privacy?.services?.searchSuggestEnabled, false),
    setChromeSetting(chrome.privacy?.services?.spellingServiceEnabled, false),
    setChromeSetting(chrome.privacy?.services?.translationServiceEnabled, false),
    clearChromeSetting(chrome.privacy?.websites?.thirdPartyCookiesAllowed),
    setChromeSetting(chrome.privacy?.websites?.hyperlinkAuditingEnabled, false),
    blockReferrers ? setChromeSetting(chrome.privacy?.websites?.referrersEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.referrersEnabled),
    setChromeSetting(chrome.privacy?.websites?.doNotTrackEnabled, true),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.topicsEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.topicsEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.fledgeEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.fledgeEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.adMeasurementEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.adMeasurementEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.relatedWebsiteSetsEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.relatedWebsiteSetsEnabled),
    clearChromeSetting(chrome.privacy?.websites?.protectedContentEnabled)
  ]);
}

async function updateDynamicRules() {
  const settings = await getSettings();
  const addRules = [];
  const domainExclusions = normalizeHostList(settings.excludedHosts);

  if (settings.enabled && domainExclusions.length) {
    addRules.push({
      id: EXCLUDED_INITIATOR_ALLOW_RULE_ID, priority: 100,
      action: { type: "allow" },
      condition: { initiatorDomains: domainExclusions, resourceTypes: RESOURCE_TYPES }
    });
    addRules.push({
      id: EXCLUDED_REQUEST_ALLOW_RULE_ID, priority: 100,
      action: { type: "allow" },
      condition: { requestDomains: domainExclusions, resourceTypes: RESOURCE_TYPES }
    });
  }

  if (settings.enabled && settings.networkHeaders) {
    const assignedHostList = Object.entries(settings.siteAssignments || {})
      .filter(([, a]) => a?.enabled)
      .map(([host, a]) => ({ host, profile: getProfile(settings, a.profileId) }))
      .filter((entry) => entry.profile);

    let perSiteId = PER_SITE_HEADER_RULE_ID_BASE;
    for (const { host, profile } of assignedHostList) {
      if (perSiteId > PER_SITE_HEADER_RULE_ID_MAX) break;
      const requestHeaders = [
        { header: "DNT", operation: "set", value: "1" },
        { header: "Sec-GPC", operation: "set", value: "1" },
        { header: "Accept-Language", operation: "set", value: profile.randomization.acceptLanguage }
      ];
      if (settings.spoofUserAgentHeader) {
        requestHeaders.push({ header: "User-Agent", operation: "set", value: profile.randomization.userAgent });
      }
      addRules.push({
        id: perSiteId++, priority: 5,
        action: { type: "modifyHeaders", requestHeaders },
        condition: { requestDomains: [host], resourceTypes: RESOURCE_TYPES, ...excludedDomainCondition(domainExclusions) }
      });
    }

    const activeProfile = getProfile(settings, settings.activeProfileId) || settings.profiles[0];
    if (activeProfile && settings.applyShieldsGlobally) {
      const requestHeaders = [
        { header: "DNT", operation: "set", value: "1" },
        { header: "Sec-GPC", operation: "set", value: "1" },
        { header: "Accept-Language", operation: "set", value: activeProfile.randomization.acceptLanguage }
      ];
      if (settings.spoofUserAgentHeader) {
        requestHeaders.push({ header: "User-Agent", operation: "set", value: activeProfile.randomization.userAgent });
      }
      const assignedHostsList = assignedHostList.map((e) => e.host);
      addRules.push({
        id: GLOBAL_HEADER_RULE_ID, priority: 2,
        action: { type: "modifyHeaders", requestHeaders },
        condition: {
          regexFilter: "^https?://", resourceTypes: RESOURCE_TYPES,
          ...excludedDomainCondition([...domainExclusions, ...assignedHostsList])
        }
      });
    }
  }

  if (settings.enabled && settings.thirdPartyIsolation) {
    addRules.push({
      id: THIRD_PARTY_RULE_ID, priority: 3,
      action: { type: "modifyHeaders",
        requestHeaders: [{ header: "Cookie", operation: "remove" }],
        responseHeaders: [{ header: "Set-Cookie", operation: "remove" }] },
      condition: { regexFilter: "^https?://", domainType: "thirdParty", resourceTypes: RESOURCE_TYPES, ...excludedDomainCondition(domainExclusions) }
    });
  }

  if (settings.enabled && settings.blockTrackingHeaders) {
    addRules.push({
      id: ETAG_RULE_ID, priority: 2,
      action: { type: "modifyHeaders",
        responseHeaders: [{ header: "ETag", operation: "remove" }, { header: "Last-Modified", operation: "remove" }] },
      condition: { regexFilter: "^https?://", domainType: "thirdParty", resourceTypes: RESOURCE_TYPES, ...excludedDomainCondition(domainExclusions) }
    });
  }

  // Per-site referrer trim using DNR header rules. This makes piiShield actually per-site
  // for referrers, instead of relying solely on the global chrome.privacy preference.
  if (settings.enabled) {
    const piiHosts = Object.entries(settings.siteAssignments || {})
      .filter(([, a]) => a?.enabled && a?.modules?.piiShield)
      .map(([host]) => host);
    if (piiHosts.length) {
      addRules.push({
        id: PII_REFERER_RULE_ID, priority: 4,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "remove" }]
        },
        condition: {
          requestDomains: piiHosts,
          resourceTypes: RESOURCE_TYPES,
          ...excludedDomainCondition(domainExclusions)
        }
      });
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
  const removeRuleIds = [
    ...RESERVED_DYNAMIC_RULE_IDS,
    HEADER_RULE_ID_BASE,
    ...existing.map((r) => r.id).filter((id) => id >= PER_SITE_HEADER_RULE_ID_BASE && id <= PER_SITE_HEADER_RULE_ID_MAX)
  ];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules }).catch(() => {});
}

async function getTelemetry(settings = null, host = "") {
  const [dynamicRules, enabledRulesets] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules().catch(() => []),
    chrome.declarativeNetRequest.getEnabledRulesets().catch(() => [])
  ]);
  let staticRuleCount = 0;
  if (staticRuleCountCache !== null) {
    staticRuleCount = staticRuleCountCache;
  } else {
    for (const rulesetId of enabledRulesets) {
      try {
        const url = chrome.runtime.getURL(`rules/${rulesetId}.json`);
        const response = await fetch(url);
        if (response.ok) {
          const rules = await response.json();
          if (Array.isArray(rules)) staticRuleCount += rules.length;
        }
      } catch {}
    }
    staticRuleCountCache = staticRuleCount;
  }
  return {
    dynamicRuleCount: dynamicRules.length,
    staticRulesetCount: enabledRulesets.length,
    staticRuleCount,
    proxyMode: settings?.enabled && settings?.proxyEnabled ? settings.lastProxyMode || "fixed" : "disabled",
    excludedHostCount: settings?.excludedHosts?.length || 0,
    activeHostExcluded: Boolean(host && settings && isExcluded(host, settings))
  };
}

function excludedDomainCondition(domainExclusions) {
  return domainExclusions.length ? { excludedInitiatorDomains: domainExclusions, excludedRequestDomains: domainExclusions } : {};
}

function getSiteAssignment(settings, host) {
  if (!host) return null;
  const exact = settings.siteAssignments[host];
  if (exact) return exact;
  const parts = host.split(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    const parent = parts.slice(index).join(".");
    if (settings.siteAssignments[parent]) return settings.siteAssignments[parent];
  }
  return null;
}

function deleteAssignmentsForProfile(settings, profileId) {
  for (const [host, assignment] of Object.entries(settings.siteAssignments)) {
    if (assignment.profileId === profileId) delete settings.siteAssignments[host];
  }
}

function getProfile(settings, id) {
  return settings.profiles.find((profile) => profile.id === id) || null;
}

async function notifyHost(host) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*","https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (getHost(tab.url) !== host || !tab.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: "signalonly:update" }).catch(() => {});
    await updateBadgeForTab(tab.id);
  }));
}

async function notifyAllTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*","https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, { type: "signalonly:update" }).catch(() => {}) : null));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

async function updateActiveBadge() {
  const tab = await getActiveTab();
  if (tab?.id) await updateBadgeForTab(tab.id);
}

async function updateBadgeForTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const settings = await getSettings();
  const host = getHost(tab?.url);
  const assignment = getSiteAssignment(settings, host);
  const reloadRequired = await isReloadRequired(tabId);
  let text = "";
  let color = "#ff006e";
  if (reloadRequired) {
    text = "!"; color = "#ff4b1f";
  } else if (!settings.enabled) {
    text = "OFF"; color = "#656159";
  } else if (host && isExcluded(host, settings)) {
    text = "EXC"; color = "#656159";
  } else if (assignment) {
    text = assignment.enabled ? "ON" : "OFF";
    color = assignment.enabled ? "#ff006e" : "#656159";
  }
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

function setChromeSetting(setting, value) {
  if (!setting?.set) return Promise.resolve(false);
  return new Promise((resolve) => setting.set({ value, scope: "regular" }, () => resolve(!chrome.runtime.lastError)));
}
function clearChromeSetting(setting) {
  if (!setting?.clear) return Promise.resolve(false);
  return new Promise((resolve) => setting.clear({ scope: "regular" }, () => resolve(!chrome.runtime.lastError)));
}

function getHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : "";
  } catch { return ""; }
}
function isExcluded(host, settings) { return host ? matchesDomainList(host, settings.excludedHosts || []) : false; }
function matchesDomainList(host, list) {
  if (!host || !Array.isArray(list)) return false;
  return list.some((entry) => entry && (host === entry || host.endsWith(`.${entry}`)));
}
function normalizeHostList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(sanitizeHost).filter(Boolean))].slice(0, 200);
}

function buildPacScript(proxyHost, proxyPort, excludedHosts) {
  const host = String(proxyHost || DEFAULT_SETTINGS.proxyHost).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const port = Number(proxyPort) || DEFAULT_SETTINGS.proxyPort;
  return `
var SIGNALONLY_EXCLUDED = ${JSON.stringify(excludedHosts)};
function signalOnlyMatches(host, domain) {
  var suffix = "." + domain;
  return host === domain || host.slice(-suffix.length) === suffix;
}
function FindProxyForURL(url, host) {
  host = String(host || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || isPlainHostName(host)) return "DIRECT";
  for (var i = 0; i < SIGNALONLY_EXCLUDED.length; i += 1) {
    if (signalOnlyMatches(host, SIGNALONLY_EXCLUDED[i])) return "DIRECT";
  }
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0 || url.indexOf("ws://") === 0 || url.indexOf("wss://") === 0) {
    return "SOCKS5 ${host}:${port}";
  }
  return "DIRECT";
}
`.trim();
}

function sanitizeHost(host) {
  return String(host || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    .replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "");
}
function sanitizeId(value) {
  return String(value).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || createProfileId();
}
function sanitizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
}
function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => v.toString(16).padStart(2, "0")).join("");
}
function createProfileId() { return `profile-${randomHex(8)}`; }
function deriveHex(seedHex, label, bytes) {
  const rng = rngFor(seedHex, label);
  let output = "";
  for (let i = 0; i < bytes; i += 1) output += Math.floor(rng() * 256).toString(16).padStart(2, "0");
  return output;
}
function rngFor(seedHex, label) {
  const [a,b,c,d] = cyrb128(`${seedHex}:${label}`);
  return sfc32(a,b,c,d);
}
function pick(values, rng) { return values[Math.floor(rng() * values.length)]; }
function cyrb128(input) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0];
}
function sfc32(a,b,c,d) {
  return function next() {
    a>>>=0; b>>>=0; c>>>=0; d>>>=0;
    const t = (a+b+d)>>>0;
    d = (d+1)>>>0; a = b ^ (b>>>9); b = (c+(c<<3))>>>0;
    c = ((c<<21)|(c>>>11))>>>0; c = (c+t)>>>0;
    return (t>>>0)/4294967296;
  };
}
