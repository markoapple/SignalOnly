import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_SITE_MODULES,
  sanitizeHost,
  normalizeHostList,
  matchesDomainList,
  sanitizeSiteModules,
  sanitizeAssignmentCookiePolicy,
  resolveCookiePolicy,
  migrateProfileDefaultCleanup,
  normalizeReloadRequiredIds,
  effectiveSiteConfig,
  getSiteAssignment,
  serializeCookieJar,
  deserializeCookieForSet
} from "../src/background/pure.js";

test("sanitizeHost strips scheme/path/www and lowercases", () => {
  assert.equal(sanitizeHost("https://www.Example.com/path?q=1"), "example.com");
  assert.equal(sanitizeHost("  HTTP://Sub.Example.COM/  "), "sub.example.com");
  assert.equal(sanitizeHost(""), "");
  assert.equal(sanitizeHost(null), "");
  assert.equal(sanitizeHost("javascript:alert(1)"), "javascriptalert1");
});

test("normalizeHostList dedupes, sanitizes, caps at 200", () => {
  const list = ["a.com", "A.com", "https://b.com/", "", null, "www.c.com"];
  assert.deepEqual(normalizeHostList(list), ["a.com", "b.com", "c.com"]);
  const big = Array.from({ length: 250 }, (_, i) => `host${i}.com`);
  assert.equal(normalizeHostList(big).length, 200);
  assert.deepEqual(normalizeHostList("not-an-array"), []);
});

test("matchesDomainList honors suffix matching", () => {
  assert.equal(matchesDomainList("sub.example.com", ["example.com"]), true);
  assert.equal(matchesDomainList("example.com", ["example.com"]), true);
  assert.equal(matchesDomainList("notexample.com", ["example.com"]), false);
  assert.equal(matchesDomainList("", ["example.com"]), false);
  assert.equal(matchesDomainList("x.com", null), false);
});

test("sanitizeSiteModules fills defaults from missing fields", () => {
  const result = sanitizeSiteModules({ fingerprint: false });
  assert.equal(result.fingerprint, false);
  assert.equal(result.sensors, DEFAULT_SITE_MODULES.sensors);
  assert.deepEqual(result.cleanup, DEFAULT_SITE_MODULES.cleanup);
});

test("sanitizeSiteModules accepts partial cleanup overrides", () => {
  const result = sanitizeSiteModules({ cleanup: { recommendations: false } });
  assert.equal(result.cleanup.recommendations, false);
  assert.equal(result.cleanup.comments, DEFAULT_SITE_MODULES.cleanup.comments);
});

test("sanitizeSiteModules rejects garbage and falls back to defaults", () => {
  assert.deepEqual(sanitizeSiteModules(null), DEFAULT_SITE_MODULES);
  assert.deepEqual(sanitizeSiteModules("not-an-object"), DEFAULT_SITE_MODULES);
  assert.deepEqual(sanitizeSiteModules(undefined), DEFAULT_SITE_MODULES);
});

test("site cookie policy supports explicit override or profile fallback", () => {
  const profile = { cookiePolicy: "session" };
  assert.equal(sanitizeAssignmentCookiePolicy("clear-on-switch"), "clear-on-switch");
  assert.equal(sanitizeAssignmentCookiePolicy("invalid"), "");
  assert.equal(sanitizeAssignmentCookiePolicy(""), "");
  assert.equal(resolveCookiePolicy({ cookiePolicy: "keep" }, profile), "keep");
  assert.equal(resolveCookiePolicy({ cookiePolicy: "" }, profile), "session");
  assert.equal(resolveCookiePolicy({}, { cookiePolicy: "bad" }), "keep");
});

test("v6 migration preserves legacy profile cleanup defaults", () => {
  const migrated = migrateProfileDefaultCleanup({
    name: "Legacy",
    modules: { recommendations: false, comments: true }
  });
  assert.equal("modules" in migrated, false);
  assert.deepEqual(migrated.defaultCleanup, { recommendations: false, comments: true });
});

