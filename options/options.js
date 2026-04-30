const switchButtons = [...document.querySelectorAll(".switch-control[data-setting]")];
const moduleButtons = [...document.querySelectorAll(".module-switch[data-module]")];
const proxyHostInput = document.getElementById("proxyHost");
const proxyPortInput = document.getElementById("proxyPort");
const webRtcSelect = document.getElementById("webRtcMode");
const globalState = document.getElementById("globalState");
const proxyStatus = document.getElementById("proxyStatus");
const activeHost = document.getElementById("activeHost");
const activeHostNote = document.getElementById("activeHostNote");
const activeProfileName = document.getElementById("activeProfileName");
const profileId = document.getElementById("profileId");
const siteCount = document.getElementById("siteCount");
const statusLine = document.getElementById("statusLine");
const versionTag = document.getElementById("versionTag");
const profileList = document.getElementById("profileList");
const siteProfile = document.getElementById("siteProfile");
const siteHost = document.getElementById("siteHost");
const siteEnabled = document.getElementById("siteEnabled");
const siteTable = document.getElementById("siteTable");
const profileName = document.getElementById("profileName");
const profileCodeInput = document.getElementById("profileCodeInput");
const profileAccent = document.getElementById("profileAccent");
const saveGlobalButton = document.getElementById("saveGlobalButton");
const applySiteButton = document.getElementById("applySiteButton");
const resetSiteButton = document.getElementById("resetSiteButton");
const clearSiteCookiesButton = document.getElementById("clearSiteCookiesButton");
const disableSiteButton = document.getElementById("disableSiteButton");
const saveProfileButton = document.getElementById("saveProfileButton");
const deleteProfileButton = document.getElementById("deleteProfileButton");
const duplicateProfileButton = document.getElementById("duplicateProfileButton");
const regenerateProfileButton = document.getElementById("regenerateProfileButton");
const newProfileButton = document.getElementById("newProfileButton");
const exportConfigButton = document.getElementById("exportConfigButton");
const importConfigButton = document.getElementById("importConfigButton");
const configBuffer = document.getElementById("configBuffer");
const exclusionInput = document.getElementById("exclusionInput");
const exclusionList = document.getElementById("exclusionList");
const addExclusionButton = document.getElementById("addExclusionButton");
const resetExclusionsButton = document.getElementById("resetExclusionsButton");

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

let settings = {};
let context = {};
let selectedProfileId = "";

init();

async function init() {
  const state = await send({ type: "getState" });
  if (!state?.ok) {
    setStatus("Extension unavailable");
    return;
  }
  hydrate(state);
}

switchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.setting;
    settings[key] = !settings[key];
    render();
  });
});

moduleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const profile = currentProfile();
    if (!profile) {
      return;
    }
    const key = button.dataset.module;
    profile.modules[key] = !profile.modules[key];
    renderProfileEditor();
  });
});

webRtcSelect.addEventListener("change", () => {
  settings.webRtcMode = webRtcSelect.value;
});

siteEnabled.addEventListener("click", () => {
  siteEnabled.setAttribute("aria-pressed", String(siteEnabled.getAttribute("aria-pressed") !== "true"));
});

siteProfile.addEventListener("change", () => {
  selectedProfileId = siteProfile.value;
  render();
});

profileName.addEventListener("input", () => {

  const listButtons = profileList.querySelectorAll("button");
  const profile = currentProfile();
  if (profile) {
    listButtons.forEach((button) => {
      if (button.getAttribute("aria-pressed") === "true") {
        const titleEl = button.querySelector("b");
        if (titleEl) titleEl.textContent = profileName.value || profile.name;
      }
    });
  }
});

profileCodeInput.addEventListener("input", () => {

});

profileAccent.addEventListener("input", () => {

  document.documentElement.style.setProperty("--accent", profileAccent.value || "#ff006e");
});

