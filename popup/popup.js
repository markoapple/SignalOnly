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
const cookieScopeLabel = document.getElementById("cookieScopeLabel");
const cookieSlotSelect = document.getElementById("cookieSlotSelect");
const saveCookieSlotButton = document.getElementById("saveCookieSlotButton");
const restoreCookieSlotButton = document.getElementById("restoreCookieSlotButton");
const cloneCookieSlotButton = document.getElementById("cloneCookieSlotButton");
const cookieScopeButton = document.getElementById("cookieScopeButton");
const cookieSlotNote = document.getElementById("cookieSlotNote");
const siteToggleButton = document.querySelector(".switch[data-site-toggle='enabled']");
const siteModuleButtons = [...document.querySelectorAll(".switch[data-site-module]")];

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

profileSelect.addEventListener("change", () => {
  selectedProfile = settings.profiles.find((p) => p.id === profileSelect.value) || settings.profiles[0];
  render();
});

applyButton.addEventListener("click", async () => {
  if (!context.host) return;
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

cookieSlotSelect?.addEventListener("change", async () => {
  if (!context.host || !cookieSlotSelect.value) return;
  setCookieBusy(true);
  const result = await send({ type: "switchCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  applyCookieResult(result, "Cookie slot switched");
});

saveCookieSlotButton?.addEventListener("click", async () => {
  if (!context.host) return;
  setCookieBusy(true);
  const result = await send({ type: "saveCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  applyCookieResult(result, "Cookie slot saved");
});

restoreCookieSlotButton?.addEventListener("click", async () => {
  if (!context.host) return;
  setCookieBusy(true);
  const result = await send({ type: "restoreCookieSlot", host: context.host, slotId: cookieSlotSelect.value });
  applyCookieResult(result, "Cookie slot restored");
});

cloneCookieSlotButton?.addEventListener("click", async () => {
  if (!context.host) return;
  const name = prompt("New cookie slot name", nextSlotName());
  if (name === null) return;
  setCookieBusy(true);
  const result = await send({ type: "cloneCookieSlot", host: context.host, name });
  applyCookieResult(result, "Cookie slot cloned");
});

cookieScopeButton?.addEventListener("click", async () => {
  if (!context.host) return;
  const current = context.cookieSession?.scope || "domain";
  const next = current === "host" ? "domain" : "host";
  setCookieBusy(true);
  const result = await send({ type: "updateCookieSlotScope", host: context.host, scope: next });
  applyCookieResult(result, `Cookie scope set to ${next === "host" ? "split subdomains" : "shared domain"}`);
});

function ensurePendingModules() {
  if (!pendingSiteModules) {
    const modules = structuredClone(
      context.assignment?.modules
      || context.effectiveModules
      || { fingerprint: true, storage: false, sensors: true, behavior: false, piiShield: false, blockServiceWorkers: false }
    );
    if (!context.assignment) modules.cleanup = cleanupOff();
    pendingSiteModules = modules;
  }
  return pendingSiteModules;
}

function cleanupOff() {
  return { recommendations: false, comments: false, metrics: false, overlays: false, sticky: false, motion: false };
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

  profileSelect.disabled = !hasSupportedPage;
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
    siteToggleButton.disabled = !hasSupportedPage;
    siteToggleButton.setAttribute("aria-pressed", String(siteEnabledNow));
  }

  // Per-site module switches.
  const moduleSource = pendingSiteModules || context.assignment?.modules || context.effectiveModules || {};
  siteModuleButtons.forEach((button) => {
    const key = button.dataset.siteModule;
    const unavailable = !hasSupportedPage;
    button.disabled = unavailable;
    const value = unavailable ? false : Boolean(moduleSource[key]);
    button.setAttribute("aria-pressed", String(value));
    button.title = unavailable ? "Unavailable on this page" : "";
  });

  renderCookieControls();
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
  cookieScopeLabel.textContent = session?.scope === "host"
    ? `Split Subdomains / ${session.scopeHost || context.host || "--"}`
    : `Shared Domain / ${session?.scopeHost || context.host || "--"}`;
  const activeSlot = session?.slots?.find((slot) => slot.id === session.activeSlotId);
  if (activeSlot) {
    const count = Number(activeSlot.cookieCount || 0);
    cookieSlotNote.textContent = `${activeSlot.name || activeSlot.id}: ${count} cookie${count === 1 ? "" : "s"}${activeSlot.savedAt ? ` / saved ${new Date(activeSlot.savedAt).toLocaleString()}` : ""}`;
  } else if (disabled) {
    cookieSlotNote.textContent = hasSupportedPage ? "Cookie slots disabled for excluded hosts." : "Open an http or https page to use cookie slots.";
  } else {
    cookieSlotNote.textContent = "No saved slot yet. Save the current site jar to create one.";
  }
  [cookieSlotSelect, saveCookieSlotButton, restoreCookieSlotButton, cloneCookieSlotButton, cookieScopeButton].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function setCookieBusy(isBusy) {
  [cookieSlotSelect, saveCookieSlotButton, restoreCookieSlotButton, cloneCookieSlotButton, cookieScopeButton].forEach((el) => {
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
    cookieSlotNote.textContent = result?.error || "Cookie slot action failed";
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
