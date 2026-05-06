const AUTO_ROTATE_KEY = "signalonly.autoRotateFingerprint";

const profileSelect = document.getElementById("profileSelect");
const applyButton = document.getElementById("applyButton");
const resetButton = document.getElementById("resetButton");
const optionsButton = document.getElementById("optionsButton");
const hostState = document.getElementById("hostState");
const hostNote = document.getElementById("hostNote");
const hostCell = document.querySelector(".status-host");
const proxyState = document.getElementById("proxyState");
const webrtcState = document.getElementById("webrtcState");
const autoRotateState = document.getElementById("autoRotateState");
const profileId = document.getElementById("profileId");
const versionTag = document.getElementById("versionTag");
const reloadBanner = document.getElementById("reloadBanner");
const reloadButton = document.getElementById("reloadButton");
const cookieScopeLabel = document.getElementById("cookieScopeLabel");
const cookieSlotSelect = document.getElementById("cookieSlotSelect");
const cloneCookieSlotButton = document.getElementById("cloneCookieSlotButton");
const cookieSlotNote = document.getElementById("cookieSlotNote");
const siteToggleButton = document.querySelector(".switch[data-site-toggle='enabled']");
const siteModuleButtons = [...document.querySelectorAll(".switch[data-site-module]")];

let settings = {};
let context = {};
let selectedProfile = null;
let autoRotateEnabled = false;
let savingSite = false;

init();

async function init() {
  await hydrateAutoRotate();
  const state = await send({ type: "getState" });
  if (!state?.ok) {
    hostState.textContent = "Extension unavailable";
    return;
  }
  hydrate(state);
}

siteToggleButton?.addEventListener("click", async () => {
  if (!context.host || savingSite) return;
  const current = Boolean(context.assignment?.enabled);
  await saveCurrentSite({ enabled: !current });
});

siteModuleButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!context.host || savingSite) return;
    const key = button.dataset.siteModule;
    const modules = currentSiteModules();
    modules[key] = !modules[key];
    await saveCurrentSite({ modules, enabled: context.assignment ? Boolean(context.assignment.enabled) : true });
  });
});

profileSelect.addEventListener("change", async () => {
  selectedProfile = settings.profiles.find((p) => p.id === profileSelect.value) || settings.profiles[0];
  render();
  if (context.host && context.assignment) {
    await saveCurrentSite({ profileId: selectedProfile?.id, enabled: Boolean(context.assignment.enabled) });
  }
});

applyButton.addEventListener("click", async () => {
  if (!context.host || savingSite) return;
  if (context.excluded) {
    const removal = await send({ type: "removeExclusion", host: context.host });
    if (!removal?.ok) {
      hostNote.textContent = removal?.error || "Could not remove exclusion";
      return;
    }
    context = removal.context || context;
    settings = removal.settings || settings;
  }
  if (context.excluded) {
    hostNote.textContent = "Excluded: direct route / shields off. Remove the exclusion in Settings.";
    return;
  }
  await saveCurrentSite({ enabled: context.assignment ? Boolean(context.assignment.enabled) : true });
});

