const profileSelect = document.getElementById("profileSelect");
const applyButton = document.getElementById("applyButton");
const resetButton = document.getElementById("resetButton");
const optionsButton = document.getElementById("optionsButton");
const hostState = document.getElementById("hostState");
const hostNote = document.getElementById("hostNote");
const hostCell = document.querySelector(".status-host");
const proxyState = document.getElementById("proxyState");
const webrtcState = document.getElementById("webrtcState");
const profileId = document.getElementById("profileId");
const versionTag = document.getElementById("versionTag");
const switches = [...document.querySelectorAll(".switch[data-setting]")];

let settings = {};
let context = {};
let selectedProfile = null;

init();

async function init() {
  const state = await send({ type: "getState" });
  if (!state?.ok) {
    hostState.textContent = "Extension unavailable";
    return;
  }
  hydrate(state);
}

switches.forEach((button) => {
  button.addEventListener("click", async () => {
    const key = button.dataset.setting;
    settings[key] = !settings[key];
    render();
    const state = await saveGlobal();
    if (state?.ok) {
      hydrate(state);
    }
  });
});

profileSelect.addEventListener("change", () => {
  selectedProfile = settings.profiles.find((profile) => profile.id === profileSelect.value) || settings.profiles[0];
  render();
});

applyButton.addEventListener("click", async () => {
  if (!context.host) return;
  if (context.defaultExcluded) {
    hostNote.textContent = "Auth/payment domain — protected by default. Remove from exclusions in Settings to override.";
    return;
  }
  await saveGlobal();
  const result = await send({
    type: "applySiteProfile",
    host: context.host,
    profileId: selectedProfile?.id,
    enabled: true,
    clearCookies: true
  });
  if (result?.ok) {
    if (result.cookiesCleared > 0) {
      hostNote.textContent = `Applied — ${result.cookiesCleared} cookie${result.cookiesCleared !== 1 ? "s" : ""} cleared`;
    }
    hydrate(result);
  }
});

resetButton.addEventListener("click", async () => {
  if (!context.host) return;
  const result = await send({ type: "resetSiteProfile", host: context.host });
  if (result?.ok) {
    hydrate(result);
  }
});

optionsButton.addEventListener("click", () => {
  send({ type: "openOptions" });
});

function hydrate(state) {
  settings = state.settings;
  context = state.context || {};
  selectedProfile = context.currentProfile || settings.profiles[0];
  if (state.version) {
    versionTag.textContent = `v${state.version}`;
  }
  renderProfiles();
  render();
}

function renderProfiles() {
  profileSelect.textContent = "";
  settings.profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.code})`;
    profileSelect.append(option);
  });
  profileSelect.value = selectedProfile?.id || settings.activeProfileId;
}

function render() {
  document.documentElement.style.setProperty("--accent", selectedProfile?.accent || "#ff006e");

  hostState.textContent = context.host || "No supported page";
  if (context.defaultExcluded) {
    hostCell.dataset.state = "excluded";
    hostNote.textContent = "Auth/payment — shields off by default";
  } else if (context.excluded) {
    hostCell.dataset.state = "excluded";
    hostNote.textContent = "User-excluded";
  } else if (context.assignment?.enabled) {
    hostCell.dataset.state = "active";
    hostNote.textContent = `Assigned: ${context.currentProfile?.name || ""}`;
  } else if (context.assignment) {
    hostCell.dataset.state = "paused";
    hostNote.textContent = "Assigned but paused";
  } else {
    hostCell.dataset.state = "default";
    hostNote.textContent = settings.applyShieldsGlobally ? "Global mode" : "Not assigned";
  }

  proxyState.textContent = settings.enabled && settings.proxyEnabled
    ? `${settings.proxyHost}:${settings.proxyPort}`
    : "Disabled";

  if (!settings.enabled || !settings.privacyControls) {
    webrtcState.textContent = "Default";
  } else if (settings.webRtcMode === "strict" || settings.proxyEnabled) {
    webrtcState.textContent = "Strict";
  } else if (settings.webRtcMode === "off") {
    webrtcState.textContent = "Default";
  } else {
    webrtcState.textContent = "Soft (public-only)";
  }

  profileId.textContent = selectedProfile?.randomization?.profileId || "PROFILE --";

  switches.forEach((button) => {
    const active = Boolean(settings[button.dataset.setting]);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function saveGlobal() {
  return await send({
    type: "saveSettings",
    settings: {
      enabled: settings.enabled,
      proxyEnabled: settings.proxyEnabled,
      proxyHost: settings.proxyHost,
      proxyPort: settings.proxyPort,
      privacyControls: settings.privacyControls,
      webRtcMode: settings.webRtcMode,
      fingerprintShield: settings.fingerprintShield,
      storageShield: settings.storageShield,
      sensorShield: settings.sensorShield,
      piiShield: settings.piiShield,
      behaviorNoise: settings.behaviorNoise,
      networkHeaders: settings.networkHeaders,
      spoofUserAgentHeader: settings.spoofUserAgentHeader,
      thirdPartyIsolation: settings.thirdPartyIsolation,
      blockTrackingHeaders: settings.blockTrackingHeaders,
      blockServiceWorkers: settings.blockServiceWorkers,
      applyShieldsGlobally: settings.applyShieldsGlobally,
      blockTopics: settings.blockTopics,
      blockAutofill: settings.blockAutofill,
      blockReferrers: settings.blockReferrers,
      autoClearOnSwitch: settings.autoClearOnSwitch,
      cookieExpiryCapDays: settings.cookieExpiryCapDays,
      activeProfileId: selectedProfile?.id || settings.activeProfileId,
      excludedHosts: settings.excludedHosts
    }
  });
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
