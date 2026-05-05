(() => {
  const BRIDGE_IN = "signalonly:auto-rotate-configure";
  const REVERTERS = [];

  if (window.__signalOnlyAutoRotateFingerprint) return;

  window.__signalOnlyAutoRotateFingerprint = {
    apply(profile) { apply(profile); },
    revert() { revertAll(); }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__signalonly !== true || data.type !== BRIDGE_IN) return;
    if (!data.enabled || !data.profile?.seedHex) {
      revertAll();
      return;
    }
    apply(data.profile);
  });

  function apply(profile) {
    revertAll();
    const r = makeRestorer();
    installPluginList(r, profile);
    installMathPrecision(r, profile);
    REVERTERS.push(r.build());
  }

  function revertAll() {
    while (REVERTERS.length) {
      try { REVERTERS.pop()(); } catch {}
    }
  }

  function makeRestorer() {
    const list = [];
    return {
      saveGetter(target, prop, getter) {
        if (!target) return;
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        try {
          Object.defineProperty(target, prop, { get: getter, configurable: true });
        } catch { return; }
        list.push(() => {
          try {
            if (desc) Object.defineProperty(target, prop, desc);
            else delete target[prop];
          } catch {}
        });
      },
      saveValue(target, prop, value) {
        if (!target) return;
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

  function installPluginList(restorer, profile) {
    const plugins = Array.isArray(profile.plugins) ? profile.plugins : [];
    restorer.saveGetter(Navigator.prototype, "plugins", () => buildPluginArray(plugins));
    restorer.saveGetter(Navigator.prototype, "mimeTypes", () => buildMimeTypeArray(plugins));
  }

  function buildPluginArray(plugins) {
    const proto = safeProto("PluginArray");
    const array = Object.create(proto);
    defineValue(array, "length", plugins.length);
    defineValue(array, "item", function item(index) { return this[Number(index)] || null; });
    defineValue(array, "namedItem", function namedItem(name) { return this[String(name)] || null; });
    defineValue(array, "refresh", function refresh() {});
    plugins.forEach((plugin, index) => {
      const value = buildPlugin(plugin);
      defineValue(array, index, value, true);
      if (plugin.name) defineValue(array, plugin.name, value, false);
    });
    return array;
  }

  function buildMimeTypeArray(plugins) {
    const mimes = plugins.flatMap((plugin) => (plugin.mimeTypes || []).map((mime) => ({ ...mime, enabledPlugin: plugin })));
    const proto = safeProto("MimeTypeArray");
    const array = Object.create(proto);
    defineValue(array, "length", mimes.length);
    defineValue(array, "item", function item(index) { return this[Number(index)] || null; });
    defineValue(array, "namedItem", function namedItem(name) { return this[String(name)] || null; });
    mimes.forEach((mime, index) => {
      const value = buildMimeType(mime);
      defineValue(array, index, value, true);
      if (mime.type) defineValue(array, mime.type, value, false);
    });
    return array;
  }

  function buildPlugin(plugin) {
    const proto = safeProto("Plugin");
    const item = Object.create(proto);
    const mimes = plugin.mimeTypes || [];
    defineValue(item, "name", String(plugin.name || "PDF Viewer"), true);
    defineValue(item, "filename", String(plugin.filename || "internal-pdf-viewer"), true);
    defineValue(item, "description", String(plugin.description || "Portable Document Format"), true);
    defineValue(item, "length", mimes.length);
    defineValue(item, "item", function item(index) { return this[Number(index)] || null; });
    defineValue(item, "namedItem", function namedItem(name) { return this[String(name)] || null; });
    mimes.forEach((mime, index) => {
      const value = buildMimeType({ ...mime, enabledPlugin: plugin });
      defineValue(item, index, value, true);
      if (mime.type) defineValue(item, mime.type, value, false);
    });
    return item;
  }

  function buildMimeType(mime) {
    const proto = safeProto("MimeType");
    const item = Object.create(proto);
    defineValue(item, "type", String(mime.type || "application/pdf"), true);
    defineValue(item, "suffixes", String(mime.suffixes || "pdf"), true);
    defineValue(item, "description", String(mime.description || "Portable Document Format"), true);
    defineValue(item, "enabledPlugin", mime.enabledPlugin || null, false);
    return item;
  }

  function installMathPrecision(restorer, profile) {
    const precision = Math.max(13, Math.min(15, Number(profile.mathPrecision) || 15));
    for (const name of ["tan", "sinh", "cosh", "expm1", "atanh", "cbrt", "log1p"]) {
      if (typeof Math[name] !== "function") continue;
      const native = Math[name];
      restorer.saveValue(Math, name, function patchedMath(x) {
        const value = native(x);
        if (!Number.isFinite(value) || Number.isInteger(value)) return value;
        return Number(value.toPrecision(precision));
      });
    }
  }

  function defineValue(target, prop, value, enumerable = false) {
    try { Object.defineProperty(target, prop, { value, enumerable, configurable: true }); } catch {}
  }

  function safeProto(name) {
    try { return window[name]?.prototype || Object.prototype; }
    catch { return Object.prototype; }
  }
})();
