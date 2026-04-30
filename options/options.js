const switchButtons = [...document.querySelectorAll(".switch-control[data-setting]")];
const moduleButtons = [...document.querySelectorAll(".module-switch[data-module]")];
const siteModuleButtons = [...document.querySelectorAll(".module-switch[data-site-module]")];
const siteCleanupButtons = [...document.querySelectorAll(".module-switch[data-site-cleanup]")];
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
const siteCookiePolicy = document.getElementById("siteCookiePolicy");
const siteTable = document.getElementById("siteTable");
const jarTable = document.getElementById("jarTable");
const refreshJarsButton = document.getElementById("refreshJarsButton");
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
const excludeCurrentSiteButton = document.getElementById("excludeCurrentSiteButton");
const removeCurrentExclusionButton = document.getElementById("removeCurrentExclusionButton");
const proxyModeStatus = document.getElementById("proxyModeStatus");

let settings = {};
let context = {};
let defaults = {};
let telemetry = {};
let selectedProfileId = "";
let draftSiteModules = null;
let jars = [];

init();

async function init() {
  const state = await send({ type: "getState" });
  if (!state?.ok) { setStatus("Extension unavailable"); return; }
  hydrate(state);
  await refreshJars();
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
    if (!profile) return;
    const key = button.dataset.module;
    if (!profile.defaultCleanup) profile.defaultCleanup = {};
    profile.defaultCleanup[key] = !profile.defaultCleanup[key];
    renderProfileEditor();
  });
});

siteModuleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const modules = ensureDraftSiteModules();
    modules[button.dataset.siteModule] = !modules[button.dataset.siteModule];
    renderSiteEditor();
  });
});

siteCleanupButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const modules = ensureDraftSiteModules();
    modules.cleanup[button.dataset.siteCleanup] = !modules.cleanup[button.dataset.siteCleanup];
    renderSiteEditor();
  });
});

webRtcSelect.addEventListener("change", () => { settings.webRtcMode = webRtcSelect.value; });
siteEnabled.addEventListener("click", () => {
  siteEnabled.setAttribute("aria-pressed", String(siteEnabled.getAttribute("aria-pressed") !== "true"));
});
siteProfile.addEventListener("change", () => { selectedProfileId = siteProfile.value; render(); });
siteHost.addEventListener("change", () => { draftSiteModules = null; render(); });

profileName.addEventListener("input", () => {
  const profile = currentProfile();
  if (!profile) return;
  profileList.querySelectorAll("button").forEach((btn) => {
    if (btn.getAttribute("aria-pressed") === "true") {
      const titleEl = btn.querySelector("b");
      if (titleEl) titleEl.textContent = profileName.value || profile.name;
    }
  });
});
profileCodeInput.addEventListener("input", () => {});
profileAccent.addEventListener("input", () => {
  document.documentElement.style.setProperty("--accent", profileAccent.value || "#ff006e");
});

saveGlobalButton.addEventListener("click", async () => {
  collectGlobal();
  const state = await send({ type: "saveSettings", settings: pickGlobalSettings(settings) });
  setStatus(state?.ok ? "Settings saved" : "Settings save failed");
  if (state?.ok) hydrate(state);
});

applySiteButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) { setStatus("No host selected"); return; }
  const modules = ensureDraftSiteModules();
  const result = await send({
    type: "applySiteProfile", host,
    profileId: siteProfile.value || selectedProfileId,
    enabled: siteEnabled.getAttribute("aria-pressed") === "true",
    clearCookies: false,
    modules,
    cookiePolicy: siteCookiePolicy?.value || ""
  });
  let suffix = "";
  if (result?.jarSaved || result?.jarRestored) suffix = ` (jar saved ${result.jarSaved}, restored ${result.jarRestored})`;
  else if (result?.cookiesCleared > 0) suffix = ` (${result.cookiesCleared} cookies cleared)`;
  setStatus(result?.ok ? `Site profile applied${suffix}` : result?.error || "Site profile failed");
  if (result?.ok) { draftSiteModules = null; hydrate(result); await refreshJars(); }
});

disableSiteButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) return;
  const result = await send({
    type: "applySiteProfile", host,
    profileId: siteProfile.value || selectedProfileId,
    enabled: false,
    modules: ensureDraftSiteModules(),
    cookiePolicy: siteCookiePolicy?.value || ""
  });
  setStatus(result?.ok ? "Current site profile disabled" : result?.error || "Disable failed");
  if (result?.ok) { draftSiteModules = null; hydrate(result); }
});

resetSiteButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) return;
  const result = await send({ type: "resetSiteProfile", host });
  setStatus(result?.ok ? "Current site reset" : result?.error || "Reset failed");
  if (result?.ok) { draftSiteModules = null; hydrate(result); await refreshJars(); }
});

clearSiteCookiesButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) { setStatus("No host selected"); return; }
  const result = await send({ type: "clearSiteCookies", host });
  setStatus(result?.ok ? `Cleared ${result.cleared} cookie${result.cleared !== 1 ? "s" : ""} for ${host}` : result?.error || "Cookie clear failed");
});

saveProfileButton.addEventListener("click", async () => {
  const profile = collectProfile();
  const result = await send({ type: "saveProfile", profile });
  setStatus(result?.ok ? "Profile saved" : result?.error || "Profile save failed");
  if (result?.ok) { selectedProfileId = profile.id; hydrate(result); }
});

newProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "createProfile" });
  setStatus(result?.ok ? "New randomized profile created" : result?.error || "Profile create failed");
  if (result?.ok) { selectedProfileId = result.settings.activeProfileId; hydrate(result); }
});
duplicateProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "duplicateProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile duplicated exactly" : result?.error || "Profile duplicate failed");
  if (result?.ok) { selectedProfileId = result.settings.activeProfileId; hydrate(result); }
});
regenerateProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "regenerateProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile randomization regenerated" : result?.error || "Profile regenerate failed");
  if (result?.ok) hydrate(result);
});
deleteProfileButton.addEventListener("click", async () => {
  const result = await send({ type: "deleteProfile", profileId: selectedProfileId });
  setStatus(result?.ok ? "Profile deleted" : result?.error || "Profile delete failed");
  if (result?.ok) { selectedProfileId = result.settings.activeProfileId; hydrate(result); await refreshJars(); }
});

addExclusionButton.addEventListener("click", async () => {
  const candidate = exclusionInput.value || "";
  if (!candidate.trim()) return;
  const result = await send({ type: "addExclusion", host: candidate });
  if (result?.ok) { exclusionInput.value = ""; setStatus(`Added ${result.host} to exclusions`); hydrate(result); }
  else setStatus(result?.error || "Add exclusion failed");
});
resetExclusionsButton.addEventListener("click", async () => {
  const result = await send({ type: "restoreDefaultExclusions" });
  setStatus(result?.ok ? "Default exclusions restored" : result?.error || "Restore failed");
  if (result?.ok) hydrate(result);
});
excludeCurrentSiteButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) { setStatus("No host selected"); return; }
  const result = await send({ type: "addExclusion", host });
  setStatus(result?.ok ? `Excluded ${result.host}` : result?.error || "Exclude failed");
  if (result?.ok) hydrate(result);
});
removeCurrentExclusionButton.addEventListener("click", async () => {
  const host = selectedHost();
  if (!host) { setStatus("No host selected"); return; }
  const result = await send({ type: "removeExclusion", host });
  setStatus(result?.ok ? `Removed ${result.host} from exclusions` : result?.error || "Remove failed");
  if (result?.ok) hydrate(result);
});
refreshJarsButton?.addEventListener("click", async () => { await refreshJars(); });

exportConfigButton.addEventListener("click", async () => {
  const result = await send({ type: "exportConfig" });
  if (result?.ok) {
    configBuffer.value = JSON.stringify(result.config, null, 2);
    setStatus("Configuration exported");
  } else setStatus(result?.error || "Export failed");
});
importConfigButton.addEventListener("click", async () => {
  const result = await send({ type: "importConfig", config: configBuffer.value });
  setStatus(result?.ok ? "Configuration imported" : result?.error || "Import failed");
  if (result?.ok) { hydrate(result); await refreshJars(); }
});

async function refreshJars() {
  const result = await send({ type: "getCookieJars" });
  if (result?.ok) { jars = result.jars || []; renderJars(); }
}

function hydrate(state) {
  settings = state.settings || {};
  context = state.context || {};
  defaults = state.defaults || {};
  telemetry = state.telemetry || {};
  selectedProfileId = settings.profiles?.some((p) => p.id === selectedProfileId)
    ? selectedProfileId
    : context.currentProfile?.id || settings.activeProfileId || settings.profiles?.[0]?.id || "";
  if (!siteHost.value) siteHost.value = context.host || "";
  if (state.version) versionTag.textContent = `v${state.version}`;
  render();
}

