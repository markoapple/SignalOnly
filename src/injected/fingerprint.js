(() => {
  const BRIDGE_IN = "signalonly:configure";
  const BRIDGE_OUT_RELOAD = "signalonly:reload-required";
  const BRIDGE_OUT_READY = "signalonly:shield-ready";

  if (window.__signalOnlyShield) {
    // Already injected; just notify ready and reapply with bootstrap config if any.
    try {
      const source = document.currentScript;
      const cfg = JSON.parse(source?.dataset?.signalonlyConfig || "null");
      if (cfg) window.__signalOnlyShield.apply(cfg.settings || {}, cfg.profile || {});
    } catch {}
    return;
  }

  // Reverters keyed by patch tag. Each entry: () => void that restores original behavior.
  const REVERTERS = new Map();
  // Tracks which modules are currently active.
  const ACTIVE = new Set();
  // Patches that can't be safely reverted at runtime; setting one of these requires a reload to undo.
  const HARD_PATCHED = new Set();

  let currentSettings = {};
  let currentProfile = null;

  // Bootstrap from data attribute (initial injection).
  try {
    const source = document.currentScript;
    const cfg = JSON.parse(source?.dataset?.signalonlyConfig || "{}");
    currentSettings = cfg.settings || {};
    currentProfile = cfg.profile || null;
  } catch {
    currentSettings = {};
    currentProfile = null;
  }

  window.__signalOnlyShield = {
    apply(settings, profile) {
      currentSettings = settings || {};
      if (profile && (!currentProfile || profile.seedHex !== currentProfile.seedHex)) {
        // Profile identity changed; nuke patches so they re-install with new seeds.
        revertAll(true);
      }
      currentProfile = profile || currentProfile;
      reconcile();
    },
    revertAll(softOnly = false) { revertAll(softOnly); },
    isHardPatched: (tag) => HARD_PATCHED.has(tag)
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__signalonly !== true || data.type !== BRIDGE_IN) return;
    window.__signalOnlyShield.apply(data.settings || {}, data.profile || null);
  });

  if (currentProfile && currentProfile.seedHex) {
    reconcile();
  }

  // Tell the content script we're ready (so it knows the bridge exists).
  postOut(BRIDGE_OUT_READY, {});

  function postOut(type, payload) {
    try {
      window.postMessage({ __signalonly: true, type, ...payload }, "*");
    } catch {}
  }

  function reconcile() {
    if (!currentProfile || !currentProfile.seedHex) {
      revertAll(true);
      return;
    }
    const want = new Set();
    if (currentSettings.fingerprintShield) want.add("fingerprint");
    if (currentSettings.storageShield) want.add("storage");
    if (currentSettings.sensorShield) want.add("sensors");
    if (currentSettings.behaviorNoise) want.add("behavior");
    if (currentSettings.blockServiceWorkers) want.add("sw-block");

    // Disable patches we no longer want.
    for (const tag of Array.from(ACTIVE)) {
      if (!want.has(tag)) revertGroup(tag);
    }
    // Enable patches that are newly wanted.
    for (const tag of want) {
      if (!ACTIVE.has(tag)) installGroup(tag);
    }
  }

  function installGroup(tag) {
    try {
      switch (tag) {
        case "fingerprint": installFingerprint(currentProfile); break;
        case "storage": installStorage(currentProfile); break;
        case "sensors": installSensors(); break;
        case "behavior": installBehavior(currentProfile); break;
        case "sw-block": installSwBlock(); break;
        default: return;
      }
      ACTIVE.add(tag);
    } catch {}
  }

  function revertGroup(tag) {
    const reverter = REVERTERS.get(tag);
    if (typeof reverter === "function") {
      try { reverter(); } catch {}
    }
    REVERTERS.delete(tag);
    ACTIVE.delete(tag);
    if (HARD_PATCHED.has(tag)) {
      postOut(BRIDGE_OUT_RELOAD, { tag });
    }
  }

  function revertAll(softOnly) {
    for (const tag of Array.from(ACTIVE)) {
      if (softOnly && HARD_PATCHED.has(tag)) {
        postOut(BRIDGE_OUT_RELOAD, { tag });
        continue;
      }
      revertGroup(tag);
    }
  }

  // ------- shared helpers -------
  function defineGetter(target, prop, getter) {
    try {
      Object.defineProperty(target, prop, { get: getter, configurable: true });
      return true;
    } catch { return false; }
  }
  function safeAccess(getter) { try { return getter(); } catch { return null; } }
  function hashString(input) {
    let hash = 2166136261;
    const value = String(input);
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function mulberry32(seed) {
    return function next() {
      let v = seed += 0x6D2B79F5;
      v = Math.imul(v ^ (v >>> 15), v | 1);
      v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clampByte(v) { return Math.max(0, Math.min(255, v)); }
  function hexSlice(hex, start, end) {
    const s = String(hex || ""); return (s + s + s).slice(start, end);
  }

  // restoreList: array of () => void, executed in reverse order on revert.
  function makeRestorer() {
    const list = [];
    return {
      add(fn) { list.push(fn); },
      // Save and replace `prop` on `target` with `value`, with revert.
      saveValue(target, prop, value) {
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        try {
          Object.defineProperty(target, prop, { value, writable: true, configurable: true });
        } catch { return; }
        list.push(() => {
          try {
            if (desc) Object.defineProperty(target, prop, desc);
            else delete target[prop];
          } catch {}
        });
      },
      // Save and replace property descriptor with a getter, with revert.
      saveGetter(target, prop, getter) {
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        if (!defineGetter(target, prop, getter)) return;
        list.push(() => {
          try {
            if (desc) Object.defineProperty(target, prop, desc);
            else delete target[prop];
          } catch {}
        });
      },
      build() {
        return () => {
          while (list.length) {
            const fn = list.pop();
            try { fn(); } catch {}
          }
        };
      }
    };
  }

  // ------- FINGERPRINT (revertable except where noted) -------
  function installFingerprint(profile) {
    const r = makeRestorer();
    const screenModel = profile.screen || {};

    // Navigator getters
    const nav = Navigator.prototype;
    r.saveGetter(nav, "userAgent", () => profile.userAgent);
    r.saveGetter(nav, "appVersion", () => String(profile.userAgent || "").replace(/^Mozilla\//, ""));
    r.saveGetter(nav, "platform", () => profile.platform);
    r.saveGetter(nav, "language", () => profile.language);
    r.saveGetter(nav, "languages", () => Object.freeze([...(profile.languages || ["en-US","en"])]));
    r.saveGetter(nav, "hardwareConcurrency", () => profile.hardwareConcurrency || 4);
    r.saveGetter(nav, "deviceMemory", () => profile.deviceMemory || 4);
    r.saveGetter(nav, "maxTouchPoints", () => profile.maxTouchPoints || 0);
    r.saveGetter(nav, "webdriver", () => false);

    // Screen
    const screenProto = Screen.prototype;
    r.saveGetter(screenProto, "width", () => screenModel.width || 1440);
    r.saveGetter(screenProto, "height", () => screenModel.height || 900);
    r.saveGetter(screenProto, "availWidth", () => screenModel.availWidth || screenModel.width || 1440);
    r.saveGetter(screenProto, "availHeight", () => screenModel.availHeight || screenModel.height || 860);
    r.saveGetter(screenProto, "colorDepth", () => screenModel.colorDepth || 24);
    r.saveGetter(screenProto, "pixelDepth", () => screenModel.pixelDepth || 24);
    r.saveGetter(window, "devicePixelRatio", () => screenModel.devicePixelRatio || 1);

    // Date.prototype.getTimezoneOffset
    if (Number.isFinite(profile.timezoneOffset)) {
      const nativeOffset = Date.prototype.getTimezoneOffset;
      Object.defineProperty(Date.prototype, "getTimezoneOffset", {
        value() { return profile.timezoneOffset; }, writable: true, configurable: true
      });
      r.add(() => {
        try {
          Object.defineProperty(Date.prototype, "getTimezoneOffset", {
            value: nativeOffset, writable: true, configurable: true
          });
        } catch {}
      });
    }

    // Intl.DateTimeFormat swap (constructor swap = HARD).
    if (profile.timezone) {
      const NativeDTF = Intl.DateTimeFormat;
      function PatchedDTF(locales, options) {
        const merged = { timeZone: profile.timezone, ...(options || {}) };
        if (new.target) return Reflect.construct(NativeDTF, [locales, merged], new.target);
        return new NativeDTF(locales, merged);
      }
      PatchedDTF.prototype = NativeDTF.prototype;
      PatchedDTF.supportedLocalesOf = NativeDTF.supportedLocalesOf.bind(NativeDTF);
      try {
        Object.defineProperty(Intl, "DateTimeFormat", { value: PatchedDTF, configurable: true, writable: true });
        r.add(() => {
          try {
            Object.defineProperty(Intl, "DateTimeFormat", { value: NativeDTF, configurable: true, writable: true });
          } catch {}
        });
      } catch {}
      HARD_PATCHED.add("fingerprint");
    }

    // userAgentData
    if (navigator.userAgentData) {
      try {
        const proto = Object.getPrototypeOf(navigator.userAgentData);
        const major = String(profile.browserMajorVersion || "140");
        const platformBrand = profile.uaPlatformBrand || "Windows";
        const brands = Object.freeze([
          { brand: "Chromium", version: major },
          { brand: "Google Chrome", version: major },
          { brand: "Not_A Brand", version: "8" }
        ]);
        const fullVersion = `${major}.0.0.0`;
        const high = {
          architecture: platformBrand === "macOS" ? "arm" : "x86", bitness: "64",
          brands, fullVersionList: brands.map((e) => ({ ...e, version: fullVersion })),
          mobile: false, model: "", platform: platformBrand,
          platformVersion: platformBrand === "macOS" ? "14.0.0" : platformBrand === "Windows" ? "10.0.0" : "6.6.0",
          uaFullVersion: fullVersion, wow64: false
        };
        r.saveGetter(proto, "brands", () => brands);
        r.saveGetter(proto, "mobile", () => false);
        r.saveGetter(proto, "platform", () => platformBrand);
        const nativeGEHV = proto.getHighEntropyValues;
        proto.getHighEntropyValues = function patchedGEHV(hints) {
          const requested = Array.isArray(hints) ? hints : [];
          const result = { brands, mobile: false, platform: platformBrand };
          for (const hint of requested) if (hint in high) result[hint] = high[hint];
          return Promise.resolve(result);
        };
        r.add(() => { try { proto.getHighEntropyValues = nativeGEHV; } catch {} });
      } catch {}
    }

    // Canvas
    const canvasNoise = (hashString(profile.canvasNoiseSeed || "canvas") % 7) + 1;
    const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const nativeToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    CanvasRenderingContext2D.prototype.getImageData = function patchedGetImageData(...args) {
      const imageData = nativeGetImageData.apply(this, args);
      return noisyImageData(imageData, canvasNoise);
    };
    HTMLCanvasElement.prototype.toDataURL = function patchedToDataURL(...args) {
      return withCanvasNoise(this, canvasNoise, () => nativeToDataURL.apply(this, args), nativeGetImageData);
    };
    HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, ...args) {
      return withCanvasNoiseAsync(this, canvasNoise, callback, args, nativeToBlob, nativeGetImageData);
    };
    r.add(() => {
      try { CanvasRenderingContext2D.prototype.getImageData = nativeGetImageData; } catch {}
      try { HTMLCanvasElement.prototype.toDataURL = nativeToDataURL; } catch {}
      try { HTMLCanvasElement.prototype.toBlob = nativeToBlob; } catch {}
    });

    // WebGL
    const paramOverrides = {
      37445: profile.webglVendor || "Google Inc.", 37446: profile.webglRenderer || "ANGLE",
      3379: 8192, 3386: [16384, 16384], 34076: 16384, 34024: 16384,
      34930: 16, 35660: 16, 35661: 32, 36348: 1024, 36349: 512, 36347: 16,
      7936: "WebKit", 7937: "WebKit WebGL",
      7938: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
      35724: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
      3408: 8, 3411: 8, 3412: 24, 3413: 8, 3414: 1
    };
    const normalizedExtensions = [
      "ANGLE_instanced_arrays","EXT_blend_minmax","EXT_color_buffer_half_float",
      "EXT_float_blend","EXT_frag_depth","EXT_shader_texture_lod",
      "EXT_texture_filter_anisotropic","EXT_sRGB","OES_element_index_uint",
      "OES_standard_derivatives","OES_texture_float","OES_texture_float_linear",
      "OES_texture_half_float","OES_texture_half_float_linear","OES_vertex_array_object",
      "WEBGL_color_buffer_float","WEBGL_compressed_texture_s3tc",
      "WEBGL_depth_texture","WEBGL_draw_buffers","WEBGL_lose_context"
    ];
    function patchGl(proto) {
      if (!proto) return;
      if (proto.getParameter) {
        const native = proto.getParameter;
        proto.getParameter = function patchedGetParameter(param) {
          if (param in paramOverrides) {
            const v = paramOverrides[param];
            return Array.isArray(v) ? new Int32Array(v) : v;
          }
          if (param === 33901 || param === 33902) return new Float32Array([1, 1024]);
          return native.call(this, param);
        };
        r.add(() => { try { proto.getParameter = native; } catch {} });
      }
      if (proto.getSupportedExtensions) {
        const native = proto.getSupportedExtensions;
        proto.getSupportedExtensions = () => [...normalizedExtensions];
        r.add(() => { try { proto.getSupportedExtensions = native; } catch {} });
      }
      if (proto.getExtension) {
        const native = proto.getExtension;
        proto.getExtension = function patchedGetExtension(name) {
          if (name === "WEBGL_debug_renderer_info") return null;
          if (!normalizedExtensions.includes(name)) return null;
          return native.call(this, name);
        };
        r.add(() => { try { proto.getExtension = native; } catch {} });
      }
    }
    patchGl(window.WebGLRenderingContext?.prototype);
    patchGl(window.WebGL2RenderingContext?.prototype);

    // Audio analyser
    const analyser = window.AnalyserNode?.prototype;
    if (analyser?.getFloatFrequencyData) {
      const nativeFloat = analyser.getFloatFrequencyData;
      const shift = ((hashString(profile.audioNoiseSeed || "audio") % 100) + 1) / 10000000;
      analyser.getFloatFrequencyData = function patched(array) {
        nativeFloat.call(this, array);
        for (let i = 0; i < array.length; i += 32) array[i] += shift;
      };
      r.add(() => { try { analyser.getFloatFrequencyData = nativeFloat; } catch {} });
    }

    // Plugins / mimeTypes
    r.saveGetter(Navigator.prototype, "plugins", () =>
      Object.create(PluginArray.prototype, { length: { value: 0 } }));
    r.saveGetter(Navigator.prototype, "mimeTypes", () =>
      Object.create(MimeTypeArray.prototype, { length: { value: 0 } }));

    // Network info
    if (navigator.connection) {
      const fakeConnection = {
        effectiveType: "4g", downlink: 10, rtt: 50, saveData: false, type: "wifi",
        downlinkMax: Infinity, onchange: null, ontypechange: null,
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true
      };
      r.saveGetter(Navigator.prototype, "connection", () => fakeConnection);
    }

    // Media devices
    if (navigator.mediaDevices?.enumerateDevices) {
      const idSeed = profile.seedHex || "media";
      const fakeDevices = [
        { deviceId: hexSlice(idSeed, 0, 16), kind: "audioinput", label: "", groupId: hexSlice(idSeed, 16, 32) },
        { deviceId: hexSlice(idSeed, 4, 20), kind: "videoinput", label: "", groupId: hexSlice(idSeed, 20, 36) },
        { deviceId: hexSlice(idSeed, 8, 24), kind: "audiooutput", label: "", groupId: hexSlice(idSeed, 24, 40) }
      ].map((d) => ({ ...d, toJSON() { return { ...d, toJSON: undefined }; } }));
      const native = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve(fakeDevices);
      r.add(() => { try { navigator.mediaDevices.enumerateDevices = native; } catch {} });
    }

    // Speech synthesis voices
    if (window.speechSynthesis?.getVoices) {
      const native = speechSynthesis.getVoices.bind(speechSynthesis);
      const fakeVoices = [
        { default: true, lang: "en-US", localService: true, name: "Google US English", voiceURI: "Google US English" },
        { default: false, lang: "en-GB", localService: true, name: "Google UK English Female", voiceURI: "Google UK English Female" }
      ];
      try {
        speechSynthesis.getVoices = () => fakeVoices;
        r.add(() => { try { speechSynthesis.getVoices = native; } catch {} });
      } catch {}
    }

    // Performance entries: filter known trackers.
    const trackerPatterns = [
      "google-analytics","googletagmanager","doubleclick","facebook.net","hotjar",
      "fullstory","clarity.ms","segment.io","amplitude","mixpanel","sentry",
      "datadoghq","newrelic","nr-data.net"
    ];
    function filterEntries(entries) {
      return entries.filter((e) => !trackerPatterns.some((p) => (e.name || "").toLowerCase().includes(p)));
    }
    if (Performance.prototype.getEntries) {
      const native = Performance.prototype.getEntries;
      Performance.prototype.getEntries = function() { return filterEntries(native.call(this)); };
      r.add(() => { try { Performance.prototype.getEntries = native; } catch {} });
    }
    if (Performance.prototype.getEntriesByType) {
      const native = Performance.prototype.getEntriesByType;
      Performance.prototype.getEntriesByType = function(...args) { return filterEntries(native.apply(this, args)); };
      r.add(() => { try { Performance.prototype.getEntriesByType = native; } catch {} });
    }
    if (Performance.prototype.getEntriesByName) {
      const native = Performance.prototype.getEntriesByName;
      Performance.prototype.getEntriesByName = function(...args) { return filterEntries(native.apply(this, args)); };
      r.add(() => { try { Performance.prototype.getEntriesByName = native; } catch {} });
    }

    // Permissions query
    if (navigator.permissions?.query) {
      const native = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (desc) => {
        const sensitive = ["notifications","geolocation","camera","microphone","midi","clipboard-read","clipboard-write"];
        if (desc?.name && sensitive.includes(desc.name)) {
          return Promise.resolve({
            state: "prompt", name: desc.name, onchange: null,
            addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true
          });
        }
        return native(desc);
      };
      r.add(() => { try { navigator.permissions.query = native; } catch {} });
    }

    // Client rects
    const noiseSeed = hashString(profile.canvasNoiseSeed || profile.seedHex || "rects");
    const noiseAmount = 0.001 + (noiseSeed % 100) / 100000;
    function noiseRect(rect) {
      return new DOMRect(
        rect.x + ((hashString(String(noiseSeed + rect.x)) % 200) - 100) * noiseAmount,
        rect.y + ((hashString(String(noiseSeed + rect.y)) % 200) - 100) * noiseAmount,
        rect.width + ((hashString(String(noiseSeed + rect.width)) % 200) - 100) * noiseAmount,
        rect.height + ((hashString(String(noiseSeed + rect.height)) % 200) - 100) * noiseAmount
      );
    }
    const nativeGetBCR = Element.prototype.getBoundingClientRect;
    const nativeGetCR = Element.prototype.getClientRects;
    Element.prototype.getBoundingClientRect = function() { return noiseRect(nativeGetBCR.call(this)); };
    Element.prototype.getClientRects = function() {
      const rects = nativeGetCR.call(this);
      const result = [];
      for (let i = 0; i < rects.length; i += 1) result.push(noiseRect(rects[i]));
      result.item = (i) => result[i] || null;
      return result;
    };
    r.add(() => {
      try { Element.prototype.getBoundingClientRect = nativeGetBCR; } catch {}
      try { Element.prototype.getClientRects = nativeGetCR; } catch {}
    });

    // Math precision
    const mathFns = ["tan","sinh","cosh","expm1","atanh","cbrt","log1p"];
    for (const name of mathFns) {
      if (typeof Math[name] !== "function") continue;
      const native = Math[name];
      Math[name] = function(x) {
        const v = native(x);
        if (!Number.isFinite(v) || Number.isInteger(v)) return v;
        return Number(v.toPrecision(15));
      };
      r.add(() => { try { Math[name] = native; } catch {} });
    }

    // window.name clear (not undone; trivial)
    try { if (window.name && window.name.length > 0) window.name = ""; } catch {}

    // Document.referrer spoof
    try {
      const real = document.referrer;
      if (real) {
        const parsed = new URL(real);
        const spoofed = parsed.origin === location.origin ? real : parsed.origin + "/";
        const desc = Object.getOwnPropertyDescriptor(Document.prototype, "referrer");
        Object.defineProperty(Document.prototype, "referrer", {
          get() { return spoofed; }, configurable: true
        });
        r.add(() => {
          try {
            if (desc) Object.defineProperty(Document.prototype, "referrer", desc);
            else delete Document.prototype.referrer;
          } catch {}
        });
      }
    } catch {}

    REVERTERS.set("fingerprint", r.build());
  }

  // ------- STORAGE (BroadcastChannel constructor swap = HARD) -------
  function installStorage(profile) {
    const r = makeRestorer();
    const storageSalt = `so_${String(profile.salts?.storage || profile.seedHex || "")}_`;
    const indexedDbSalt = String(profile.salts?.indexedDB || profile.salts?.storage || profile.seedHex || "");
    const cacheSalt = String(profile.salts?.cache || profile.salts?.storage || profile.seedHex || "");
    const channelSalt = String(profile.salts?.broadcastChannel || profile.salts?.storage || profile.seedHex || "");

    const realLocal = safeAccess(() => window.localStorage);
    const realSession = safeAccess(() => window.sessionStorage);
    if (realLocal) r.saveGetter(window, "localStorage", () => buildPrefixedStorage(realLocal, storageSalt));
    if (realSession) r.saveGetter(window, "sessionStorage", () => buildPrefixedStorage(realSession, storageSalt));

    if (window.indexedDB) {
      const native = window.indexedDB;
      const proxy = new Proxy(native, {
        get(target, prop) {
          if (prop === "open") return (name, version) => target.open(`so_${indexedDbSalt}_${String(name)}`, version);
          if (prop === "deleteDatabase") return (name) => target.deleteDatabase(`so_${indexedDbSalt}_${String(name)}`);
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      r.saveGetter(window, "indexedDB", () => proxy);
    }

    if (window.caches) {
      const nativeOpen = caches.open.bind(caches);
      const nativeDelete = caches.delete.bind(caches);
      const nativeHas = caches.has.bind(caches);
      caches.open = (n) => nativeOpen(`so_${cacheSalt}_${String(n)}`);
      caches.delete = (n) => nativeDelete(`so_${cacheSalt}_${String(n)}`);
      caches.has = (n) => nativeHas(`so_${cacheSalt}_${String(n)}`);
      r.add(() => { try { caches.open = nativeOpen; caches.delete = nativeDelete; caches.has = nativeHas; } catch {} });
    }

    if (window.BroadcastChannel) {
      const Native = window.BroadcastChannel;
      function PatchedBC(name) { return new Native(`so_${channelSalt}_${String(name)}`); }
      PatchedBC.prototype = Native.prototype;
      window.BroadcastChannel = PatchedBC;
      r.add(() => { try { window.BroadcastChannel = Native; } catch {} });
      // Constructor swap before pages cache references = effectively HARD.
      HARD_PATCHED.add("storage");
    }

    REVERTERS.set("storage", r.build());
  }

  function buildPrefixedStorage(realStorage, prefix) {
    const handler = {
      length: 0,
      key(index) {
        let position = 0;
        for (let inner = 0; inner < realStorage.length; inner += 1) {
          const stored = realStorage.key(inner);
          if (!stored || !stored.startsWith(prefix)) continue;
          if (position === index) return stored.slice(prefix.length);
          position += 1;
        }
        return null;
      },
      getItem(key) { return realStorage.getItem(prefix + String(key)); },
      setItem(key, value) { realStorage.setItem(prefix + String(key), String(value)); },
      removeItem(key) { realStorage.removeItem(prefix + String(key)); },
      clear() {
        const targets = [];
        for (let i = 0; i < realStorage.length; i += 1) {
          const s = realStorage.key(i);
          if (s && s.startsWith(prefix)) targets.push(s);
        }
        targets.forEach((s) => realStorage.removeItem(s));
      }
    };
    function getKeys() {
      const keys = [];
      for (let i = 0; i < realStorage.length; i += 1) {
        const s = realStorage.key(i);
        if (s && s.startsWith(prefix)) keys.push(s.slice(prefix.length));
      }
      return keys;
    }
    return new Proxy(handler, {
      get(t, p) {
        if (p === "length") return getKeys().length;
        if (p === Symbol.iterator) return function*() { yield* getKeys(); };
        if (p in t) { const v = t[p]; return typeof v === "function" ? v.bind(t) : v; }
        return t.getItem(p);
      },
      set(t, p, v) { if (p === "length") return true; t.setItem(p, v); return true; },
      deleteProperty(t, p) { t.removeItem(p); return true; },
      has(t, p) { if (p in t) return true; return t.getItem(p) !== null; },
      ownKeys() { return getKeys(); },
      getOwnPropertyDescriptor(t, p) {
        const v = t.getItem(p);
        if (v !== null) return { value: v, writable: true, enumerable: true, configurable: true };
        return undefined;
      }
    });
  }

  // ------- SENSORS (revertable) -------
  function installSensors() {
    const r = makeRestorer();
    if (navigator.geolocation) {
      const get = navigator.geolocation.getCurrentPosition?.bind(navigator.geolocation);
      const watch = navigator.geolocation.watchPosition?.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (_s, error) => error?.({ code: 1, message: "Geolocation blocked" });
      navigator.geolocation.watchPosition = (_s, error) => { error?.({ code: 1, message: "Geolocation blocked" }); return 0; };
      r.add(() => {
        try {
          if (get) navigator.geolocation.getCurrentPosition = get;
          if (watch) navigator.geolocation.watchPosition = watch;
        } catch {}
      });
    }
    if (Navigator.prototype.getBattery) {
      const native = Navigator.prototype.getBattery;
      Navigator.prototype.getBattery = () => Promise.reject(new DOMException("Battery API blocked", "NotAllowedError"));
      r.add(() => { try { Navigator.prototype.getBattery = native; } catch {} });
    }
    for (const name of ["Accelerometer","Gyroscope","Magnetometer","AmbientLightSensor"]) {
      if (window[name]) {
        const native = window[name];
        window[name] = function Blocked() { throw new DOMException(`${name} blocked`, "SecurityError"); };
        r.add(() => { try { window[name] = native; } catch {} });
      }
    }
    REVERTERS.set("sensors", r.build());
  }

  // ------- BEHAVIOR (revertable) -------
  function installBehavior(profile) {
    const r = makeRestorer();
    const rng = mulberry32(hashString(profile.behaviorJitterSeed || profile.seedHex || "1"));
    for (const prop of ["clientX","clientY","screenX","screenY"]) {
      const desc = Object.getOwnPropertyDescriptor(MouseEvent.prototype, prop);
      if (!desc?.get) continue;
      Object.defineProperty(MouseEvent.prototype, prop, {
        get() {
          const base = desc.get.call(this);
          const eventSeed = (this.timeStamp || 0) + base + rng();
          const noise = ((hashString(String(eventSeed)) % 200) - 100) / 200;
          return Math.round(base + noise);
        },
        configurable: true
      });
      r.add(() => { try { Object.defineProperty(MouseEvent.prototype, prop, desc); } catch {} });
    }
    REVERTERS.set("behavior", r.build());
  }

  // ------- SERVICE WORKER BLOCK (HARD: page may have already cached the method) -------
  function installSwBlock() {
    const r = makeRestorer();
    if (navigator.serviceWorker?.register) {
      const native = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = () => Promise.reject(new DOMException("Service worker registration blocked by SignalOnly", "SecurityError"));
      r.add(() => { try { navigator.serviceWorker.register = native; } catch {} });
      HARD_PATCHED.add("sw-block");
    }
    REVERTERS.set("sw-block", r.build());
  }

  // ------- canvas helpers -------
  function noisyImageData(imageData, noise) {
    const copy = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    for (let i = 0; i < copy.data.length; i += Math.max(4, copy.width * 16)) {
      copy.data[i] = clampByte(copy.data[i] + noise);
      copy.data[i + 1] = clampByte(copy.data[i + 1] - noise);
      copy.data[i + 2] = clampByte(copy.data[i + 2] + (noise % 3));
    }
    return copy;
  }
  function withCanvasNoise(canvas, noise, callback, nativeGetImageData) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return callback();
    const w = Math.min(16, canvas.width);
    const h = Math.min(16, canvas.height);
    try {
      const original = nativeGetImageData.call(ctx, 0, 0, w, h);
      const changed = noisyImageData(original, noise);
      ctx.putImageData(changed, 0, 0);
      const result = callback();
      ctx.putImageData(original, 0, 0);
      return result;
    } catch { return callback(); }
  }
  function withCanvasNoiseAsync(canvas, noise, callback, blobArgs, nativeToBlob, nativeGetImageData) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return nativeToBlob.call(canvas, callback, ...blobArgs);
    const w = Math.min(16, canvas.width);
    const h = Math.min(16, canvas.height);
    try {
      const original = nativeGetImageData.call(ctx, 0, 0, w, h);
      const changed = noisyImageData(original, noise);
      ctx.putImageData(changed, 0, 0);
      return nativeToBlob.call(canvas, (blob) => {
        ctx.putImageData(original, 0, 0);
        if (callback) callback(blob);
      }, ...blobArgs);
    } catch { return nativeToBlob.call(canvas, callback, ...blobArgs); }
  }
})();
