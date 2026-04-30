const SETTINGS_KEY = "signalonly.settings";

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

const DEFAULT_SETTINGS = {
  enabled: true,
  torEnabled: true,
  torHost: "127.0.0.1",
  torPort: 9050,
  privacyControls: true,
  fingerprintShield: true,
  storageShield: true,
  sensorShield: true,
  piiShield: true,
  behaviorNoise: true,
  networkHeaders: true,
  thirdPartyIsolation: true,
  blockTopics: true,
  blockAutofill: true,
  blockReferrers: true,
  activeProfileId: "",
  profiles: [],
  siteAssignments: {},
  excludedHosts: []
};

const USER_AGENT_PRESETS = [
  {
    label: "Chrome Windows",
    platform: "Win32",
    uaPlatform: "Windows NT 10.0; Win64; x64",
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

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());
chrome.tabs.onActivated.addListener(({ tabId }) => void updateBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void updateBadgeForTab(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

void boot();

async function boot() {
  await ensureSettings();
  await applyControls();
  await updateDynamicRules();
  await chrome.action.setBadgeBackgroundColor({ color: "#ff006e" });
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
      return applySiteProfile(message.host, message.profileId, message.enabled);
    case "resetSiteProfile":
      return resetSiteProfile(message.host);
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
    context: {
      host,
      siteEnabled: Boolean(assignment?.enabled),
      assignment,
      currentProfile
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

  return {
    ok: true,
    enabled: Boolean(settings.enabled && !excluded && profile),
    host,
    settings: publicContentSettings(settings),
    profile,
    site: {
      enabled: Boolean(assignment?.enabled),
      assignment
    }
  };
}

async function applySiteProfile(host, profileId, enabled = true) {
  const cleanHost = sanitizeHost(host);
  if (!cleanHost) {
    return { ok: false, error: "No valid host" };
  }

  const settings = await getSettings();
  const profile = getProfile(settings, profileId) || getProfile(settings, settings.activeProfileId);
  settings.siteAssignments[cleanHost] = {
    enabled: Boolean(enabled),
    profileId: profile.id,
    updatedAt: Date.now()
  };
  await setSettings(settings);
  await notifyHost(cleanHost);
  await updateActiveBadge();
  return { ok: true, ...(await getState(`https://${cleanHost}/`)) };
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
  settings.profiles[index] = {
    ...createRandomProfile({
      name: old.name,
      code: old.code,
      accent: old.accent,
      modules: old.modules
    }),
    id: old.id,
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
      version: 1,
      settings
    }
  };
}

async function importConfig(config) {
  const imported = typeof config === "string" ? JSON.parse(config) : config;
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
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY] || {});
}

async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function normalizeSettings(stored) {
  const migrated = migrateLegacySettings(stored);
  const settings = { ...DEFAULT_SETTINGS, ...migrated };
  settings.profiles = normalizeProfiles(migrated.profiles);
  settings.siteAssignments = normalizeSiteAssignments(migrated.siteAssignments);
  settings.excludedHosts = Array.isArray(migrated.excludedHosts) ? migrated.excludedHosts.map(sanitizeHost).filter(Boolean) : [];
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
  return settings;
}

function migrateLegacySettings(stored) {
  if (Array.isArray(stored.profiles)) {
    return stored;
  }
  const profiles = Array.isArray(stored.focusProfiles)
    ? stored.focusProfiles.map((legacy, index) => createRandomProfile({
        name: legacy.name || PROFILE_NAMES[index] || `Profile ${index + 1}`,
        code: legacy.code || `PR-${String(index + 1).padStart(2, "0")}`,
        accent: legacy.accent || ACCENTS[index % ACCENTS.length],
        modules: legacy.modules
      }))
    : [];
  const idMap = new Map();
  if (Array.isArray(stored.focusProfiles)) {
    stored.focusProfiles.forEach((legacy, index) => idMap.set(legacy.id, profiles[index]?.id));
  }
  const siteAssignments = {};
  for (const [host, assignment] of Object.entries(stored.siteAssignments || {})) {
    siteAssignments[host] = {
      ...assignment,
      profileId: idMap.get(assignment.profileId) || profiles[0]?.id
    };
  }
  return {
    ...stored,
    profiles,
    activeProfileId: idMap.get(stored.activeFocusProfileId) || profiles[0]?.id || "",
    siteAssignments
  };
}

function sanitizeSettingsPatch(patch) {
  const clean = {};
  const keys = [
    "enabled",
    "torEnabled",
    "privacyControls",
    "fingerprintShield",
    "storageShield",
    "sensorShield",
    "piiShield",
    "behaviorNoise",
    "networkHeaders",
    "thirdPartyIsolation",
    "blockTopics",
    "blockAutofill",
    "blockReferrers"
  ];

  for (const key of keys) {
    if (key in patch) {
      clean[key] = Boolean(patch[key]);
    }
  }

  if ("torHost" in patch) {
    clean.torHost = String(patch.torHost || DEFAULT_SETTINGS.torHost).trim() || DEFAULT_SETTINGS.torHost;
  }
  if ("torPort" in patch) {
    const port = Number(patch.torPort);
    clean.torPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SETTINGS.torPort;
  }
  if ("activeProfileId" in patch) {
    clean.activeProfileId = String(patch.activeProfileId || "");
  }
  if ("excludedHosts" in patch) {
    clean.excludedHosts = Array.isArray(patch.excludedHosts) ? patch.excludedHosts.map(sanitizeHost).filter(Boolean).slice(0, 200) : [];
  }
  return clean;
}

function publicContentSettings(settings) {
  return {
    fingerprintShield: settings.fingerprintShield,
    storageShield: settings.storageShield,
    sensorShield: settings.sensorShield,
    piiShield: settings.piiShield,
    behaviorNoise: settings.behaviorNoise
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
  const rng = mulberry32(hashString(seedHex));
  const preset = pick(USER_AGENT_PRESETS, rng);
  const [width, height] = pick(preset.sizes, rng);
  const [webglVendor, webglRenderer] = pick(preset.webgl, rng);
  const chromePart = extractChromePart(globalThis.navigator?.userAgent || "");

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
    randomization: {
      profileId: `PRF-${randomHex(4).toUpperCase()}`,
      seedHex,
      model: preset.label,
      userAgent: `Mozilla/5.0 (${preset.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) ${chromePart} Safari/537.36`,
      platform: preset.platform,
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
      canvasNoiseSeed: randomHex(16),
      audioNoiseSeed: randomHex(16),
      behaviorJitterSeed: randomHex(16),
      trackerRuleSalt: randomHex(16),
      salts: {
        storage: randomHex(16),
        indexedDB: randomHex(16),
        cache: randomHex(16),
        broadcastChannel: randomHex(16)
      }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

async function applyControls() {
  const settings = await getSettings();
  await Promise.all([applyProxy(settings), applyPrivacySettings(settings)]);
}

async function applyProxy(settings) {
  if (!settings.enabled || !settings.torEnabled) {
    await clearChromeSetting(chrome.proxy.settings);
    return;
  }

  await setChromeSetting(chrome.proxy.settings, {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: "socks5", host: settings.torHost, port: settings.torPort },
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

  await Promise.all([
    setChromeSetting(chrome.privacy?.network?.networkPredictionEnabled, false),
    setChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy, "disable_non_proxied_udp"),
    setChromeSetting(chrome.privacy?.services?.alternateErrorPagesEnabled, false),
    settings.blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillAddressEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillAddressEnabled),
    settings.blockAutofill ? setChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled, false) : clearChromeSetting(chrome.privacy?.services?.autofillCreditCardEnabled),
    setChromeSetting(chrome.privacy?.services?.searchSuggestEnabled, false),
    setChromeSetting(chrome.privacy?.services?.spellingServiceEnabled, false),
    setChromeSetting(chrome.privacy?.services?.translationServiceEnabled, false),
    setChromeSetting(chrome.privacy?.websites?.thirdPartyCookiesAllowed, false),
    setChromeSetting(chrome.privacy?.websites?.hyperlinkAuditingEnabled, false),
    settings.blockReferrers ? setChromeSetting(chrome.privacy?.websites?.referrersEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.referrersEnabled),
    setChromeSetting(chrome.privacy?.websites?.doNotTrackEnabled, true),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.topicsEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.topicsEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.fledgeEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.fledgeEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.adMeasurementEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.adMeasurementEnabled),
    settings.blockTopics ? setChromeSetting(chrome.privacy?.websites?.relatedWebsiteSetsEnabled, false) : clearChromeSetting(chrome.privacy?.websites?.relatedWebsiteSetsEnabled),
    setChromeSetting(chrome.privacy?.websites?.protectedContentEnabled, false)
  ]);
}

async function updateDynamicRules() {
  const settings = await getSettings();
  const profile = getProfile(settings, settings.activeProfileId) || settings.profiles[0];
  const addRules = [];

  if (settings.enabled && settings.networkHeaders && profile) {
    addRules.push({
      id: HEADER_RULE_ID,
      priority: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "DNT", operation: "set", value: "1" },
          { header: "Cache-Control", operation: "set", value: "no-store" },
          { header: "Pragma", operation: "set", value: "no-cache" },
          { header: "Accept-Language", operation: "set", value: profile.randomization.acceptLanguage },
          { header: "User-Agent", operation: "set", value: profile.randomization.userAgent }
        ]
      },
      condition: { regexFilter: "^https?://", resourceTypes: RESOURCE_TYPES }
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
      condition: { regexFilter: "^https?://", domainType: "thirdParty", resourceTypes: RESOURCE_TYPES }
    });
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
      condition: { regexFilter: "^https?://", resourceTypes: RESOURCE_TYPES }
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: DYNAMIC_RULE_IDS, addRules }).catch(() => {});
}

async function getTelemetry() {
  const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
  const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets().catch(() => []);
  return { dynamicRuleCount: dynamicRules.length, staticRulesetCount: enabledRulesets.length };
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

async function notifyAllTabs(extra = {}) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(() => []);
  await Promise.all(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, { type: "signalonly:update", ...extra }).catch(() => {}) : null));
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
  const text = !settings.enabled ? "" : assignment ? (assignment.enabled ? "SITE" : "OFF") : "";
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
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
  return settings.excludedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
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

function pick(values, rng) {
  return values[Math.floor(rng() * values.length)];
}

function extractChromePart(userAgent) {
  const match = userAgent.match(/(?:Chrome|Chromium)\/[\d.]+/);
  return match ? match[0].replace("Chromium/", "Chrome/") : "Chrome/140.0.0.0";
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
