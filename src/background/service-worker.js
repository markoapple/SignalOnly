const SETTINGS_KEY = "signalonly.settings";
const SCHEMA_VERSION = 3;

const HEADER_RULE_ID = 7100;
const THIRD_PARTY_RULE_ID = 7101;
const ETAG_RULE_ID = 7102;
const DYNAMIC_RULE_IDS = [HEADER_RULE_ID, THIRD_PARTY_RULE_ID, ETAG_RULE_ID];

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other"
];

const ACCENTS = ["#ff006e", "#0057ff", "#00c2d1", "#ff4b1f"];
const PROFILE_NAMES = ["Standard", "Strict", "Travel", "Accounts"];

const DEFAULT_EXCLUDED_HOSTS = [

  "accounts.google.com",
  "myaccount.google.com",
  "oauth2.googleapis.com",
  "accounts.youtube.com",
  "pay.google.com",

  "appleid.apple.com",
  "idmsa.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
  "login.microsoft.com",
  "login.yahoo.com",
  "github.com",
  "id.atlassian.com",
  "auth.openai.com",
  "auth0.com",
  "okta.com",
  "duosecurity.com",

  "checkout.stripe.com",
  "js.stripe.com",
  "paypal.com",
  "www.paypal.com"
];

const TRUSTED_DOMAINS = [
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "youtube.com",
  "ytimg.com",
  "apple.com",
  "icloud.com",
  "microsoft.com",
  "microsoftonline.com",
  "live.com",
  "office.com",
  "github.com",
  "githubusercontent.com",
  "atlassian.com",
  "okta.com",
  "auth0.com",
  "openai.com",
  "stripe.com",
  "paypal.com"
];

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,

  proxyEnabled: false,
  proxyHost: "127.0.0.1",
  proxyPort: 9050,
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
  excludedHostsSeeded: false
};

const USER_AGENT_PRESETS = [
  {
    label: "Chrome Windows",
    platform: "Win32",
    uaPlatform: "Windows NT 10.0; Win64; x64",
    uaPlatformBrand: "Windows",
    language: "en-US",
    languages: ["en-US", "en"],
    timezone: "America/New_York",
    timezoneOffset: 240,
    cores: [4, 6, 8, 12],
    memory: [4, 8, 16],
    touch: [0],
    sizes: [[1366, 768], [1536, 864], [1600, 900], [1920, 1080]],
    ratios: [1, 1.25, 1.5],
    webgl: [
      ["Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"],
      ["Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"]
    ]
  },
  {
    label: "Chrome macOS",
    platform: "MacIntel",
    uaPlatform: "Macintosh; Intel Mac OS X 10_15_7",
    uaPlatformBrand: "macOS",
    language: "en-GB",
    languages: ["en-GB", "en"],
    timezone: "Europe/London",
    timezoneOffset: -60,
    cores: [8, 10],
    memory: [8, 16],
    touch: [0],
    sizes: [[1440, 900], [1512, 982], [1728, 1117]],
    ratios: [2],
    webgl: [["Google Inc. (Apple)", "ANGLE (Apple, Apple M-Series, Metal)"]]
  },
  {
    label: "Chrome Linux",
    platform: "Linux x86_64",
    uaPlatform: "X11; Linux x86_64",
    uaPlatformBrand: "Linux",
    language: "en-US",
    languages: ["en-US", "en"],
    timezone: "UTC",
    timezoneOffset: 0,
    cores: [4, 6, 8],
    memory: [4, 8],
    touch: [0],
    sizes: [[1366, 768], [1600, 900], [1920, 1080]],
    ratios: [1],
    webgl: [["Google Inc. (Mesa)", "ANGLE (Mesa, llvmpipe, OpenGL)"]]
  }
];

let settingsCache = null;

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());

chrome.tabs.onActivated.addListener(({ tabId }) => void updateBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void updateBadgeForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void handleTabClose(tabId));

