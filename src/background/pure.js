export const DEFAULT_SITE_MODULES = Object.freeze({
  fingerprint: true,
  storage: false,
  sensors: true,
  behavior: false,
  piiShield: false,
  blockServiceWorkers: false,
  cleanup: {
    recommendations: true,
    comments: true,
    metrics: true,
    overlays: true,
    sticky: false,
    motion: true
  }
});

export function sanitizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "");
}

export function normalizeHostList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(sanitizeHost).filter(Boolean))].slice(0, 200);
}

export function matchesDomainList(host, list) {
  if (!host || !Array.isArray(list)) return false;
  return list.some((entry) => entry && (host === entry || host.endsWith(`.${entry}`)));
}

export function sanitizeSiteModules(modules) {
  if (!modules || typeof modules !== "object") return structuredClone(DEFAULT_SITE_MODULES);
  const cleanup = modules.cleanup && typeof modules.cleanup === "object" ? modules.cleanup : {};
  return {
    fingerprint: "fingerprint" in modules ? Boolean(modules.fingerprint) : DEFAULT_SITE_MODULES.fingerprint,
    storage: "storage" in modules ? Boolean(modules.storage) : DEFAULT_SITE_MODULES.storage,
    sensors: "sensors" in modules ? Boolean(modules.sensors) : DEFAULT_SITE_MODULES.sensors,
    behavior: "behavior" in modules ? Boolean(modules.behavior) : DEFAULT_SITE_MODULES.behavior,
    piiShield: "piiShield" in modules ? Boolean(modules.piiShield) : DEFAULT_SITE_MODULES.piiShield,
    blockServiceWorkers: "blockServiceWorkers" in modules ? Boolean(modules.blockServiceWorkers) : DEFAULT_SITE_MODULES.blockServiceWorkers,
    cleanup: {
      recommendations: "recommendations" in cleanup ? Boolean(cleanup.recommendations) : DEFAULT_SITE_MODULES.cleanup.recommendations,
      comments: "comments" in cleanup ? Boolean(cleanup.comments) : DEFAULT_SITE_MODULES.cleanup.comments,
      metrics: "metrics" in cleanup ? Boolean(cleanup.metrics) : DEFAULT_SITE_MODULES.cleanup.metrics,
      overlays: "overlays" in cleanup ? Boolean(cleanup.overlays) : DEFAULT_SITE_MODULES.cleanup.overlays,
      sticky: "sticky" in cleanup ? Boolean(cleanup.sticky) : DEFAULT_SITE_MODULES.cleanup.sticky,
      motion: "motion" in cleanup ? Boolean(cleanup.motion) : DEFAULT_SITE_MODULES.cleanup.motion
    }
  };
}

export function sanitizeCookiePolicy(value, fallback = "keep") {
  return ["keep", "session", "clear-on-switch"].includes(value) ? value : fallback;
}

export function sanitizeAssignmentCookiePolicy(value) {
  return value === "" || value == null ? "" : sanitizeCookiePolicy(value, "");
}

export function resolveCookiePolicy(assignment, profile) {
  return sanitizeAssignmentCookiePolicy(assignment?.cookiePolicy) || sanitizeCookiePolicy(profile?.cookiePolicy, "keep");
}

export function migrateProfileDefaultCleanup(profile) {
  const copy = { ...(profile || {}) };
  if (!("defaultCleanup" in copy) && copy.modules && typeof copy.modules === "object") {
    copy.defaultCleanup = copy.modules;
  }
  delete copy.modules;
  return copy;
}

export function normalizeReloadRequiredIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function effectiveSiteConfig(settings, host, getSiteAssignmentFn) {
  const assignment = host ? getSiteAssignmentFn(settings, host) : null;
  const baseModules = structuredClone(DEFAULT_SITE_MODULES);
  const globalDefaults = {
    fingerprint: settings.fingerprintShield,
    storage: settings.storageShield,
    sensors: settings.sensorShield,
    behavior: settings.behaviorNoise,
    piiShield: settings.piiShield,
    blockServiceWorkers: settings.blockServiceWorkers,
    cleanup: baseModules.cleanup
  };
  if (!assignment) return { modules: globalDefaults, applyShields: settings.applyShieldsGlobally };
  const overrides = assignment.modules || {};
  return {
    modules: {
      fingerprint: "fingerprint" in overrides ? Boolean(overrides.fingerprint) : globalDefaults.fingerprint,
      storage: "storage" in overrides ? Boolean(overrides.storage) : globalDefaults.storage,
      sensors: "sensors" in overrides ? Boolean(overrides.sensors) : globalDefaults.sensors,
      behavior: "behavior" in overrides ? Boolean(overrides.behavior) : globalDefaults.behavior,
      piiShield: "piiShield" in overrides ? Boolean(overrides.piiShield) : globalDefaults.piiShield,
      blockServiceWorkers: "blockServiceWorkers" in overrides ? Boolean(overrides.blockServiceWorkers) : globalDefaults.blockServiceWorkers,
      cleanup: { ...baseModules.cleanup, ...(overrides.cleanup || {}) }
    },
    applyShields: Boolean(assignment.enabled)
  };
}

export function getSiteAssignment(settings, host) {
  if (!host) return null;
  const exact = settings.siteAssignments[host];
  if (exact) return exact;
  const parts = host.split(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    const parent = parts.slice(index).join(".");
    if (settings.siteAssignments[parent]) return settings.siteAssignments[parent];
  }
  return null;
}

export function serializeCookieJar(cookies) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite || "unspecified",
    expirationDate: c.expirationDate,
    hostOnly: c.hostOnly,
    storeId: c.storeId
  }));
}

export function deserializeCookieForSet(cookie, fallbackHost, now = Date.now()) {
  const scheme = cookie.secure ? "https" : "http";
  const domain = (cookie.domain || fallbackHost).replace(/^\./, "");
  const setArgs = {
    url: `${scheme}://${domain}${cookie.path || "/"}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly
  };
  if (cookie.sameSite && cookie.sameSite !== "unspecified") setArgs.sameSite = cookie.sameSite;
  if (!cookie.hostOnly && cookie.domain) setArgs.domain = cookie.domain;
  if (cookie.expirationDate && cookie.expirationDate * 1000 > now) setArgs.expirationDate = cookie.expirationDate;
  if (cookie.storeId) setArgs.storeId = cookie.storeId;
  return setArgs;
}