saveGlobalButton.addEventListener("click", async () => {
  collectGlobal();
  const state = await send({ type: "saveSettings", settings: pickGlobalSettings(settings) });
  setStatus(state?.ok ? "Settings saved" : "Settings save failed");
  if (state?.ok) {
    hydrate(state);
  }
});

applySiteButton.addEventListener("click", async () => {
  const result = await send({
    type: "applySiteProfile",
    host: selectedHost(),
    profileId: siteProfile.value || selectedProfileId,
    enabled: siteEnabled.getAttribute("aria-pressed") === "true",
    clearCookies: true
  });
  const suffix = result?.cookiesCleared > 0 ? ` (${result.cookiesCleared} cookies cleared)` : "";
  setStatus(result?.ok ? `Site profile applied${suffix}` : result?.error || "Site profile failed");
  if (result?.ok) {
    hydrate(result);
  }
});

disableSiteButton.addEventListener("click", async () => {
  const result = await send({
    type: "applySiteProfile",
    host: selectedHost(),
    profileId: siteProfile.value || selectedProfileId,
    enabled: false
  });
  setStatus(result?.ok ? "Current site profile disabled" : result?.error || "Disable failed");
  if (result?.ok) {
    hydrate(result);
  }
});

resetSiteButton.addEventListener("click", async () => {
  const result = await send({ type: "resetSiteProfile", host: selectedHost() });
  setStatus(result?.ok ? "Current site reset" : result?.error || "Reset failed");
  if (result?.ok) {
    hydrate(result);
  }
});

clearSiteCookiesButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) {
    setStatus("No host selected");
    return;
  }
  const result = await send({ type: "clearSiteCookies", host });
  if (result?.ok) {
    setStatus(`Cleared ${result.cleared} cookie${result.cleared !== 1 ? "s" : ""} for ${host}`);
  } else {
    setStatus(result?.error || "Cookie clear failed");
  }
});

saveProfileButton.addEventListener("click", async () => {
  const profile = collectProfile();
  const result = await send({ type: "saveProfile", profile });
  setStatus(result?.ok ? "Profile saved" : result?.error || "Profile save failed");
  if (result?.ok) {
    selectedProfileId = profile.id;
    hydrate(result);
  }
});

newProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "createProfile" });
  setStatus(result?.ok ? "New randomized profile created" : result?.error || "Profile create failed");
  if (result?.ok) {
    selectedProfileId = result.settings.activeProfileId;
    hydrate(result);
  }
});

duplicateProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "duplicateProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile duplicated exactly" : result?.error || "Profile duplicate failed");
  if (result?.ok) {
    selectedProfileId = result.settings.activeProfileId;
    hydrate(result);
  }
});

regenerateProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "regenerateProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile randomization regenerated" : result?.error || "Profile regenerate failed");
  if (result?.ok) {
    hydrate(result);
  }
});

deleteProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "deleteProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile deleted" : result?.error || "Profile delete failed");
  if (result?.ok) {
    selectedProfileId = result.settings.activeProfileId;
    hydrate(result);
  }
});

addExclusionButton.addEventListener("click", async () => {
  const candidate = (exclusionInput.value || "").trim().toLowerCase();
  if (!candidate) return;
  const next = [...new Set([...(settings.excludedHosts || []), candidate])];
  const result = await send({ type: "saveSettings", settings: { excludedHosts: next } });
  if (result?.ok) {
    exclusionInput.value = "";
    setStatus(`Added ${candidate} to exclusions`);
    hydrate(result);
  }
});

resetExclusionsButton.addEventListener("click", async () => {
  const merged = [...new Set([...(settings.excludedHosts || []), ...DEFAULT_EXCLUDED_HOSTS])];
  const result = await send({ type: "saveSettings", settings: { excludedHosts: merged } });
  setStatus(result?.ok ? "Default exclusions restored" : "Failed");
  if (result?.ok) hydrate(result);
});

