const switchButtons = [...document.querySelectorAll(".switch-control[data-setting]")];
const moduleButtons = [...document.querySelectorAll(".module-switch[data-module]")];
const torHost = document.getElementById("torHost");
const torPort = document.getElementById("torPort");
const globalState = document.getElementById("globalState");
const torStatus = document.getElementById("torStatus");
const activeHost = document.getElementById("activeHost");
const activeProfileName = document.getElementById("activeProfileName");
const profileId = document.getElementById("profileId");
const siteCount = document.getElementById("siteCount");
const statusLine = document.getElementById("statusLine");
const buildStatus = document.getElementById("buildStatus");
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
const disableSiteButton = document.getElementById("disableSiteButton");
const saveProfileButton = document.getElementById("saveProfileButton");
const deleteProfileButton = document.getElementById("deleteProfileButton");
const duplicateProfileButton = document.getElementById("duplicateProfileButton");
const regenerateProfileButton = document.getElementById("regenerateProfileButton");
const newProfileButton = document.getElementById("newProfileButton");
const exportConfigButton = document.getElementById("exportConfigButton");
const importConfigButton = document.getElementById("importConfigButton");
const configBuffer = document.getElementById("configBuffer");

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

siteEnabled.addEventListener("click", () => {
  siteEnabled.setAttribute("aria-pressed", String(siteEnabled.getAttribute("aria-pressed") !== "true"));
});

siteProfile.addEventListener("change", () => {
  selectedProfileId = siteProfile.value;
  render();
});

profileName.addEventListener("input", () => {
  const profile = currentProfile();
  if (profile) {
    profile.name = profileName.value;
    renderProfileList();
  }
});

profileCodeInput.addEventListener("input", () => {
  const profile = currentProfile();
  if (profile) {
    profile.code = profileCodeInput.value;
    renderProfileList();
  }
});

profileAccent.addEventListener("input", () => {
  const profile = currentProfile();
  if (profile) {
    profile.accent = profileAccent.value;
    render();
  }
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
    enabled: siteEnabled.getAttribute("aria-pressed") === "true"
  });
  setStatus(result?.ok ? "Site profile applied" : result?.error || "Site profile failed");
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
}

function renderGlobal(profile) {
  switchButtons.forEach((button) => {
    const key = button.dataset.setting;
    button.setAttribute("aria-pressed", String(Boolean(settings[key])));
  });

  torHost.value = settings.torHost || "127.0.0.1";
  torPort.value = settings.torPort || 9050;
  buildStatus.textContent = "BUILD 04.30";
  globalState.textContent = settings.enabled ? "Enabled" : "Disabled";
  torStatus.textContent = settings.enabled && settings.torEnabled ? `${settings.torHost}:${settings.torPort}` : "Disabled";
  activeHost.textContent = context.host || "No active tab";
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
    button.innerHTML = `
      <i class="swatch" style="background:${profile.accent}"></i>
      <span><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.code)} / ${escapeHtml(profile.randomization?.profileId || profile.id)}</small></span>
      <small>${escapeHtml(profile.randomization?.model || "PROFILE")}</small>
    `;
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
  document.getElementById("storageSalt").textContent = shortHex(randomization.salts?.storage);
  document.getElementById("indexedDbSalt").textContent = shortHex(randomization.salts?.indexedDB);
  document.getElementById("cacheSalt").textContent = shortHex(randomization.salts?.cache);
  document.getElementById("channelSalt").textContent = shortHex(randomization.salts?.broadcastChannel);
  document.getElementById("randomProfileId").textContent = randomization.profileId || "--";
  document.getElementById("randomSeed").textContent = shortHex(randomization.seedHex, 16);
  document.getElementById("randomLanguage").textContent = Array.isArray(randomization.languages) ? randomization.languages.join(", ") : randomization.language || "--";
  document.getElementById("randomHardware").textContent = `${randomization.hardwareConcurrency || "--"} cores / ${randomization.deviceMemory || "--"} GB`;
  document.getElementById("canvasSeed").textContent = shortHex(randomization.canvasNoiseSeed);
  document.getElementById("audioSeed").textContent = shortHex(randomization.audioNoiseSeed);
  document.getElementById("behaviorSeed").textContent = shortHex(randomization.behaviorJitterSeed);
  document.getElementById("trackerSalt").textContent = shortHex(randomization.trackerRuleSalt);

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
    empty.innerHTML = "<b>No site profiles configured</b><span>Local index empty</span><span>--</span><span>--</span>";
    siteTable.append(empty);
    return;
  }

  entries.forEach(([host, assignment]) => {
    const profile = getProfile(assignment.profileId);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "site-row";
    row.innerHTML = `
      <b>${escapeHtml(host)}</b>
      <span>${escapeHtml(profile?.name || assignment.profileId)}</span>
      <span>${assignment.enabled ? "Active" : "Disabled"}</span>
      <span>${escapeHtml(profile?.code || "--")}</span>
    `;
    row.addEventListener("click", () => {
      siteHost.value = host;
      selectedProfileId = assignment.profileId;
      siteEnabled.setAttribute("aria-pressed", String(Boolean(assignment.enabled)));
      render();
    });
    siteTable.append(row);
  });
}

function collectGlobal() {
  settings.torHost = torHost.value.trim() || "127.0.0.1";
  settings.torPort = Number(torPort.value) || 9050;
}

function collectProfile() {
  const profile = structuredClone(currentProfile());
  profile.name = profileName.value.trim() || profile.name;
  profile.code = profileCodeInput.value.trim() || profile.code;
  profile.accent = profileAccent.value || profile.accent;
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
    torEnabled: source.torEnabled,
    torHost: source.torHost,
    torPort: source.torPort,
    privacyControls: source.privacyControls,
    fingerprintShield: source.fingerprintShield,
    storageShield: source.storageShield,
    sensorShield: source.sensorShield,
    piiShield: source.piiShield,
    behaviorNoise: source.behaviorNoise,
    networkHeaders: source.networkHeaders,
    thirdPartyIsolation: source.thirdPartyIsolation,
    blockTopics: source.blockTopics,
    blockAutofill: source.blockAutofill,
    blockReferrers: source.blockReferrers,
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
