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
const reloadBanner = document.getElementById("reloadBanner");
const reloadButton = document.getElementById("reloadButton");
const cookieSlotSelect = document.getElementById("cookieSlotSelect");
const cookieScopeLabel = document.getElementById("cookieScopeLabel");
const cookieScopeButton = document.getElementById("cookieScopeButton");
const saveCookieSlotButton = document.getElementById("saveCookieSlotButton");
const restoreCookieSlotButton = document.getElementById("restoreCookieSlotButton");
const cloneCookieSlotButton = document.getElementById("cloneCookieSlotButton");
const cookieStatus = document.getElementById("cookieStatus");
const siteToggleButton = document.querySelector(".switch[data-site-toggle='enabled']");
const siteModuleButtons = [...document.querySelectorAll(".switch[data-site-module]")];
const globalSettingButtons = [...document.querySelectorAll(".switch[data-global-setting]")];

let settings = {};
let context = {};
let selectedProfile = null;
// Local edits to the current site's modules / enabled state, not yet saved.
let pendingSiteModules = null;
let pendingSiteEnabled = null;

init();

async function init() {
  const state = await send({ type: "getState" });
  if (!state?.ok) {
    hostState.textContent = "Extension unavailable";
    return;
  }
  hydrate(state);
}

siteToggleButton?.addEventListener("click", () => {
  if (!context.host) return;
  const current = pendingSiteEnabled ?? Boolean(context.assignment?.enabled);
  pendingSiteEnabled = !current;
  render();
});

siteModuleButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!context.host) return;
    const key = button.dataset.siteModule;
    const modules = ensurePendingModules();
    const previousModules = structuredClone(modules);
    modules[key] = !modules[key];
    render();
    if (context.assignment) {
      // Live-update existing assignment.
      const result = await send({ type: "updateSiteModules", host: context.host, modules });
      if (result?.ok) {
        hydrate(result);
      } else {
        pendingSiteModules = previousModules;
        render();
        hostNote.textContent = result?.error || "Site module save failed";
      }
    }
  });
});

globalSettingButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const key = button.dataset.globalSetting;
    const previousValue = settings[key];
    settings[key] = !settings[key];
    render();
    const state = await saveGlobal();
    if (state?.ok) {
      hydrate(state);
    } else {
      settings[key] = previousValue;
      render();
      hostNote.textContent = state?.error || "Global setting save failed";
    }
  });
});

profileSelect.addEventListener("change", () => {
  selectedProfile = settings.profiles.find((p) => p.id === profileSelect.value) || settings.profiles[0];
  render();
});

