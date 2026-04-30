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
  const rng = mulberry32(hashString(profile.behaviorJitterSeed || profile.seedHex || "1"));
  let recentInputUntil = 0;

  if (settings.fingerprintShield) {
    patchNavigator(profile);
    patchScreen(profile.screen || {});
    patchTimezone(profile);
    patchCanvas(profile);
    patchWebGL(profile);
    patchAudio(profile);
  }

  if (settings.storageShield) {
    patchStorage(profile);
  }

  if (settings.sensorShield) {
    patchSensors();
  }

  if (settings.piiShield) {
    patchPIIReads();
  }

  if (settings.behaviorNoise) {
    patchBehavior(profile);
  }

  function patchNavigator(model) {
    const nav = Navigator.prototype;
    defineGetter(nav, "userAgent", () => model.userAgent);
    defineGetter(nav, "appVersion", () => String(model.userAgent || "").replace(/^Mozilla\//, ""));
    defineGetter(nav, "platform", () => model.platform);
    defineGetter(nav, "language", () => model.language);
    defineGetter(nav, "languages", () => [...(model.languages || ["en-US", "en"])]);
    defineGetter(nav, "hardwareConcurrency", () => model.hardwareConcurrency || 4);
    defineGetter(nav, "deviceMemory", () => model.deviceMemory || 4);
    defineGetter(nav, "maxTouchPoints", () => model.maxTouchPoints || 0);
    defineGetter(nav, "webdriver", () => undefined);
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
    const nativeOffset = Date.prototype.getTimezoneOffset;
    Object.defineProperty(Date.prototype, "getTimezoneOffset", {
      value() {
        return Number.isFinite(model.timezoneOffset) ? model.timezoneOffset : nativeOffset.call(this);
      },
      configurable: true,
      writable: true
    });

    const NativeDateTimeFormat = Intl.DateTimeFormat;
    function PatchedDateTimeFormat(locales, options) {
      return new NativeDateTimeFormat(locales, { timeZone: model.timezone || "UTC", ...(options || {}) });
    }
    PatchedDateTimeFormat.prototype = NativeDateTimeFormat.prototype;
    Object.setPrototypeOf(PatchedDateTimeFormat, NativeDateTimeFormat);
    Intl.DateTimeFormat = PatchedDateTimeFormat;
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
      return withCanvasNoise(this, noise, () => nativeToBlob.call(this, callback, ...args), nativeGetImageData);
    };
  }

  function patchWebGL(model) {
    const patch = (proto) => {
      if (!proto?.getParameter) {
        return;
      }
      const nativeGetParameter = proto.getParameter;
      proto.getParameter = function patchedGetParameter(parameter) {
        if (parameter === 37445) {
          return model.webglVendor || "Google Inc.";
        }
        if (parameter === 37446) {
          return model.webglRenderer || "ANGLE";
        }
        if (parameter === 3379) {
          return 8192;
        }
        return nativeGetParameter.call(this, parameter);
      };
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
  }

  function patchStorage(model) {
    const storageSalt = String(model.salts?.storage || model.seedHex || Date.now());
    const indexedDbSalt = String(model.salts?.indexedDB || storageSalt);
    const cacheSalt = String(model.salts?.cache || storageSalt);
    const channelSalt = String(model.salts?.broadcastChannel || storageSalt);
    const local = new MemoryStorage();
    const sessionStore = new MemoryStorage();
    defineGetter(window, "localStorage", () => local);
    defineGetter(window, "sessionStorage", () => sessionStore);

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

    if (navigator.serviceWorker?.register) {
      navigator.serviceWorker.register = () => Promise.reject(new DOMException("Service worker registration blocked", "SecurityError"));
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

  function patchBehavior(model) {
    const jitter = ((hashString(model.behaviorJitterSeed || "behavior") % 6) + 1) / 2;
    const nativePerfNow = performance.now.bind(performance);
    performance.now = () => nativePerfNow() + ((rng() - 0.5) * jitter);

    const nativeDateNow = Date.now;
    Date.now = () => nativeDateNow() + Math.round((rng() - 0.5) * jitter);

    patchEventCoordinate(MouseEvent.prototype, "clientX", jitter);
    patchEventCoordinate(MouseEvent.prototype, "clientY", jitter);
    patchEventCoordinate(MouseEvent.prototype, "screenX", jitter);
    patchEventCoordinate(MouseEvent.prototype, "screenY", jitter);
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

  function patchPIIReads() {
    const sensitive = /(email|phone|mobile|tel|address|shipping|billing|card|credit|payment|recovery|oauth|sso|username|identity)/i;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (!descriptor?.get || !descriptor?.set) {
      return;
    }

    ["input", "change", "keydown", "paste", "pointerdown", "submit"].forEach((type) => {
      document.addEventListener(type, (event) => {
        if (event.isTrusted) {
          recentInputUntil = Date.now() + 1800;
        }
      }, true);
    });

    Object.defineProperty(HTMLInputElement.prototype, "value", {
      get() {
        const value = descriptor.get.call(this);
        const key = `${this.name || ""} ${this.id || ""} ${this.autocomplete || ""} ${this.placeholder || ""} ${this.type || ""}`;
        const activeRead = document.activeElement === this || Date.now() < recentInputUntil;
        if (sensitive.test(key) && !activeRead && looksLikePII(value)) {
          return "";
        }
        return value;
      },
      set(value) {
        return descriptor.set.call(this, value);
      },
      configurable: true
    });
  }

  function defineGetter(target, prop, getter) {
    try {
      Object.defineProperty(target, prop, { get: getter, configurable: true });
    } catch {
      return false;
    }
    return true;
  }

  function patchEventCoordinate(proto, prop, jitter) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor?.get) {
      return;
    }
    Object.defineProperty(proto, prop, {
      get() {
        return Math.round(descriptor.get.call(this) + ((rng() - 0.5) * jitter));
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

  function looksLikePII(value) {
    return /([^\s@]+@[^\s@]+\.[^\s@]+)|(\+?\d[\d\s().-]{7,}\d)|(\b(?:\d[ -]*?){13,19}\b)/.test(String(value || ""));
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
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

  class MemoryStorage {
    constructor() {
      this.map = new Map();
    }
    get length() {
      return this.map.size;
    }
    key(index) {
      return Array.from(this.map.keys())[index] || null;
    }
    getItem(key) {
      const value = this.map.get(String(key));
      return value === undefined ? null : value;
    }
    setItem(key, value) {
      this.map.set(String(key), String(value));
    }
    removeItem(key) {
      this.map.delete(String(key));
    }
    clear() {
      this.map.clear();
    }
  }
})();