const tabHostMap = new Map();
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    const host = getHost(tab?.url);
    if (host) {
      tabHostMap.set(tabId, host);
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    settingsCache = null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

setInterval(() => void periodicCookieSweep(), 30 * 60 * 1000);

void boot();

async function boot() {
  await ensureSettings();
  await applyControls();
  await updateDynamicRules();
  await chrome.action.setBadgeBackgroundColor({ color: "#ff006e" }).catch(() => {});
  await updateActiveBadge();
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "getState":
      return { ok: true, ...(await getState(message.url)) };
    case "saveSettings":
      return saveSettings(message.settings || {});
    case "getContentConfig":
      return getContentConfig(message.url || sender?.url);
    case "applySiteProfile":
      return applySiteProfile(message.host, message.profileId, message.enabled, message.clearCookies);
    case "resetSiteProfile":
      return resetSiteProfile(message.host);
    case "clearSiteCookies":
      return clearSiteCookiesForHost(message.host);
    case "createProfile":
      return createProfileFromRequest(message);
    case "duplicateProfile":
      return duplicateProfile(message.profileId);
    case "regenerateProfile":
      return regenerateProfile(message.profileId);
    case "saveProfile":
      return saveProfile(message.profile);
    case "deleteProfile":
      return deleteProfile(message.profileId);
    case "exportConfig":
      return exportConfig();
    case "importConfig":
      return importConfig(message.config);
    case "openOptions":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: "Unknown message" };
  }
}

async function getState(url = "") {
  const settings = await getSettings();
  const activeTab = url ? null : await getActiveTab();
  const host = getHost(url || activeTab?.url || "");
  const assignment = host ? getSiteAssignment(settings, host) : null;
  const currentProfile = getProfile(settings, assignment?.profileId || settings.activeProfileId);
  const telemetry = await getTelemetry();

  return {
    settings,
    telemetry,
    version: chrome.runtime.getManifest().version,
    context: {
      host,
      siteEnabled: Boolean(assignment?.enabled),
      assignment,
      currentProfile,
      excluded: host ? isExcluded(host, settings) : false,
      defaultExcluded: host ? matchesDomainList(host, DEFAULT_EXCLUDED_HOSTS) : false
    }
  };
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

  const shieldsActive = Boolean(
    settings.enabled && !excluded && profile && (siteEnabled || settings.applyShieldsGlobally)
  );

  return {
    ok: true,
    enabled: shieldsActive,
    host,
    settings: publicContentSettings(settings),
    profile: shieldsActive ? profile : null,
    site: {
      enabled: siteEnabled,
      assignment,
      excluded,
      assigned: Boolean(assignment)
    }
  };
}

async function applySiteProfile(host, profileId, enabled = true, clearCookies = false) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) {
    return { ok: false, error: "No valid host" };
  }

  const settings = await getSettings();
  const oldAssignment = settings.siteAssignments[cleanHost];
  const profile = getProfile(settings, profileId) || getProfile(settings, settings.activeProfileId) || settings.profiles[0];
  if (!profile) {
    return { ok: false, error: "No profiles configured" };
  }

  const profileChanged = oldAssignment && oldAssignment.profileId !== profile.id;
  const shouldClear = clearCookies || (profileChanged && settings.autoClearOnSwitch);

  settings.siteAssignments[cleanHost] = {
    enabled: Boolean(enabled),
    profileId: profile.id,
    cookiePolicy: profile.cookiePolicy || "keep",
    updatedAt: Date.now()
  };
  await setSettings(settings);

  let cookiesCleared = 0;
  if (shouldClear) {
    const result = await clearSiteCookiesForHost(cleanHost);
    cookiesCleared = result.cleared;
  }

  await notifyHost(cleanHost);
  await updateActiveBadge();
  return { ok: true, cookiesCleared, ...(await getState(`https://${cleanHost}/`)) };
}

async function clearSiteCookiesForHost(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) {
    return { ok: false, cleared: 0, error: "No valid host" };
  }

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
  } catch {

  }

  return { ok: true, cleared };
}