function render() {
  const profile = currentProfile();
  document.documentElement.style.setProperty("--accent", profile?.accent || "#ff006e");
  renderGlobal(profile);
  renderProfileSelect();
  renderProfileList();
  renderProfileEditor();
  renderSiteEditor();
  renderSiteTable();
  renderExclusionList();
  renderJars();
}

function renderGlobal(profile) {
  const hasSupportedPage = Boolean(context.host);
  switchButtons.forEach((b) => b.setAttribute("aria-pressed", String(Boolean(settings[b.dataset.setting]))));
  proxyHostInput.value = settings.proxyHost || "127.0.0.1";
  proxyPortInput.value = settings.proxyPort || 9150;
  webRtcSelect.value = settings.webRtcMode || "soft";
  globalState.textContent = settings.enabled ? "Enabled" : "Disabled";
  proxyStatus.textContent = settings.enabled && settings.proxyEnabled ? `${settings.proxyHost}:${settings.proxyPort}` : "Disabled";
  proxyModeStatus.textContent = telemetry.proxyMode ? `Mode: ${telemetry.proxyMode}` : "";
  activeHost.textContent = context.host || "No supported page";
  if (!hasSupportedPage) activeHostNote.textContent = "Open an http or https page for current-site actions";
  else if (context.excluded) activeHostNote.textContent = "Excluded: direct route / shields off";
  else if (context.assignment?.enabled) activeHostNote.textContent = `Assigned: ${profile?.name || ""}`;
  else if (context.assignment) activeHostNote.textContent = "Assigned (paused)";
  else activeHostNote.textContent = settings.applyShieldsGlobally ? "Global mode" : "Not assigned";
  activeProfileName.textContent = profile ? `${profile.name} / ${profile.code}` : "No profile";
  profileId.textContent = profile?.randomization?.profileId || "PROFILE --";
  siteCount.textContent = String(Object.keys(settings.siteAssignments || {}).length).padStart(3, "0");
  [excludeCurrentSiteButton, removeCurrentExclusionButton].forEach((b) => { b.disabled = !hasSupportedPage; });
}

function renderProfileSelect() {
  siteProfile.textContent = "";
  (settings.profiles || []).forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = `${p.name} (${p.code})`;
    siteProfile.append(o);
  });
  siteProfile.value = selectedProfileId;
}

function renderProfileList() {
  profileList.textContent = "";
  (settings.profiles || []).forEach((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(profile.id === selectedProfileId));
    const swatch = document.createElement("i"); swatch.className = "swatch"; swatch.style.background = profile.accent;
    const meta = document.createElement("span");
    const title = document.createElement("b"); title.textContent = profile.name;
    const sub = document.createElement("small"); sub.textContent = `${profile.code} / ${profile.randomization?.profileId || profile.id}`;
    meta.append(title, sub);
    const model = document.createElement("small"); model.textContent = profile.randomization?.model || "PROFILE";
    button.append(swatch, meta, model);
    button.addEventListener("click", () => { selectedProfileId = profile.id; render(); });
    profileList.append(button);
  });
}

function renderProfileEditor() {
  const profile = currentProfile();
  if (!profile) return;
  const r = profile.randomization || {};
  profileName.value = profile.name || "";
  profileCodeInput.value = profile.code || "";
  profileAccent.value = profile.accent || "#ff006e";
  document.getElementById("profileEditorTitle").textContent = profile.name || "Profile";
  document.getElementById("profileModel").textContent = r.model || "--";
  document.getElementById("profileTimezone").textContent = r.timezone || "--";
  document.getElementById("profileScreen").textContent = r.screen ? `${r.screen.width}x${r.screen.height} @ ${r.screen.devicePixelRatio}` : "--";
  document.getElementById("profileWebgl").textContent = r.webglRenderer || "--";
  document.getElementById("randomProfileId").textContent = r.profileId || "--";
  document.getElementById("randomSeed").textContent = shortHex(r.seedHex, 16);
  document.getElementById("randomAccent").textContent = profile.accent || "--";
  document.getElementById("randomOsBrowser").textContent = `${r.model || "--"} / ${r.platform || "--"}`;
  document.getElementById("randomLanguage").textContent = Array.isArray(r.languages) ? r.languages.join(", ") : r.language || "--";
  document.getElementById("randomTimezone").textContent = r.timezone || "--";
  document.getElementById("randomScreen").textContent = r.screen ? `${r.screen.width}x${r.screen.height} @ ${r.screen.devicePixelRatio}` : "--";
  document.getElementById("randomHardware").textContent = `${r.hardwareConcurrency || "--"} cores / ${r.deviceMemory || "--"} GB`;
  document.getElementById("canvasSeed").textContent = shortHex(r.canvasNoiseSeed);
  document.getElementById("audioSeed").textContent = shortHex(r.audioNoiseSeed);
  document.getElementById("behaviorSeed").textContent = shortHex(r.behaviorJitterSeed);
  document.getElementById("trackerSalt").textContent = shortHex(r.trackerRuleSalt);
  document.getElementById("storageSalt").textContent = shortHex(r.salts?.storage);
  document.getElementById("indexedDbSalt").textContent = shortHex(r.salts?.indexedDB);
  document.getElementById("cacheSalt").textContent = shortHex(r.salts?.cache);
  document.getElementById("channelSalt").textContent = shortHex(r.salts?.broadcastChannel);
  document.getElementById("profileCookiePolicy").value = profile.cookiePolicy || "keep";
  const cookieCapInput = document.getElementById("cookieExpiryCapDays");
  if (cookieCapInput) cookieCapInput.value = settings.cookieExpiryCapDays ?? 7;
  moduleButtons.forEach((b) => b.setAttribute("aria-pressed", String(Boolean(profile.defaultCleanup?.[b.dataset.module]))));
}