exportConfigButton.addEventListener("click", async () => {
  const result = await send({ type: "exportConfig" });
  if (result?.ok) {
    configBuffer.value = JSON.stringify(result.config, null, 2);
    setStatus("Configuration exported");
  } else {
    setStatus(result?.error || "Export failed");
  }
});

importConfigButton.addEventListener("click", async () => {
  const result = await send({ type: "importConfig", config: configBuffer.value });
  setStatus(result?.ok ? "Configuration imported" : result?.error || "Import failed");
  if (result?.ok) {
    hydrate(result);
  }
});

function hydrate(state) {
  settings = state.settings || {};
  context = state.context || {};
  selectedProfileId = settings.profiles?.some((profile) => profile.id === selectedProfileId)
    ? selectedProfileId
    : context.currentProfile?.id || settings.activeProfileId || settings.profiles?.[0]?.id || "";
  if (!siteHost.value) {
    siteHost.value = context.host || "";
  }
  if (state.version) {
    versionTag.textContent = `v${state.version}`;
  }
  render();
}

function render() {
  const profile = currentProfile();
  document.documentElement.style.setProperty("--accent", profile?.accent || "#ff006e");
  renderGlobal(profile);
  renderProfileSelect();
  renderProfileList();
  renderProfileEditor();
  renderSiteTable();
  renderExclusionList();
}

function renderGlobal(profile) {
  switchButtons.forEach((button) => {
    const key = button.dataset.setting;
    button.setAttribute("aria-pressed", String(Boolean(settings[key])));
  });

  proxyHostInput.value = settings.proxyHost || "127.0.0.1";
  proxyPortInput.value = settings.proxyPort || 9050;
  webRtcSelect.value = settings.webRtcMode || "soft";
  globalState.textContent = settings.enabled ? "Enabled" : "Disabled";
  proxyStatus.textContent = settings.enabled && settings.proxyEnabled ? `${settings.proxyHost}:${settings.proxyPort}` : "Disabled";

  activeHost.textContent = context.host || "No active tab";
  if (context.defaultExcluded) {
    activeHostNote.textContent = "Auth/payment - protected default";
  } else if (context.excluded) {
    activeHostNote.textContent = "User-excluded";
  } else if (context.assignment?.enabled) {
    activeHostNote.textContent = `Assigned: ${profile?.name || ""}`;
  } else if (context.assignment) {
    activeHostNote.textContent = "Assigned (paused)";
  } else {
    activeHostNote.textContent = settings.applyShieldsGlobally ? "Global mode" : "Not assigned";
  }

  activeProfileName.textContent = profile ? `${profile.name} / ${profile.code}` : "No profile";
  profileId.textContent = profile?.randomization?.profileId || "PROFILE --";
  siteCount.textContent = String(Object.keys(settings.siteAssignments || {}).length).padStart(3, "0");
}