async function resetSiteProfile(host) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) {
    return { ok: false, error: "No valid host" };
  }

  const settings = await getSettings();
  delete settings.siteAssignments[cleanHost];
  await setSettings(settings);
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
  if (!source) {
    return { ok: false, error: "Profile not found" };
  }

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
  const index = settings.profiles.findIndex((profile) => profile.id === profileId);
  if (index < 0) {
    return { ok: false, error: "Profile not found" };
  }

  const old = settings.profiles[index];
  const regenerated = createRandomProfile({
    name: old.name,
    code: old.code,
    accent: old.accent,
    modules: old.modules
  });
  settings.profiles[index] = {
    ...regenerated,
    id: old.id,
    cookiePolicy: old.cookiePolicy || regenerated.cookiePolicy,
    createdAt: old.createdAt,
    updatedAt: Date.now()
  };
  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function saveProfile(profile) {
  const settings = await getSettings();
  const clean = sanitizeProfile(profile, settings.profiles.length + 1);
  if (!clean) {
    return { ok: false, error: "Invalid profile" };
  }

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
  if (settings.profiles.length <= 1) {
    return { ok: false, error: "At least one profile must remain" };
  }

  const profile = getProfile(settings, profileId);
  if (!profile) {
    return { ok: false, error: "Profile not found" };
  }

  settings.profiles = settings.profiles.filter((item) => item.id !== profileId);
  deleteAssignmentsForProfile(settings, profileId);
  if (settings.activeProfileId === profileId) {
    settings.activeProfileId = settings.profiles[0].id;
  }

  await setSettings(settings);
  await updateDynamicRules();
  await notifyAllTabs();
  return { ok: true, ...(await getState()) };
}

async function exportConfig() {
  const settings = await getSettings();
  return {
    ok: true,
    config: {
      exportedAt: new Date().toISOString(),
      version: SCHEMA_VERSION,
      settings
    }
  };
}

async function importConfig(config) {
  let imported;
  try {
    imported = typeof config === "string" ? JSON.parse(config) : config;
  } catch (error) {
    return { ok: false, error: "Invalid JSON" };
  }
  const settings = normalizeSettings(imported?.settings || imported || {});
  await setSettings(settings);
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
  if (settingsCache) {
    return structuredClone(settingsCache);
  }
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
  settings.excludedHosts = Array.isArray(migrated.excludedHosts)
    ? [...new Set(migrated.excludedHosts.map(sanitizeHost).filter(Boolean))].slice(0, 200)
    : [];

  if (!settings.excludedHostsSeeded) {
    const merged = new Set([...settings.excludedHosts, ...DEFAULT_EXCLUDED_HOSTS]);
    settings.excludedHosts = [...merged].slice(0, 200);
    settings.excludedHostsSeeded = true;
  }

  if (!settings.profiles.length) {
    settings.profiles = PROFILE_NAMES.map((name, index) => createRandomProfile({
      name,
      code: `PR-${String(index + 1).padStart(2, "0")}`,
      accent: ACCENTS[index % ACCENTS.length]
    }));
  }
  if (!getProfile(settings, settings.activeProfileId)) {
    settings.activeProfileId = settings.profiles[0].id;
  }
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
      modules: legacy.modules
    }));
    const idMap = new Map();
    next.focusProfiles.forEach((legacy, index) => idMap.set(legacy.id, profiles[index]?.id));
    const siteAssignments = {};
    for (const [host, assignment] of Object.entries(next.siteAssignments || {})) {
      siteAssignments[host] = {
        ...assignment,
        profileId: idMap.get(assignment.profileId) || profiles[0]?.id
      };
    }
    next = {
      ...next,
      profiles,
      activeProfileId: idMap.get(next.activeFocusProfileId) || profiles[0]?.id || "",
      siteAssignments
    };
  }

  if ((next.schemaVersion || 0) < 2) {
    if ("torEnabled" in next && !("proxyEnabled" in next)) {
      next.proxyEnabled = Boolean(next.torEnabled);
    }
    if ("torHost" in next && !("proxyHost" in next)) {
      next.proxyHost = next.torHost;
    }
    if ("torPort" in next && !("proxyPort" in next)) {
      next.proxyPort = next.torPort;
    }

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

    if (Array.isArray(next.profiles)) {
      next.profiles.forEach((p) => {
        if (!p.cookiePolicy) p.cookiePolicy = "keep";
      });
    }
  }

  return next;
}