cookieSlotSelect.addEventListener("change", async () => {
  if (!context.host || !cookieSlotSelect.value) return;
  const result = await send({ type: "switchCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  if (result?.ok) hydrate(result);
  else cookieStatus.textContent = result?.error || "Cookie slot switch failed";
});

cookieScopeButton.addEventListener("click", async () => {
  if (!context.host) return;
  const nextScope = context.cookieSession?.scope === "host" ? "domain" : "host";
  const result = await send({ type: "updateCookieSlotScope", host: context.host, scope: nextScope });
  if (result?.ok) hydrate(result);
  else cookieStatus.textContent = result?.error || "Cookie scope update failed";
});

saveCookieSlotButton.addEventListener("click", async () => {
  if (!context.host) return;
  const result = await send({ type: "saveCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  if (result?.ok) hydrate(result);
  cookieStatus.textContent = formatCookieStatus(result?.cookieStatus) || result?.error || "Cookie save failed";
});

restoreCookieSlotButton.addEventListener("click", async () => {
  if (!context.host) return;
  const result = await send({ type: "restoreCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  if (result?.ok) hydrate(result);
  cookieStatus.textContent = formatCookieStatus(result?.cookieStatus) || result?.error || "Cookie restore failed";
});

cloneCookieSlotButton.addEventListener("click", async () => {
  if (!context.host) return;
  const name = prompt("Name for the new cookie slot", nextCookieSlotName()) || "";
  const result = await send({ type: "cloneCookieSlot", host: context.host, name });
  if (result?.ok) hydrate(result);
  cookieStatus.textContent = formatCookieStatus(result?.cookieStatus) || result?.error || "Cookie clone failed";
});

applyButton.addEventListener("click", async () => {
  if (!context.host) return;
  if (context.excluded) {
    hostNote.textContent = "Excluded: direct route / shields off. Remove the exclusion in Settings.";
    return;
  }
  // Tri-state resolution: explicit pending value wins; otherwise existing assignment;
  // otherwise default to enabled for a brand-new assignment created by this click.
  const enabled = pendingSiteEnabled !== null
    ? pendingSiteEnabled
    : context.assignment
      ? Boolean(context.assignment.enabled)
      : true;
  const modules = pendingSiteModules || ensurePendingModules();
  const result = await send({
    type: "applySiteProfile",
    host: context.host,
    profileId: selectedProfile?.id,
    enabled,
    modules,
    clearCookies: false
  });
  if (result?.ok) {
    if (result.jarSaved || result.jarRestored) {
      hostNote.textContent = `Cookie jar swap: saved ${result.jarSaved}, restored ${result.jarRestored}`;
    } else if (result.cookiesCleared > 0) {
      hostNote.textContent = `Applied - ${result.cookiesCleared} cookie${result.cookiesCleared !== 1 ? "s" : ""} cleared`;
    }
    pendingSiteEnabled = null;
    pendingSiteModules = null;
    hydrate(result);
  } else {
    hostNote.textContent = result?.error || "Site profile apply failed";
  }
});

resetButton.addEventListener("click", async () => {
  if (!context.host) return;
  const ok = confirm(`WIPE ${context.host}?\n\nThis removes the SignalOnly site rule and clears current cookies plus browser storage for this site.`);
  if (!ok) return;
  const result = await send({ type: "wipeSite", host: context.host });
  if (result?.ok) {
    pendingSiteEnabled = null;
    pendingSiteModules = null;
    hydrate(result);
    hostNote.textContent = `Wiped site: ${result.cookiesCleared || 0} cookie${result.cookiesCleared === 1 ? "" : "s"} cleared`;
  } else {
    hostNote.textContent = result?.error || "Site wipe failed";
  }
});

optionsButton.addEventListener("click", () => send({ type: "openOptions" }));
reloadButton?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (tab?.id) chrome.tabs.reload(tab.id);
});

function ensurePendingModules() {
  if (!pendingSiteModules) {
    pendingSiteModules = structuredClone(
      context.assignment?.modules
      || context.effectiveModules
      || { fingerprint: true, storage: false, sensors: true, behavior: false, piiShield: false, blockServiceWorkers: false,
           cleanup: { recommendations: true, comments: true, metrics: true, overlays: true, sticky: false, motion: true } }
    );
  }
  return pendingSiteModules;
}

function hydrate(state) {
  settings = state.settings;
  context = state.context || {};
  selectedProfile = context.currentProfile || settings.profiles[0];
  if (state.version) versionTag.textContent = `v${state.version}`;
  renderProfiles();
  renderCookieSlots();
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
  const hasSupportedPage = Boolean(context.host);

  hostState.textContent = context.host || "No supported page";
  if (!hasSupportedPage) {
    hostCell.dataset.state = "default";
    hostNote.textContent = "Open an http or https page to assign a profile";
  } else if (context.excluded) {
    hostCell.dataset.state = "excluded";
    hostNote.textContent = "Excluded: direct route / shields off";
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

  reloadBanner.hidden = !context.reloadRequired;

  profileSelect.disabled = !hasSupportedPage;
  cookieSlotSelect.disabled = !hasSupportedPage;
  cookieScopeButton.disabled = !hasSupportedPage;
  saveCookieSlotButton.disabled = !hasSupportedPage;
  restoreCookieSlotButton.disabled = !hasSupportedPage;
  cloneCookieSlotButton.disabled = !hasSupportedPage;
  applyButton.disabled = !hasSupportedPage;
  resetButton.disabled = !hasSupportedPage;

  proxyState.textContent = settings.enabled && settings.proxyEnabled
    ? `${settings.proxyHost}:${settings.proxyPort}` : "Disabled";

  if (!settings.enabled || !settings.privacyControls) {
    webrtcState.textContent = "Default";
  } else if (settings.webRtcMode === "strict" || settings.proxyEnabled) {
    webrtcState.textContent = "Strict";
  } else if (settings.webRtcMode === "off") {
    webrtcState.textContent = "Browser default";
  } else {
    webrtcState.textContent = "Public IP Only";
  }

  profileId.textContent = selectedProfile?.randomization?.profileId || "PROFILE --";

  // Site enable toggle.
  const siteEnabledNow = pendingSiteEnabled ?? Boolean(context.assignment?.enabled);
  if (siteToggleButton) {
    siteToggleButton.disabled = !hasSupportedPage || context.excluded;
    siteToggleButton.setAttribute("aria-pressed", String(siteEnabledNow));
  }

  // Per-site module switches.
  const moduleSource = pendingSiteModules || context.assignment?.modules || context.effectiveModules || {};
  siteModuleButtons.forEach((button) => {
    const key = button.dataset.siteModule;
    const unavailable = !hasSupportedPage || context.excluded;
    button.disabled = unavailable;
    const value = unavailable ? false : Boolean(moduleSource[key]);
    button.setAttribute("aria-pressed", String(value));
    button.title = unavailable ? "Unavailable on this page" : "";
  });

  // Global setting buttons.
  globalSettingButtons.forEach((button) => {
    const key = button.dataset.globalSetting;
    button.setAttribute("aria-pressed", String(Boolean(settings[key])));
  });
}

function renderCookieSlots() {
  const session = context.cookieSession;
  cookieSlotSelect.textContent = "";
  (session?.slots || [{ id: "main", name: "Main", cookieCount: 0 }]).forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot.id;
    option.textContent = `${slot.name} (${slot.cookieCount || 0})`;
    cookieSlotSelect.append(option);
  });
  cookieSlotSelect.value = session?.activeSlotId || "main";
  cookieScopeLabel.textContent = session?.scope === "host"
    ? `Split: ${session.scopeHost}`
    : `Shared: ${session?.scopeHost || "domain"}`;
  cookieScopeButton.textContent = session?.scope === "host" ? "Share Domain" : "Split Subdomains";
  cookieStatus.textContent = formatCookieStatus(session?.lastStatus)
    || "Cookie slots swap saved cookies. Storage isolation uses profile salts.";
}

function formatCookieStatus(status) {
  if (!status) return "";
  const parts = [];
  if (status.saved) parts.push(`${status.saved} saved`);
  if (status.cleared) parts.push(`${status.cleared} cleared`);
  if (status.restored) parts.push(`${status.restored} restored`);
  if (status.expired) parts.push(`${status.expired} expired`);
  if (status.blocked) parts.push(`${status.blocked} blocked`);
  if (status.error) parts.push(status.error);
  return parts.length ? parts.join(" / ") : "Cookie jar ready";
}

function nextCookieSlotName() {
  const count = context.cookieSession?.slots?.length || 1;
  return `Alt ${count}`;
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
  try { return await chrome.runtime.sendMessage(message); }
  catch (error) { return { ok: false, error: error.message }; }
}