resetButton.addEventListener("click", async () => {
  if (!context.host) return;
  const ok = confirm(`WIPE ${context.host}?\n\nThis removes the SignalOnly site rule and clears current cookies plus browser storage for this site.`);
  if (!ok) return;
  const result = await send({ type: "wipeSite", host: context.host });
  if (result?.ok) {
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

cookieSlotSelect?.addEventListener("change", async () => {
  if (!context.host || !cookieSlotSelect.value) return;
  setCookieBusy(true);
  const result = await send({ type: "switchCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  applyCookieResult(result, "Cookie identity switched");
});

cloneCookieSlotButton?.addEventListener("click", async () => {
  if (!context.host) return;
  setCookieBusy(true);
  const result = await send({ type: "cloneCookieSlot", host: context.host, name: nextSlotName() });
  applyCookieResult(result, "New cookie identity created");
});

async function hydrateAutoRotate() {
  try {
    const data = await chrome.storage.sync.get(AUTO_ROTATE_KEY);
    autoRotateEnabled = Boolean(data[AUTO_ROTATE_KEY]);
  } catch {
    autoRotateEnabled = false;
  }
}

async function saveCurrentSite(overrides = {}) {
  if (!context.host) return;
  savingSite = true;
  setSiteBusy(true);
  const modules = overrides.modules || currentSiteModules();
  const result = await send({
    type: "applySiteProfile",
    host: context.host,
    profileId: overrides.profileId || selectedProfile?.id || context.assignment?.profileId,
    enabled: "enabled" in overrides ? Boolean(overrides.enabled) : (context.assignment ? Boolean(context.assignment.enabled) : true),
    modules,
    clearCookies: false
  });
  savingSite = false;
  setSiteBusy(false);
  if (result?.ok) {
    hydrate(result);
    if (result.jarSaved || result.jarRestored) {
      hostNote.textContent = `Saved. Cookie jar swap: saved ${result.jarSaved}, restored ${result.jarRestored}`;
    } else if (result.cookiesCleared > 0) {
      hostNote.textContent = `Saved - ${result.cookiesCleared} cookie${result.cookiesCleared !== 1 ? "s" : ""} cleared`;
    } else {
      hostNote.textContent = "Saved. Reload if the page already read browser signals.";
    }
  } else {
    render();
    hostNote.textContent = result?.error || "Site profile save failed";
  }
}

function currentSiteModules() {
  return structuredClone(
    context.assignment?.modules
    || context.effectiveModules
    || { fingerprint: true, storage: false, sensors: true, behavior: false, piiShield: false, blockServiceWorkers: false, cleanup: cleanupOff() }
  );
}

function cleanupOff() {
  return { recommendations: false, comments: false, metrics: false, overlays: false, sticky: false, motion: false };
}

function hydrate(state) {
  settings = state.settings || {};
  context = state.context || {};
  selectedProfile = context.currentProfile || settings.profiles?.[0] || null;
  if (state.version) versionTag.textContent = `v${state.version}`;
  renderProfiles();
  renderCookieSlots();
  render();
}

function renderProfiles() {
  profileSelect.textContent = "";
  (settings.profiles || []).forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} (${profile.code})`;
    profileSelect.append(option);
  });
  profileSelect.value = selectedProfile?.id || settings.activeProfileId || "";
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
    hostNote.textContent = "Excluded: click Apply to enable SignalOnly here";
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

  profileSelect.disabled = !hasSupportedPage || savingSite;
  applyButton.disabled = !hasSupportedPage || savingSite;
  resetButton.disabled = !hasSupportedPage || savingSite;

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

  autoRotateState.textContent = autoRotateEnabled ? "Rotating" : "Stable";
  profileId.textContent = selectedProfile?.randomization?.profileId || "PROFILE --";

  if (siteToggleButton) {
    siteToggleButton.disabled = !hasSupportedPage || savingSite || context.excluded;
    siteToggleButton.setAttribute("aria-pressed", String(Boolean(context.assignment?.enabled)));
  }

  const moduleSource = context.assignment?.modules || context.effectiveModules || {};
  siteModuleButtons.forEach((button) => {
    const key = button.dataset.siteModule;
    const unavailable = !hasSupportedPage || savingSite || context.excluded;
    button.disabled = unavailable;
    const value = unavailable ? false : Boolean(moduleSource[key]);
    button.setAttribute("aria-pressed", String(value));
    button.title = unavailable ? "Unavailable on this page" : "Auto-saves for this site";
  });

  renderCookieControls();
}

function setSiteBusy(isBusy) {
  [siteToggleButton, applyButton, profileSelect, ...siteModuleButtons].forEach((el) => {
    if (el) el.disabled = isBusy || !context.host || context.excluded;
  });
}

function renderCookieSlots() {
  const session = context.cookieSession;
  cookieSlotSelect.textContent = "";
  const slots = session?.slots?.length ? session.slots : [{ id: "main", name: "Main", active: true, cookieCount: 0 }];
  slots.forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot.id;
    const count = Number(slot.cookieCount || 0);
    option.textContent = `${slot.name || slot.id} (${count})`;
    cookieSlotSelect.append(option);
  });
  cookieSlotSelect.value = session?.activeSlotId || slots.find((slot) => slot.active)?.id || "main";
}

function renderCookieControls() {
  const hasSupportedPage = Boolean(context.host);
  const session = context.cookieSession;
  const disabled = !hasSupportedPage || context.excluded;
  cookieScopeLabel.textContent = session?.scope === "host" ? "Split Subdomains" : "Shared Domain";
  const activeSlot = session?.slots?.find((slot) => slot.id === session.activeSlotId);
  if (activeSlot) {
    const count = Number(activeSlot.cookieCount || 0);
    cookieSlotNote.textContent = `${activeSlot.name || activeSlot.id}: ${count} cookie${count === 1 ? "" : "s"}. Switching saves current cookies first.`;
  } else if (disabled) {
    cookieSlotNote.textContent = hasSupportedPage ? "Cookie identities disabled for excluded hosts." : "Open an http or https page to use cookie identities.";
  } else {
    cookieSlotNote.textContent = "Use Main or create a new alt from the current cookies.";
  }
  [cookieSlotSelect, cloneCookieSlotButton].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function setCookieBusy(isBusy) {
  [cookieSlotSelect, cloneCookieSlotButton].forEach((el) => {
    if (el) el.disabled = isBusy || !context.host || context.excluded;
  });
}

function applyCookieResult(result, fallbackMessage) {
  setCookieBusy(false);
  if (result?.ok) {
    const status = result.cookieStatus;
    hydrate(result);
    cookieSlotNote.textContent = formatCookieStatus(status, fallbackMessage);
  } else {
    renderCookieControls();
    cookieSlotNote.textContent = result?.error || "Cookie identity action failed";
  }
}

function formatCookieStatus(status, fallbackMessage) {
  if (!status) return fallbackMessage;
  const parts = [];
  if (status.saved) parts.push(`${status.saved} saved`);
  if (status.cleared) parts.push(`${status.cleared} cleared`);
  if (status.restored) parts.push(`${status.restored} restored`);
  if (status.expired) parts.push(`${status.expired} expired`);
  if (status.blocked) parts.push(`${status.blocked} blocked`);
  if (status.error) parts.push(status.error);
  return parts.length ? parts.join(" / ") : fallbackMessage;
}

function nextSlotName() {
  const count = context.cookieSession?.slots?.length || 1;
  return `Alt ${count}`;
}

async function send(message) {
  try { return await chrome.runtime.sendMessage(message); }
  catch (error) { return { ok: false, error: error.message }; }
}