function renderSiteEditor() {
  const host = selectedHost();
  const assignment = host ? (settings.siteAssignments || {})[host] : null;
  if (assignment) {
    siteProfile.value = assignment.profileId || selectedProfileId;
    siteEnabled.setAttribute("aria-pressed", String(Boolean(assignment.enabled)));
    if (siteCookiePolicy) siteCookiePolicy.value = assignment.cookiePolicy || "";
  } else if (siteCookiePolicy) {
    siteCookiePolicy.value = "";
  }
  const m = ensureDraftSiteModules();
  siteModuleButtons.forEach((b) => b.setAttribute("aria-pressed", String(Boolean(m[b.dataset.siteModule]))));
  siteCleanupButtons.forEach((b) => b.setAttribute("aria-pressed", String(Boolean(m.cleanup?.[b.dataset.siteCleanup]))));
}

function renderSiteTable() {
  siteTable.textContent = "";
  const entries = Object.entries(settings.siteAssignments || {});
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
    row.type = "button"; row.className = "site-row";
    const hostCell = document.createElement("b"); hostCell.textContent = host;
    const profileCell = document.createElement("span"); profileCell.textContent = profile?.name || assignment.profileId;
    const statusCell = document.createElement("span"); statusCell.textContent = assignment.enabled ? "Active" : "Disabled";
    const codeCell = document.createElement("span"); codeCell.textContent = profile?.code || "--";
    const moduleSummary = document.createElement("small");
    const m = assignment.modules || {};
    moduleSummary.textContent = [
      m.fingerprint ? "FP" : "", m.storage ? "STO" : "", m.sensors ? "SEN" : "",
      m.behavior ? "BEH" : "", m.piiShield ? "PII" : "", m.blockServiceWorkers ? "SW" : ""
    ].filter(Boolean).join(" ") || "-";
    row.append(hostCell, profileCell, statusCell, codeCell, moduleSummary);
    row.addEventListener("click", () => {
      siteHost.value = host;
      selectedProfileId = assignment.profileId;
      draftSiteModules = null;
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
    empty.textContent = "No exclusions configured";
    exclusionList.append(empty);
    return;
  }
  items.forEach((host) => {
    const row = document.createElement("div");
    row.className = "exclusion-row";
    const label = document.createElement("b"); label.textContent = host;
    row.append(label);
    const isDefault = (defaults.excludedHosts || []).includes(host);
    const isActive = context.host && (context.host === host || context.host.endsWith(`.${host}`));
    const tag = document.createElement("span");
    tag.textContent = [isDefault ? "Default" : "Custom", isActive ? "Active site" : ""].filter(Boolean).join(" / ");
    row.append(tag);
    const removeButton = document.createElement("button");
    removeButton.type = "button"; removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      const result = await send({ type: "removeExclusion", host });
      if (result?.ok) { setStatus(`Removed ${result.host} from exclusions`); hydrate(result); }
      else setStatus(result?.error || "Remove failed");
    });
    row.append(removeButton);
    exclusionList.append(row);
  });
}

