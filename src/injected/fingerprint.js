

(() => {
  const source = document.currentScript;
  let config = {};
  try {
    config = JSON.parse(source?.dataset?.signalonlyConfig || "{}");
  } catch {
    config = {};
  }

  const settings = config.settings || {};
  const profile = config.profile || {};
  if (!profile || !profile.seedHex) {
    return;
  }

  const rng = mulberry32(hashString(profile.behaviorJitterSeed || profile.seedHex || "1"));

  if (settings.fingerprintShield) {
    patchNavigator(profile);
    patchUserAgentData(profile);
    patchScreen(profile.screen || {});
    patchTimezone(profile);
    patchCanvas(profile);
    patchWebGL(profile);
    patchAudio(profile);
    patchNetworkInfo();
    patchMediaDevices(profile);
    patchSpeechVoices(profile);
    patchFontEnumeration(profile);
    patchPerformanceEntries();
    patchPlugins();
    patchScreenOrientation(profile);
    patchNotificationPermission();
    patchPermissionsQuery();
    patchClientRects(profile);
    patchMathPrecision();
    clearWindowName();
    patchDocumentReferrer();
  }

  if (settings.storageShield) {
    patchStorageNamespace(profile);
  }

  if (settings.blockServiceWorkers) {
    blockServiceWorkers();
  }

  if (settings.sensorShield) {
    patchSensors();
  }

  if (settings.behaviorNoise) {

    patchPointerJitter(rng);
  }

  function patchNavigator(model) {
    const nav = Navigator.prototype;
    defineGetter(nav, "userAgent", () => model.userAgent);
    defineGetter(nav, "appVersion", () => String(model.userAgent || "").replace(/^Mozilla\//, ""));
    defineGetter(nav, "platform", () => model.platform);
    defineGetter(nav, "language", () => model.language);
    defineGetter(nav, "languages", () => Object.freeze([...(model.languages || ["en-US", "en"])]));
    defineGetter(nav, "hardwareConcurrency", () => model.hardwareConcurrency || 4);
    defineGetter(nav, "deviceMemory", () => model.deviceMemory || 4);
    defineGetter(nav, "maxTouchPoints", () => model.maxTouchPoints || 0);
    defineGetter(nav, "webdriver", () => false);
  }

  function patchUserAgentData(model) {
    if (!navigator.userAgentData) {
      return;
    }
    const major = String(model.browserMajorVersion || "140");
    const platformBrand = model.uaPlatformBrand || "Windows";
    const brands = Object.freeze([
      { brand: "Chromium", version: major },
      { brand: "Google Chrome", version: major },
      { brand: "Not_A Brand", version: "8" }
    ]);
    const fullVersion = `${major}.0.0.0`;
    const high = {
      architecture: platformBrand === "macOS" ? "arm" : "x86",
      bitness: "64",
      brands,
      fullVersionList: brands.map((entry) => ({ ...entry, version: fullVersion })),
      mobile: false,
      model: "",
      platform: platformBrand,
      platformVersion: platformBrand === "macOS" ? "14.0.0" : platformBrand === "Windows" ? "10.0.0" : "6.6.0",
      uaFullVersion: fullVersion,
      wow64: false
    };

    try {
      const proto = Object.getPrototypeOf(navigator.userAgentData);
      defineGetter(proto, "brands", () => brands);
      defineGetter(proto, "mobile", () => false);
      defineGetter(proto, "platform", () => platformBrand);
      proto.getHighEntropyValues = function patchedGetHighEntropyValues(hints) {
        const requested = Array.isArray(hints) ? hints : [];
        const result = { brands, mobile: false, platform: platformBrand };
        for (const hint of requested) {
          if (hint in high) {
            result[hint] = high[hint];
          }
        }
        return Promise.resolve(result);
      };
    } catch {

    }
  }

  function patchScreen(model) {
    const screenProto = Screen.prototype;
    defineGetter(screenProto, "width", () => model.width || 1440);
    defineGetter(screenProto, "height", () => model.height || 900);
    defineGetter(screenProto, "availWidth", () => model.availWidth || model.width || 1440);
    defineGetter(screenProto, "availHeight", () => model.availHeight || model.height || 860);
    defineGetter(screenProto, "colorDepth", () => model.colorDepth || 24);
    defineGetter(screenProto, "pixelDepth", () => model.pixelDepth || 24);
    defineGetter(window, "devicePixelRatio", () => model.devicePixelRatio || 1);
  }

  function patchTimezone(model) {
    if (!model.timezone) {
      return;
    }

    const nativeOffset = Date.prototype.getTimezoneOffset;
    Object.defineProperty(Date.prototype, "getTimezoneOffset", {
      value() {
        return Number.isFinite(model.timezoneOffset) ? model.timezoneOffset : nativeOffset.call(this);
      },
      configurable: true,
      writable: true
    });

    const NativeDTF = Intl.DateTimeFormat;
    function PatchedDTF(locales, options) {
      const merged = { timeZone: model.timezone, ...(options || {}) };
      if (new.target) {
        return Reflect.construct(NativeDTF, [locales, merged], new.target);
      }
      return new NativeDTF(locales, merged);
    }
    PatchedDTF.prototype = NativeDTF.prototype;
    PatchedDTF.supportedLocalesOf = NativeDTF.supportedLocalesOf.bind(NativeDTF);

    try {
      Object.defineProperty(Intl, "DateTimeFormat", {
        value: PatchedDTF,
        configurable: true,
        writable: true
      });
    } catch {

    }
  }

  function patchCanvas(model) {
    const noise = (hashString(model.canvasNoiseSeed || "canvas") % 7) + 1;
    const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const nativeToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;

    CanvasRenderingContext2D.prototype.getImageData = function patchedGetImageData(...args) {
      const imageData = nativeGetImageData.apply(this, args);
      return noisyImageData(imageData, noise);
    };

    HTMLCanvasElement.prototype.toDataURL = function patchedToDataURL(...args) {
      return withCanvasNoise(this, noise, () => nativeToDataURL.apply(this, args), nativeGetImageData);
    };

    HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, ...args) {

      return withCanvasNoiseAsync(this, noise, callback, args, nativeToBlob, nativeGetImageData);
    };
  }

  function patchWebGL(model) {

    const paramOverrides = {
      37445: model.webglVendor || "Google Inc.",
      37446: model.webglRenderer || "ANGLE",
      3379:  8192,
      3386:  [16384, 16384],
      34076: 16384,
      34024: 16384,
      34930: 16,
      35660: 16,
      35661: 32,
      36348: 1024,
      36349: 512,
      36347: 16,
      7936:  "WebKit",
      7937:  "WebKit WebGL",
      7938:  "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
      35724: "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
      3408:  8,
      3411:  8,
      3412:  24,
      3413:  8,
      3414:  1
    };

    const normalizedExtensions = [
      "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
      "EXT_float_blend", "EXT_frag_depth", "EXT_shader_texture_lod",
      "EXT_texture_filter_anisotropic", "EXT_sRGB", "OES_element_index_uint",
      "OES_standard_derivatives", "OES_texture_float", "OES_texture_float_linear",
      "OES_texture_half_float", "OES_texture_half_float_linear", "OES_vertex_array_object",
      "WEBGL_color_buffer_float", "WEBGL_compressed_texture_s3tc",
      "WEBGL_depth_texture", "WEBGL_draw_buffers", "WEBGL_lose_context"
    ];

    const patch = (proto) => {
      if (!proto) return;

      if (proto.getParameter) {
        const nativeGetParameter = proto.getParameter;
        proto.getParameter = function patchedGetParameter(param) {
          if (param in paramOverrides) {
            const val = paramOverrides[param];
            return Array.isArray(val) ? new Int32Array(val) : val;
          }

          if (param === 33901 || param === 33902) {
            return new Float32Array([1, 1024]);
          }
          return nativeGetParameter.call(this, param);
        };
      }

      if (proto.getSupportedExtensions) {
        proto.getSupportedExtensions = () => [...normalizedExtensions];
      }

      if (proto.getExtension) {
        const nativeGetExtension = proto.getExtension;
        proto.getExtension = function patchedGetExtension(name) {

          if (name === "WEBGL_debug_renderer_info") return null;
          if (!normalizedExtensions.includes(name)) return null;
          return nativeGetExtension.call(this, name);
        };
      }
    };

    patch(window.WebGLRenderingContext?.prototype);
    patch(window.WebGL2RenderingContext?.prototype);
  }

  function patchAudio(model) {
    const shift = ((hashString(model.audioNoiseSeed || "audio") % 100) + 1) / 10000000;
    const analyser = window.AnalyserNode?.prototype;
    if (analyser?.getFloatFrequencyData) {
      const nativeFloat = analyser.getFloatFrequencyData;
      analyser.getFloatFrequencyData = function patchedFloatFrequencyData(array) {
        nativeFloat.call(this, array);
        for (let index = 0; index < array.length; index += 32) {
          array[index] += shift;
        }
      };
    }

    if (window.AudioContext || window.webkitAudioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      try {
        defineGetter(Ctx.prototype, "sampleRate", () => 44100);
        const destProto = Object.getPrototypeOf(
          new (window.OfflineAudioContext || function(){})(1, 1, 44100).destination || {}
        );
        if (destProto) {
          defineGetter(destProto, "maxChannelCount", () => 2);
        }
      } catch {

      }
    }
  }

  function patchStorageNamespace(model) {

    const storageSalt = `so_${String(model.salts?.storage || model.seedHex || "")}_`;
    const indexedDbSalt = String(model.salts?.indexedDB || model.salts?.storage || model.seedHex || "");
    const cacheSalt = String(model.salts?.cache || model.salts?.storage || model.seedHex || "");
    const channelSalt = String(model.salts?.broadcastChannel || model.salts?.storage || model.seedHex || "");

    const realLocal = safeAccess(() => window.localStorage);
    const realSession = safeAccess(() => window.sessionStorage);
    if (realLocal) {
      defineGetter(window, "localStorage", () => buildPrefixedStorage(realLocal, storageSalt));
    }
    if (realSession) {
      defineGetter(window, "sessionStorage", () => buildPrefixedStorage(realSession, storageSalt));
    }

    if (window.indexedDB) {
      const nativeIndexedDB = window.indexedDB;
      const proxy = new Proxy(nativeIndexedDB, {
        get(target, prop) {
          if (prop === "open") {
            return (name, version) => target.open(`so_${indexedDbSalt}_${String(name)}`, version);
          }
          if (prop === "deleteDatabase") {
            return (name) => target.deleteDatabase(`so_${indexedDbSalt}_${String(name)}`);
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      defineGetter(window, "indexedDB", () => proxy);
    }

    if (window.caches) {
      const nativeOpen = caches.open.bind(caches);
      const nativeDelete = caches.delete.bind(caches);
      const nativeHas = caches.has.bind(caches);
      caches.open = (name) => nativeOpen(`so_${cacheSalt}_${String(name)}`);
      caches.delete = (name) => nativeDelete(`so_${cacheSalt}_${String(name)}`);
      caches.has = (name) => nativeHas(`so_${cacheSalt}_${String(name)}`);
    }

    if (window.BroadcastChannel) {
      const NativeBroadcastChannel = window.BroadcastChannel;
      window.BroadcastChannel = function SignalOnlyBroadcastChannel(name) {
        return new NativeBroadcastChannel(`so_${channelSalt}_${String(name)}`);
      };
      window.BroadcastChannel.prototype = NativeBroadcastChannel.prototype;
    }
  }

  function blockServiceWorkers() {
    if (navigator.serviceWorker?.register) {
      const reject = () => Promise.reject(new DOMException("Service worker registration blocked by SignalOnly", "SecurityError"));
      try {
        navigator.serviceWorker.register = reject;
      } catch {

      }
    }
  }

  function buildPrefixedStorage(realStorage, prefix) {
    const handler = {
      length: 0,
      key(index) {
        let position = 0;
        for (let inner = 0; inner < realStorage.length; inner += 1) {
          const stored = realStorage.key(inner);
          if (!stored || !stored.startsWith(prefix)) {
            continue;
          }
          if (position === index) {
            return stored.slice(prefix.length);
          }
          position += 1;
        }
        return null;
      },
      getItem(key) {
        return realStorage.getItem(prefix + String(key));
      },
      setItem(key, value) {
        realStorage.setItem(prefix + String(key), String(value));
      },
      removeItem(key) {
        realStorage.removeItem(prefix + String(key));
      },
      clear() {
        const targets = [];
        for (let index = 0; index < realStorage.length; index += 1) {
          const stored = realStorage.key(index);
          if (stored && stored.startsWith(prefix)) {
            targets.push(stored);
          }
        }
        targets.forEach((stored) => realStorage.removeItem(stored));
      }
    };

    function getPrefixedKeys() {
      const keys = [];
      for (let index = 0; index < realStorage.length; index += 1) {
        const stored = realStorage.key(index);
        if (stored && stored.startsWith(prefix)) {
          keys.push(stored.slice(prefix.length));
        }
      }
      return keys;
    }

    return new Proxy(handler, {
      get(target, prop) {
        if (prop === "length") {
          return getPrefixedKeys().length;
        }
        if (prop === Symbol.iterator) {
          return function* () { yield* getPrefixedKeys(); };
        }
        if (prop in target) {
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
        return target.getItem(prop);
      },
      set(target, prop, value) {
        if (prop === "length") {
          return true;
        }
        target.setItem(prop, value);
        return true;
      },
      deleteProperty(target, prop) {
        target.removeItem(prop);
        return true;
      },
      has(target, prop) {
        if (prop in target) return true;
        return target.getItem(prop) !== null;
      },
      ownKeys() {
        return getPrefixedKeys();
      },
      getOwnPropertyDescriptor(target, prop) {
        const value = target.getItem(prop);
        if (value !== null) {
          return { value, writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      }
    });
  }

  function patchPointerJitter(rng) {

    patchEventCoordinate(MouseEvent.prototype, "clientX", rng);
    patchEventCoordinate(MouseEvent.prototype, "clientY", rng);
    patchEventCoordinate(MouseEvent.prototype, "screenX", rng);
    patchEventCoordinate(MouseEvent.prototype, "screenY", rng);
  }

  function patchClientRects(model) {

    const noiseSeed = hashString(model.canvasNoiseSeed || model.seedHex || "rects");
    const noiseAmount = 0.001 + (noiseSeed % 100) / 100000;

    function noiseRect(rect) {
      const s = noiseSeed;
      return new DOMRect(
        rect.x + ((hashString(String(s + rect.x)) % 200) - 100) * noiseAmount,
        rect.y + ((hashString(String(s + rect.y)) % 200) - 100) * noiseAmount,
        rect.width + ((hashString(String(s + rect.width)) % 200) - 100) * noiseAmount,
        rect.height + ((hashString(String(s + rect.height)) % 200) - 100) * noiseAmount
      );
    }

    const nativeGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function patchedGetBCR() {
      return noiseRect(nativeGetBCR.call(this));
    };

    const nativeGetCR = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function patchedGetCR() {
      const rects = nativeGetCR.call(this);
      const result = [];
      for (let i = 0; i < rects.length; i++) {
        result.push(noiseRect(rects[i]));
      }

      result.item = (index) => result[index] || null;
      return result;
    };
  }

  function patchMathPrecision() {

    const fns = ["tan", "sinh", "cosh", "expm1", "atanh", "cbrt", "log1p"];
    for (const name of fns) {
      if (typeof Math[name] !== "function") continue;
      const native = Math[name];
      Math[name] = function patchedMath(x) {
        const result = native(x);

        if (!Number.isFinite(result) || Number.isInteger(result)) return result;
        return Number(result.toPrecision(15));
      };
    }
  }

  function patchSensors() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: "Geolocation blocked" });
      navigator.geolocation.watchPosition = (_success, error) => {
        error?.({ code: 1, message: "Geolocation blocked" });
        return 0;
      };
    }

    if (Navigator.prototype.getBattery) {
      Navigator.prototype.getBattery = () => Promise.reject(new DOMException("Battery API blocked", "NotAllowedError"));
    }

    ["Accelerometer", "Gyroscope", "Magnetometer", "AmbientLightSensor"].forEach((name) => {
      if (window[name]) {
        window[name] = function BlockedSensor() {
          throw new DOMException(`${name} blocked`, "SecurityError");
        };
      }
    });
  }

  function patchNetworkInfo() {

    if (navigator.connection) {
      const fakeConnection = {
        effectiveType: "4g",
        downlink: 10,
        rtt: 50,
        saveData: false,
        type: "wifi",
        downlinkMax: Infinity,
        onchange: null,
        ontypechange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true
      };
      try {
        defineGetter(Navigator.prototype, "connection", () => fakeConnection);
      } catch {

      }
    }
  }

  function patchMediaDevices(model) {

    if (navigator.mediaDevices?.enumerateDevices) {
      const idSeed = model.seedHex || "media";
      const fakeDevices = [
        { deviceId: hexSlice(idSeed, 0, 16), kind: "audioinput", label: "", groupId: hexSlice(idSeed, 16, 32) },
        { deviceId: hexSlice(idSeed, 4, 20), kind: "videoinput", label: "", groupId: hexSlice(idSeed, 20, 36) },
        { deviceId: hexSlice(idSeed, 8, 24), kind: "audiooutput", label: "", groupId: hexSlice(idSeed, 24, 40) }
      ].map((d) => ({
        ...d,
        toJSON() { return { ...d, toJSON: undefined }; }
      }));
      try {
        navigator.mediaDevices.enumerateDevices = () => Promise.resolve(fakeDevices);
      } catch {

      }
    }
  }

  function patchSpeechVoices(model) {

    if (window.speechSynthesis?.getVoices) {
      const fakeVoices = [
        makeFakeVoice("Google US English", "en-US", true),
        makeFakeVoice("Google UK English Female", "en-GB", false)
      ];
      try {
        speechSynthesis.getVoices = () => fakeVoices;
        const nativeAddListener = speechSynthesis.addEventListener;
        speechSynthesis.addEventListener = function(type, ...args) {
          if (type === "voiceschanged") {
            try { args[0]?.(); } catch {}
            return;
          }
          return nativeAddListener.call(this, type, ...args);
        };
      } catch {

      }
    }
  }

  function makeFakeVoice(name, lang, isDefault) {
    return {
      default: isDefault,
      lang,
      localService: true,
      name,
      voiceURI: name
    };
  }

  function patchFontEnumeration(model) {

    if (document.fonts?.check) {
      try {
        document.fonts.check = () => true;
      } catch {

      }
    }
  }

  function patchPerformanceEntries() {

    const trackerPatterns = [
      "google-analytics", "googletagmanager", "doubleclick",
      "facebook.net", "hotjar", "fullstory", "clarity.ms",
      "segment.io", "amplitude", "mixpanel", "sentry",
      "datadoghq", "newrelic", "nr-data.net"
    ];
    function isTrackerEntry(entry) {
      const name = (entry.name || "").toLowerCase();
      return trackerPatterns.some((pattern) => name.includes(pattern));
    }
    function filterEntries(entries) {
      return entries.filter((e) => !isTrackerEntry(e));
    }
    if (Performance.prototype.getEntries) {
      const nativeGetEntries = Performance.prototype.getEntries;
      Performance.prototype.getEntries = function patchedGetEntries() {
        return filterEntries(nativeGetEntries.call(this));
      };
    }
    if (Performance.prototype.getEntriesByType) {
      const nativeByType = Performance.prototype.getEntriesByType;
      Performance.prototype.getEntriesByType = function patchedGetEntriesByType(...args) {
        return filterEntries(nativeByType.apply(this, args));
      };
    }
    if (Performance.prototype.getEntriesByName) {
      const nativeByName = Performance.prototype.getEntriesByName;
      Performance.prototype.getEntriesByName = function patchedGetEntriesByName(...args) {
        return filterEntries(nativeByName.apply(this, args));
      };
    }
  }

  function patchPlugins() {

    try {
      defineGetter(Navigator.prototype, "plugins", () => {
        return Object.create(PluginArray.prototype, { length: { value: 0 } });
      });
      defineGetter(Navigator.prototype, "mimeTypes", () => {
        return Object.create(MimeTypeArray.prototype, { length: { value: 0 } });
      });
    } catch {

    }
  }

  function patchScreenOrientation(model) {

    if (screen.orientation) {
      try {
        defineGetter(screen.orientation, "type", () => "landscape-primary");
        defineGetter(screen.orientation, "angle", () => 0);
      } catch {

      }
    }
  }

  function patchNotificationPermission() {

    if (window.Notification) {
      try {
        defineGetter(Notification, "permission", () => "default");
      } catch {

      }
    }
  }

  function patchPermissionsQuery() {

    if (navigator.permissions?.query) {
      const nativeQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (desc) => {
        const sensitive = ["notifications", "geolocation", "camera", "microphone", "midi", "clipboard-read", "clipboard-write"];
        if (desc?.name && sensitive.includes(desc.name)) {
          return Promise.resolve({
            state: "prompt",
            name: desc.name,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true
          });
        }
        return nativeQuery(desc);
      };
    }
  }

  function clearWindowName() {

    try {
      if (window.name && window.name.length > 0) {
        window.name = "";
      }
    } catch {

    }
  }

  function patchDocumentReferrer() {

    try {
      const real = document.referrer;
      if (real) {
        const parsed = new URL(real);
        const spoofed = parsed.origin === location.origin ? real : parsed.origin + "/";
        Object.defineProperty(Document.prototype, "referrer", {
          get() { return spoofed; },
          configurable: true
        });
      }
    } catch {

    }
  }

  function hexSlice(hex, start, end) {
    const s = String(hex || "");
    const repeated = s + s + s;
    return repeated.slice(start, end);
  }

  function defineGetter(target, prop, getter) {
    try {
      Object.defineProperty(target, prop, { get: getter, configurable: true });
    } catch {
      return false;
    }
    return true;
  }

  function patchEventCoordinate(proto, prop, rng) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor?.get) {
      return;
    }

    Object.defineProperty(proto, prop, {
      get() {
        const base = descriptor.get.call(this);
        const eventSeed = (this.timeStamp || 0) + base;
        const noise = ((hashString(String(eventSeed)) % 200) - 100) / 200;
        return Math.round(base + noise);
      },
      configurable: true
    });
  }

  function noisyImageData(imageData, noise) {
    const copy = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    for (let index = 0; index < copy.data.length; index += Math.max(4, copy.width * 16)) {
      copy.data[index] = clampByte(copy.data[index] + noise);
      copy.data[index + 1] = clampByte(copy.data[index + 1] - noise);
      copy.data[index + 2] = clampByte(copy.data[index + 2] + (noise % 3));
    }
    return copy;
  }

  function withCanvasNoise(canvas, noise, callback, nativeGetImageData) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) {
      return callback();
    }
    const width = Math.min(16, canvas.width);
    const height = Math.min(16, canvas.height);
    try {
      const original = nativeGetImageData.call(context, 0, 0, width, height);
      const changed = noisyImageData(original, noise);
      context.putImageData(changed, 0, 0);
      const result = callback();
      context.putImageData(original, 0, 0);
      return result;
    } catch {
      return callback();
    }
  }

  function withCanvasNoiseAsync(canvas, noise, callback, blobArgs, nativeToBlob, nativeGetImageData) {

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) {
      return nativeToBlob.call(canvas, callback, ...blobArgs);
    }
    const width = Math.min(16, canvas.width);
    const height = Math.min(16, canvas.height);
    try {
      const original = nativeGetImageData.call(context, 0, 0, width, height);
      const changed = noisyImageData(original, noise);
      context.putImageData(changed, 0, 0);
      return nativeToBlob.call(canvas, (blob) => {
        context.putImageData(original, 0, 0);
        if (callback) callback(blob);
      }, ...blobArgs);
    } catch {
      return nativeToBlob.call(canvas, callback, ...blobArgs);
    }
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  function safeAccess(getter) {
    try {
      return getter();
    } catch {
      return null;
    }
  }

  function hashString(input) {
    let hash = 2166136261;
    const value = String(input);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function next() {
      let value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
})();