function sanitizeSettingsPatch(patch) {
  const clean = {};
  const booleanKeys = [
    "enabled",
    "proxyEnabled",
    "privacyControls",
    "fingerprintShield",
    "storageShield",
    "sensorShield",
    "piiShield",
    "behaviorNoise",
    "networkHeaders",
    "spoofUserAgentHeader",
    "thirdPartyIsolation",
    "blockTrackingHeaders",
    "blockServiceWorkers",
    "applyShieldsGlobally",
    "blockTopics",
    "blockAutofill",
    "blockReferrers",
    "autoClearOnSwitch"
  ];

  for (const key of booleanKeys) {
    if (key in patch) {
      clean[key] = Boolean(patch[key]);
    }
  }

  if ("proxyHost" in patch) {
    clean.proxyHost = String(patch.proxyHost || DEFAULT_SETTINGS.proxyHost).trim() || DEFAULT_SETTINGS.proxyHost;
  }
  if ("proxyPort" in patch) {
    const port = Number(patch.proxyPort);
    clean.proxyPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SETTINGS.proxyPort;
  }
  if ("webRtcMode" in patch) {
    clean.webRtcMode = ["soft", "strict", "off"].includes(patch.webRtcMode) ? patch.webRtcMode : "soft";
  }
  if ("cookieExpiryCapDays" in patch) {
    const days = Number(patch.cookieExpiryCapDays);
    clean.cookieExpiryCapDays = Number.isInteger(days) && days >= 0 && days <= 365 ? days : 7;
  }
  if ("activeProfileId" in patch) {
    clean.activeProfileId = String(patch.activeProfileId || "");
  }
  if ("excludedHosts" in patch) {
    clean.excludedHosts = Array.isArray(patch.excludedHosts)
      ? [...new Set(patch.excludedHosts.map(sanitizeHost).filter(Boolean))].slice(0, 200)
      : [];
  }
  return clean;
}

function publicContentSettings(settings) {
  return {
    fingerprintShield: settings.fingerprintShield,
    storageShield: settings.storageShield,
    sensorShield: settings.sensorShield,
    piiShield: settings.piiShield,
    behaviorNoise: settings.behaviorNoise,
    blockServiceWorkers: settings.blockServiceWorkers
  };
}

function normalizeProfiles(profiles) {
  if (!Array.isArray(profiles)) {
    return [];
  }
  return profiles.map((profile, index) => sanitizeProfile(profile, index + 1)).filter(Boolean);
}

function sanitizeProfile(profile, index) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const fallback = createRandomProfile({
    name: profile.name || `Profile ${index}`,
    code: profile.code || `PR-${String(index).padStart(2, "0")}`,
    accent: profile.accent || ACCENTS[(index - 1) % ACCENTS.length],
    modules: profile.modules
  });
  const randomization = profile.randomization && typeof profile.randomization === "object"
    ? { ...fallback.randomization, ...profile.randomization }
    : fallback.randomization;
  const modules = { ...fallback.modules, ...(profile.modules || {}) };

  return {
    id: sanitizeId(profile.id || fallback.id),
    name: String(profile.name || fallback.name).trim().slice(0, 32),
    code: String(profile.code || fallback.code).trim().slice(0, 12),
    accent: sanitizeColor(profile.accent) || fallback.accent,
    modules: {
      recommendations: Boolean(modules.recommendations),
      comments: Boolean(modules.comments),
      metrics: Boolean(modules.metrics),
      overlays: Boolean(modules.overlays),
      sticky: Boolean(modules.sticky),
      motion: Boolean(modules.motion)
    },
    randomization: normalizeRandomization(randomization),
    cookiePolicy: ["keep", "session", "clear-on-switch"].includes(profile.cookiePolicy) ? profile.cookiePolicy : "keep",
    createdAt: Number(profile.createdAt || Date.now()),
    updatedAt: Number(profile.updatedAt || Date.now())
  };
}