function renderJars() {
  if (!jarTable) return;
  jarTable.textContent = "";
  if (!jars.length) {
    const empty = document.createElement("div");
    empty.className = "jar-row";
    empty.textContent = "No saved cookie jars";
    jarTable.append(empty);
    return;
  }
  jars.forEach((jar) => {
    const row = document.createElement("div");
    row.className = "jar-row";
    const profile = getProfile(jar.profileId);
    const host = document.createElement("b"); host.textContent = jar.host;
    const prof = document.createElement("span"); prof.textContent = profile ? `${profile.name} (${profile.code})` : jar.profileId;
    const count = document.createElement("span"); count.textContent = `${jar.cookieCount} cookies`;
    const date = document.createElement("small"); date.textContent = jar.savedAt ? new Date(jar.savedAt).toLocaleString() : "--";
    const del = document.createElement("button"); del.type = "button"; del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await send({ type: "deleteCookieJar", host: jar.host, profileId: jar.profileId });
      await refreshJars();
    });
    row.append(host, prof, count, date, del);
    jarTable.append(row);
  });
}

function collectGlobal() {
  settings.proxyHost = proxyHostInput.value.trim() || "127.0.0.1";
  settings.proxyPort = Number(proxyPortInput.value) || 9150;
  settings.webRtcMode = webRtcSelect.value || "soft";
  const cookieCapInput = document.getElementById("cookieExpiryCapDays");
  if (cookieCapInput) settings.cookieExpiryCapDays = Number(cookieCapInput.value) || 0;
}

function collectProfile() {
  const profile = structuredClone(currentProfile());
  profile.name = profileName.value.trim() || profile.name;
  profile.code = profileCodeInput.value.trim() || profile.code;
  profile.accent = profileAccent.value || profile.accent;
  const cps = document.getElementById("profileCookiePolicy");
  if (cps) profile.cookiePolicy = cps.value || "keep";
  if (!profile.defaultCleanup) profile.defaultCleanup = {};
  moduleButtons.forEach((b) => {
    profile.defaultCleanup[b.dataset.module] = b.getAttribute("aria-pressed") === "true";
  });
  return profile;
}

function ensureDraftSiteModules() {
  if (draftSiteModules) return draftSiteModules;
  const host = selectedHost();
  const assignment = host ? (settings.siteAssignments || {})[host] : null;
  const base = assignment?.modules
    || context.effectiveModules
    || defaults.siteModules
    || { fingerprint: true, storage: false, sensors: true, behavior: false, piiShield: false, blockServiceWorkers: false,
         cleanup: { recommendations: true, comments: true, metrics: true, overlays: true, sticky: false, motion: true } };
  draftSiteModules = structuredClone(base);
  if (!draftSiteModules.cleanup) draftSiteModules.cleanup = {};
  return draftSiteModules;
}

function currentProfile() { return getProfile(selectedProfileId) || settings.profiles?.[0]; }
function getProfile(id) { return (settings.profiles || []).find((profile) => profile.id === id); }
function selectedHost() { return siteHost.value.trim() || context.host || ""; }

function pickGlobalSettings(s) {
  return {
    enabled: s.enabled, proxyEnabled: s.proxyEnabled, proxyHost: s.proxyHost, proxyPort: s.proxyPort,
    privacyControls: s.privacyControls, webRtcMode: s.webRtcMode,
    fingerprintShield: s.fingerprintShield, storageShield: s.storageShield,
    sensorShield: s.sensorShield, piiShield: s.piiShield, behaviorNoise: s.behaviorNoise,
    networkHeaders: s.networkHeaders, spoofUserAgentHeader: s.spoofUserAgentHeader,
    thirdPartyIsolation: s.thirdPartyIsolation, blockTrackingHeaders: s.blockTrackingHeaders,
    blockServiceWorkers: s.blockServiceWorkers, applyShieldsGlobally: s.applyShieldsGlobally,
    blockTopics: s.blockTopics, blockAutofill: s.blockAutofill, blockReferrers: s.blockReferrers,
    autoClearOnSwitch: s.autoClearOnSwitch, cookieExpiryCapDays: s.cookieExpiryCapDays,
    activeProfileId: selectedProfileId, excludedHosts: s.excludedHosts
  };
}

function setStatus(text) { statusLine.textContent = text; }
function shortHex(value, length = 10) { return value ? `${String(value).slice(0, length).toUpperCase()}...` : "--"; }

async function send(message) {
  try { return await chrome.runtime.sendMessage(message); }
  catch (error) { return { ok: false, error: error.message }; }
}