test("reload required ids normalize for session storage", () => {
  assert.deepEqual(normalizeReloadRequiredIds([1, "2", "bad", 3.5, null]), [1, 2]);
  assert.deepEqual(normalizeReloadRequiredIds("bad"), []);
});

test("getSiteAssignment matches exact host then parent suffix", () => {
  const settings = {
    siteAssignments: {
      "example.com": { enabled: true, profileId: "p1" },
      "app.example.com": { enabled: true, profileId: "p2" }
    }
  };
  assert.equal(getSiteAssignment(settings, "app.example.com").profileId, "p2");
  assert.equal(getSiteAssignment(settings, "sub.example.com").profileId, "p1");
  assert.equal(getSiteAssignment(settings, "example.com").profileId, "p1");
  assert.equal(getSiteAssignment(settings, ""), null);
  assert.equal(getSiteAssignment(settings, "unrelated.com"), null);
});

test("effectiveSiteConfig falls back to global defaults when no assignment", () => {
  const settings = {
    siteAssignments: {},
    fingerprintShield: true, storageShield: false, sensorShield: true,
    behaviorNoise: true, piiShield: true, blockServiceWorkers: false,
    applyShieldsGlobally: false
  };
  const result = effectiveSiteConfig(settings, "example.com", getSiteAssignment);
  assert.equal(result.modules.fingerprint, true);
  assert.equal(result.modules.behavior, true);
  assert.equal(result.applyShields, false);
});

test("effectiveSiteConfig per-site overrides win over globals", () => {
  const settings = {
    siteAssignments: {
      "example.com": {
        enabled: true, profileId: "p1",
        modules: { fingerprint: false, behavior: true }
      }
    },
    fingerprintShield: true, storageShield: false, sensorShield: true,
    behaviorNoise: false, piiShield: false, blockServiceWorkers: false,
    applyShieldsGlobally: false
  };
  const result = effectiveSiteConfig(settings, "example.com", getSiteAssignment);
  assert.equal(result.modules.fingerprint, false);
  assert.equal(result.modules.behavior, true);
  assert.equal(result.modules.sensors, true); // not overridden, uses global
  assert.equal(result.applyShields, true);
});

test("serializeCookieJar / deserializeCookieForSet round-trip", () => {
  const cookies = [
    {
      name: "sid", value: "abc", domain: ".example.com", path: "/",
      secure: true, httpOnly: true, sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + 3600,
      hostOnly: false, storeId: "0"
    },
    {
      name: "theme", value: "dark", domain: "example.com", path: "/",
      secure: false, httpOnly: false, sameSite: "unspecified",
      hostOnly: true
    }
  ];
  const serialized = serializeCookieJar(cookies);
  assert.equal(serialized.length, 2);

  const setArgs0 = deserializeCookieForSet(serialized[0], "example.com");
  assert.equal(setArgs0.url, "https://example.com/");
  assert.equal(setArgs0.sameSite, "lax");
  assert.equal(setArgs0.domain, ".example.com");
  assert.equal(setArgs0.storeId, "0");

  const setArgs1 = deserializeCookieForSet(serialized[1], "example.com");
  assert.equal(setArgs1.url, "http://example.com/");
  // sameSite="unspecified" must NOT be forwarded (Chrome rejects with secure=false)
  assert.equal("sameSite" in setArgs1, false);
  // hostOnly cookies must NOT have a domain
  assert.equal("domain" in setArgs1, false);
});

test("deserializeCookieForSet drops expired cookies", () => {
  const expired = {
    name: "x", value: "1", domain: "example.com", path: "/",
    secure: false, httpOnly: false, sameSite: "lax",
    expirationDate: Math.floor(Date.now() / 1000) - 3600,
    hostOnly: true
  };
  const setArgs = deserializeCookieForSet(expired, "example.com");
  assert.equal("expirationDate" in setArgs, false);
});