function normalizeRandomization(randomization) {
  const fallback = createRandomProfile({ name: "Fallback" }).randomization;
  return {
    ...fallback,
    ...randomization,
    screen: { ...fallback.screen, ...(randomization?.screen || {}) },
    salts: { ...fallback.salts, ...(randomization?.salts || {}) }
  };
}

function normalizeSiteAssignments(assignments) {
  if (!assignments || typeof assignments !== "object") {
    return {};
  }

  const clean = {};
  for (const [host, assignment] of Object.entries(assignments)) {
    const cleanHost = sanitizeHost(host);
    if (!cleanHost) {
      continue;
    }
    clean[cleanHost] = {
      enabled: Boolean(assignment?.enabled),
      profileId: String(assignment?.profileId || ""),
      updatedAt: Number(assignment?.updatedAt || Date.now())
    };
  }
  return clean;
}

function createRandomProfile({ name = "Profile", code = "PR-00", accent = "#ff006e", modules } = {}) {
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
    code,
    accent: sanitizeColor(accent) || "#ff006e",
    modules: {
      recommendations: modules?.recommendations ?? true,
      comments: modules?.comments ?? true,
      metrics: modules?.metrics ?? true,
      overlays: modules?.overlays ?? true,
      sticky: modules?.sticky ?? false,
      motion: modules?.motion ?? true
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
        width,
        height,
        availWidth: width - Math.floor(rng() * 24),
        availHeight: height - 40 - Math.floor(rng() * 28),
        colorDepth: 24,
        pixelDepth: 24,
        devicePixelRatio: pick(preset.ratios, rng)
      },
      hardwareConcurrency: pick(preset.cores, rng),
      deviceMemory: pick(preset.memory, rng),
      maxTouchPoints: pick(preset.touch, rng),
      webglVendor,
      webglRenderer,
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
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

async function handleTabClose(tabId) {
  const host = tabHostMap.get(tabId);
  tabHostMap.delete(tabId);
  if (!host) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const assignment = getSiteAssignment(settings, host);
  if (!assignment?.enabled) return;

  const profile = getProfile(settings, assignment.profileId);
  const policy = assignment.cookiePolicy || profile?.cookiePolicy || "keep";
  if (policy !== "session") return;

  const remainingTabs = await chrome.tabs.query({ url: [`http://${host}/*`, `https://${host}/*`] }).catch(() => []);
  if (remainingTabs.length > 0) return;

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
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite || "unspecified",
            expirationDate: now + maxAgeSeconds
          }).catch(() => {});
        }
      }
    } catch {

    }
  }

  const trackingNames = [
    "_ga", "_gid", "_gat",
    "_fbp", "_fbc",
    "_gcl_au", "_gcl_aw",
    "IDE", "DSID", "ANID",
    "__utma", "__utmb", "__utmc", "__utmz",
    "_hjid", "_hjSession", "_hjSessionUser",
    "_clck", "_clsk",
    "ajs_user_id", "ajs_anonymous_id"
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
  } catch {

  }
}

async function applyControls() {
  const settings = await getSettings();
  await Promise.all([applyProxy(settings), applyPrivacySettings(settings)]);
}

