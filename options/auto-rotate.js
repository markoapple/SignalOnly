const SIGNALONLY_AUTO_ROTATE_SYNC_KEY = "signalonly.autoRotateFingerprint";

const autoRotateButton = document.querySelector(".switch-control[data-setting='autoRotateFingerprint']");
const saveGlobalButton = document.getElementById("saveGlobalButton");
const exportConfigButton = document.getElementById("exportConfigButton");
const importConfigButton = document.getElementById("importConfigButton");
const configBuffer = document.getElementById("configBuffer");
let autoRotateValue = false;

void hydrateAutoRotate();

if (autoRotateButton) {
  autoRotateButton.addEventListener("click", () => {
    window.setTimeout(() => {
      autoRotateValue = autoRotateButton.getAttribute("aria-pressed") === "true";
      void saveAutoRotate(autoRotateValue);
    }, 0);
  });
}

saveGlobalButton?.addEventListener("click", () => {
  void saveAutoRotate(autoRotateValue);
});

exportConfigButton?.addEventListener("click", () => {
  window.setTimeout(() => {
    if (!configBuffer?.value.trim()) return;
    try {
      const exported = JSON.parse(configBuffer.value);
      exported.autoRotateFingerprint = autoRotateValue;
      configBuffer.value = JSON.stringify(exported, null, 2);
    } catch {}
  }, 0);
});

importConfigButton?.addEventListener("click", () => {
  if (!configBuffer?.value.trim()) return;
  try {
    const imported = JSON.parse(configBuffer.value);
    if (typeof imported.autoRotateFingerprint === "boolean") {
      autoRotateValue = imported.autoRotateFingerprint;
      setAutoRotatePressed(autoRotateValue);
      void saveAutoRotate(autoRotateValue);
    }
  } catch {}
});

async function hydrateAutoRotate() {
  try {
    const data = await chrome.storage.sync.get(SIGNALONLY_AUTO_ROTATE_SYNC_KEY);
    autoRotateValue = Boolean(data[SIGNALONLY_AUTO_ROTATE_SYNC_KEY]);
    setAutoRotatePressed(autoRotateValue);
  } catch {}
}

async function saveAutoRotate(value) {
  autoRotateValue = Boolean(value);
  try {
    await chrome.storage.sync.set({ [SIGNALONLY_AUTO_ROTATE_SYNC_KEY]: autoRotateValue });
  } catch {}
}

function setAutoRotatePressed(value) {
  if (!autoRotateButton) return;
  autoRotateButton.setAttribute("aria-pressed", String(Boolean(value)));
}
