const profileSelect = document.getElementById("profileSelect");
const applyButton = document.getElementById("applyButton");
const resetButton = document.getElementById("resetButton");
const optionsButton = document.getElementById("optionsButton");
const hostState = document.getElementById("hostState");
const proxyState = document.getElementById("proxyState");
const webrtcState = document.getElementById("webrtcState");
const profileId = document.getElementById("profileId");
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
  await saveGlobal();
  const result = await send({
    type: "applySiteProfile",
    host: context.host,
    profileId: selectedProfile?.id,
    enabled: true
  });
  if (result?.ok) {
    hydrate(result);
  }
});

resetButton.addEventListener("click", async () => {
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
  proxyState.textContent = settings.enabled && settings.torEnabled ? `${settings.torHost}:${settings.torPort}` : "Disabled";
  webrtcState.textContent = settings.enabled && settings.privacyControls ? "Blocked" : "Default";
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
      torEnabled: settings.torEnabled,
      torHost: settings.torHost,
      torPort: settings.torPort,
      privacyControls: settings.privacyControls,
      fingerprintShield: settings.fingerprintShield,
      storageShield: settings.storageShield,
      sensorShield: settings.sensorShield,
      piiShield: settings.piiShield,
      behaviorNoise: settings.behaviorNoise,
      networkHeaders: settings.networkHeaders,
      thirdPartyIsolation: settings.thirdPartyIsolation,
      blockTopics: settings.blockTopics,
      blockAutofill: settings.blockAutofill,
      blockReferrers: settings.blockReferrers,
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