async function applyProxy(settings) {
  if (!settings.enabled || !settings.proxyEnabled) {
    await clearChromeSetting(chrome.proxy.settings);
    return;
  }

  await setChromeSetting(chrome.proxy.settings, {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: "socks5", host: settings.proxyHost, port: settings.proxyPort },
      bypassList: ["<local>", "localhost", "127.0.0.1", "::1"]
    }
  });
}

async function applyPrivacySettings(settings) {
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

  const webRtcPolicy = settings.webRtcMode === "off"
    ? null
    : settings.webRtcMode === "strict" || settings.proxyEnabled
      ? "disable_non_proxied_udp"
      : "default_public_interface_only";

  await Promise.all([
    setChromeSetting(chrome.privacy?.network?.networkPredictionEnabled, false),
    webRtcPolicy
      ? setChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy, webRtcPolicy)
      : clearChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy),
    setChromeSetting(chrome.privacy?.services?.alternateErrorPagesEnabled, false),
    settings.blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillAddressEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillAddressEnabled),
    settings.blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled),
    setChromeSetting(chrome.privacy?.services?.searchSuggestEnabled, false),
    setChromeSetting(chrome.privacy?.services?.spellingServiceEnabled, false),
    setChromeSetting(chrome.privacy?.services?.translationServiceEnabled, false),

    clearChromeSetting(chrome.privacy?.websites?.thirdPartyCookiesAllowed),
    setChromeSetting(chrome.privacy?.websites?.hyperlinkAuditingEnabled, false),
    settings.blockReferrers ? setChromeSetting(chrome.privacy?.websites?.referrersEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.referrersEnabled),
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
  const profile = getProfile(settings, settings.activeProfileId) || settings.profiles[0];
  const addRules = [];

  const initiatorExclusions = [...new Set([
    ...TRUSTED_DOMAINS,
    ...(settings.excludedHosts || []).map(toRegistrable)
  ])].filter(Boolean);

  if (settings.enabled && settings.networkHeaders && profile) {
    const requestHeaders = [
      { header: "DNT", operation: "set", value: "1" },
      { header: "Sec-GPC", operation: "set", value: "1" },
      { header: "Accept-Language", operation: "set", value: profile.randomization.acceptLanguage }
    ];
    if (settings.spoofUserAgentHeader) {

      requestHeaders.push({ header: "User-Agent", operation: "set", value: profile.randomization.userAgent });
    }
    addRules.push({
      id: HEADER_RULE_ID,
      priority: 2,
      action: { type: "modifyHeaders", requestHeaders },
      condition: {
        regexFilter: "^https?://",
        resourceTypes: RESOURCE_TYPES,
        excludedInitiatorDomains: initiatorExclusions,
        excludedRequestDomains: initiatorExclusions
      }
    });
  }

  if (settings.enabled && settings.thirdPartyIsolation) {
    addRules.push({
      id: THIRD_PARTY_RULE_ID,
      priority: 3,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Cookie", operation: "remove" }],
        responseHeaders: [{ header: "Set-Cookie", operation: "remove" }]
      },
      condition: {
        regexFilter: "^https?://",
        domainType: "thirdParty",
        resourceTypes: RESOURCE_TYPES,
        excludedInitiatorDomains: initiatorExclusions,
        excludedRequestDomains: initiatorExclusions
      }
    });
  }

  if (settings.enabled && settings.blockTrackingHeaders) {
    addRules.push({
      id: ETAG_RULE_ID,
      priority: 2,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "ETag", operation: "remove" },
          { header: "Last-Modified", operation: "remove" }
        ]
      },
      condition: {
        regexFilter: "^https?://",
        domainType: "thirdParty",
        resourceTypes: RESOURCE_TYPES,
        excludedInitiatorDomains: initiatorExclusions,
        excludedRequestDomains: initiatorExclusions
      }
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: DYNAMIC_RULE_IDS, addRules }).catch(() => {});
}