function renderProfileSelect() {
  siteProfile.textContent = "";
  (settings.profiles || []).forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.code})`;
    siteProfile.append(option);
  });
  siteProfile.value = selectedProfileId;
}

function renderProfileList() {
  profileList.textContent = "";
  (settings.profiles || []).forEach((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(profile.id === selectedProfileId));

    const swatch = document.createElement("i");
    swatch.className = "swatch";
    swatch.style.background = profile.accent;
    button.append(swatch);

    const meta = document.createElement("span");
    const title = document.createElement("b");
    title.textContent = profile.name;
    const sub = document.createElement("small");
    sub.textContent = `${profile.code} / ${profile.randomization?.profileId || profile.id}`;
    meta.append(title, sub);
    button.append(meta);

    const model = document.createElement("small");
    model.textContent = profile.randomization?.model || "PROFILE";
    button.append(model);

    button.addEventListener("click", () => {
      selectedProfileId = profile.id;
      render();
    });
    profileList.append(button);
  });
}

function renderProfileEditor() {
  const profile = currentProfile();
  if (!profile) {
    return;
  }

  const randomization = profile.randomization || {};
  profileName.value = profile.name || "";
  profileCodeInput.value = profile.code || "";
  profileAccent.value = profile.accent || "#ff006e";
  document.getElementById("profileEditorTitle").textContent = profile.name || "Profile";
  document.getElementById("profileModel").textContent = randomization.model || "--";
  document.getElementById("profileTimezone").textContent = randomization.timezone || "--";
  document.getElementById("profileScreen").textContent = randomization.screen ? `${randomization.screen.width}x${randomization.screen.height} @ ${randomization.screen.devicePixelRatio}` : "--";
  document.getElementById("profileWebgl").textContent = randomization.webglRenderer || "--";
  document.getElementById("randomProfileId").textContent = randomization.profileId || "--";
  document.getElementById("randomSeed").textContent = shortHex(randomization.seedHex, 16);
  document.getElementById("randomAccent").textContent = profile.accent || "--";
  document.getElementById("randomOsBrowser").textContent = `${randomization.model || "--"} / ${randomization.platform || "--"}`;
  document.getElementById("randomLanguage").textContent = Array.isArray(randomization.languages) ? randomization.languages.join(", ") : randomization.language || "--";
  document.getElementById("randomTimezone").textContent = randomization.timezone || "--";
  document.getElementById("randomScreen").textContent = randomization.screen ? `${randomization.screen.width}x${randomization.screen.height} @ ${randomization.screen.devicePixelRatio}` : "--";
  document.getElementById("randomHardware").textContent = `${randomization.hardwareConcurrency || "--"} cores / ${randomization.deviceMemory || "--"} GB`;
  document.getElementById("canvasSeed").textContent = shortHex(randomization.canvasNoiseSeed);
  document.getElementById("audioSeed").textContent = shortHex(randomization.audioNoiseSeed);
  document.getElementById("behaviorSeed").textContent = shortHex(randomization.behaviorJitterSeed);
  document.getElementById("trackerSalt").textContent = shortHex(randomization.trackerRuleSalt);
  document.getElementById("storageSalt").textContent = shortHex(randomization.salts?.storage);
  document.getElementById("indexedDbSalt").textContent = shortHex(randomization.salts?.indexedDB);
  document.getElementById("cacheSalt").textContent = shortHex(randomization.salts?.cache);
  document.getElementById("channelSalt").textContent = shortHex(randomization.salts?.broadcastChannel);

  const cookiePolicySelect = document.getElementById("profileCookiePolicy");
  if (cookiePolicySelect) {
    cookiePolicySelect.value = profile.cookiePolicy || "keep";
  }
  const cookieCapInput = document.getElementById("cookieExpiryCapDays");
  if (cookieCapInput) {
    cookieCapInput.value = settings.cookieExpiryCapDays ?? 7;
  }

  moduleButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(Boolean(profile.modules?.[button.dataset.module])));
  });
}

function renderSiteTable() {
  siteTable.textContent = "";
  const entries = Object.entries(settings.siteAssignments || {});
  const currentAssignment = context.assignment;
  siteEnabled.setAttribute("aria-pressed", String(Boolean(currentAssignment?.enabled)));

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "site-row";
    empty.textContent = "No site profiles configured - local index empty";
    siteTable.append(empty);
    return;
  }

  entries.forEach(([host, assignment]) => {
    const profile = getProfile(assignment.profileId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "site-row";

    const hostCell = document.createElement("b");
    hostCell.textContent = host;
    const profileCell = document.createElement("span");
    profileCell.textContent = profile?.name || assignment.profileId;
    const statusCell = document.createElement("span");
    statusCell.textContent = assignment.enabled ? "Active" : "Disabled";
    const codeCell = document.createElement("span");
    codeCell.textContent = profile?.code || "--";
    row.append(hostCell, profileCell, statusCell, codeCell);

    row.addEventListener("click", () => {
      siteHost.value = host;
      selectedProfileId = assignment.profileId;
      siteEnabled.setAttribute("aria-pressed", String(Boolean(assignment.enabled)));
      render();
    });
    siteTable.append(row);
  });
}

function renderExclusionList() {
  exclusionList.textContent = "";
  const items = settings.excludedHosts || [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "exclusion-row";
    empty.textContent = "No exclusions - defaults still enforced";
    exclusionList.append(empty);
    return;
  }

  items.forEach((host) => {
    const row = document.createElement("div");
    row.className = "exclusion-row";

    const label = document.createElement("b");
    label.textContent = host;
    row.append(label);

    const isDefault = DEFAULT_EXCLUDED_HOSTS.includes(host);
    const tag = document.createElement("span");
    tag.textContent = isDefault ? "Default" : "Custom";
    row.append(tag);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      const next = (settings.excludedHosts || []).filter((entry) => entry !== host);
      const result = await send({ type: "saveSettings", settings: { excludedHosts: next } });
      if (result?.ok) {
        setStatus(`Removed ${host}${isDefault ? " (defaults still enforced internally)" : ""}`);
        hydrate(result);
      }
    });
    row.append(removeButton);

    exclusionList.append(row);
  });
}

function collectGlobal() {
  settings.proxyHost = proxyHostInput.value.trim() || "127.0.0.1";
  settings.proxyPort = Number(proxyPortInput.value) || 9050;
  settings.webRtcMode = webRtcSelect.value || "soft";
  const cookieCapInput = document.getElementById("cookieExpiryCapDays");
  if (cookieCapInput) {
    settings.cookieExpiryCapDays = Number(cookieCapInput.value) || 0;
  }
}

function collectProfile() {
  const profile = structuredClone(currentProfile());
  profile.name = profileName.value.trim() || profile.name;
  profile.code = profileCodeInput.value.trim() || profile.code;
  profile.accent = profileAccent.value || profile.accent;
  const cookiePolicySelect = document.getElementById("profileCookiePolicy");
  if (cookiePolicySelect) {
    profile.cookiePolicy = cookiePolicySelect.value || "keep";
  }
  moduleButtons.forEach((button) => {
    profile.modules[button.dataset.module] = button.getAttribute("aria-pressed") === "true";
  });
  return profile;
}

function currentProfile() {
  return getProfile(selectedProfileId) || settings.profiles?.[0];
}

function getProfile(id) {
  return (settings.profiles || []).find((profile) => profile.id === id);
}

function selectedHost() {
  return siteHost.value.trim() || context.host || "";
}

function pickGlobalSettings(source) {
  return {
    enabled: source.enabled,
    proxyEnabled: source.proxyEnabled,
    proxyHost: source.proxyHost,
    proxyPort: source.proxyPort,
    privacyControls: source.privacyControls,
    webRtcMode: source.webRtcMode,
    fingerprintShield: source.fingerprintShield,
    storageShield: source.storageShield,
    sensorShield: source.sensorShield,
    piiShield: source.piiShield,
    behaviorNoise: source.behaviorNoise,
    networkHeaders: source.networkHeaders,
    spoofUserAgentHeader: source.spoofUserAgentHeader,
    thirdPartyIsolation: source.thirdPartyIsolation,
    blockTrackingHeaders: source.blockTrackingHeaders,
    blockServiceWorkers: source.blockServiceWorkers,
    applyShieldsGlobally: source.applyShieldsGlobally,
    blockTopics: source.blockTopics,
    blockAutofill: source.blockAutofill,
    blockReferrers: source.blockReferrers,
    autoClearOnSwitch: source.autoClearOnSwitch,
    cookieExpiryCapDays: source.cookieExpiryCapDays,
    activeProfileId: selectedProfileId,
    excludedHosts: source.excludedHosts
  };
}

function setStatus(text) {
  statusLine.textContent = text;
}

function shortHex(value, length = 10) {
  return value ? `${String(value).slice(0, length).toUpperCase()}...` : "--";
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