async function getTelemetry() {
  const [dynamicRules, enabledRulesets] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules().catch(() => []),
    chrome.declarativeNetRequest.getEnabledRulesets().catch(() => [])
  ]);
  let staticRuleCount = 0;
  for (const rulesetId of enabledRulesets) {
    try {
      const url = chrome.runtime.getURL(`rules/${rulesetId}.json`);
      const response = await fetch(url);
      if (response.ok) {
        const rules = await response.json();
        if (Array.isArray(rules)) {
          staticRuleCount += rules.length;
        }
      }
    } catch {

    }
  }
  return {
    dynamicRuleCount: dynamicRules.length,
    staticRulesetCount: enabledRulesets.length,
    staticRuleCount
  };
}

function getSiteAssignment(settings, host) {
  if (!host) {
    return null;
  }
  const exact = settings.siteAssignments[host];
  if (exact) {
    return exact;
  }
  const parts = host.split(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    const parent = parts.slice(index).join(".");
    if (settings.siteAssignments[parent]) {
      return settings.siteAssignments[parent];
    }
  }
  return null;
}

function deleteAssignmentsForProfile(settings, profileId) {
  for (const [host, assignment] of Object.entries(settings.siteAssignments)) {
    if (assignment.profileId === profileId) {
      delete settings.siteAssignments[host];
    }
  }
}

function getProfile(settings, id) {
  return settings.profiles.find((profile) => profile.id === id) || null;
}

async function notifyHost(host) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (getHost(tab.url) !== host || !tab.id) {
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "signalonly:update" }).catch(() => {});
    await updateBadgeForTab(tab.id);
  }));
}

async function notifyAllTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map((tab) => {
    if (!tab.id) {
      return null;
    }
    return chrome.tabs.sendMessage(tab.id, { type: "signalonly:update" }).catch(() => {});
  }));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

async function updateActiveBadge() {
  const tab = await getActiveTab();
  if (tab?.id) {
    await updateBadgeForTab(tab.id);
  }
}

async function updateBadgeForTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const settings = await getSettings();
  const host = getHost(tab?.url);
  const assignment = getSiteAssignment(settings, host);

  let text = "";
  let color = "#ff006e";
  if (!settings.enabled) {
    text = "OFF";
    color = "#656159";
  } else if (host && isExcluded(host, settings)) {
    text = "EXC";
    color = "#656159";
  } else if (assignment) {
    text = assignment.enabled ? "ON" : "OFF";
    color = assignment.enabled ? "#ff006e" : "#656159";
  }

  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

function setChromeSetting(setting, value) {
  if (!setting?.set) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setting.set({ value, scope: "regular" }, resolve));
}

function clearChromeSetting(setting) {
  if (!setting?.clear) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setting.clear({ scope: "regular" }, resolve));
}

function getHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isExcluded(host, settings) {
  if (!host) return false;
  const userList = settings.excludedHosts || [];
  if (matchesDomainList(host, userList)) return true;

  return matchesDomainList(host, DEFAULT_EXCLUDED_HOSTS);
}

function matchesDomainList(host, list) {
  if (!host || !Array.isArray(list)) return false;
  return list.some((entry) => {
    if (!entry) return false;
    return host === entry || host.endsWith(`.${entry}`);
  });
}

function toRegistrable(host) {

  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function sanitizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "");
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || createProfileId();
}

function sanitizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
}

function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function createProfileId() {
  return `profile-${randomHex(8)}`;
}

function deriveHex(seedHex, label, bytes) {
  const rng = rngFor(seedHex, label);
  let output = "";
  for (let index = 0; index < bytes; index += 1) {
    output += Math.floor(rng() * 256).toString(16).padStart(2, "0");
  }
  return output;
}

function rngFor(seedHex, label) {
  const [a, b, c, d] = cyrb128(`${seedHex}:${label}`);
  return sfc32(a, b, c, d);
}

function pick(values, rng) {
  return values[Math.floor(rng() * values.length)];
}

function cyrb128(input) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a, b, c, d) {
  return function next() {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return (t >>> 0) / 4294967296;
  };
}
