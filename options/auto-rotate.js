const SIGNALONLY_AUTO_ROTATE_SYNC_KEY = "signalonly.autoRotateFingerprint";

const autoRotateButton = document.querySelector(".switch-control[data-setting='autoRotateFingerprint']");
const saveGlobalButton = document.getElementById("saveGlobalButton");
let autoRotateValue = false;
let syncingAutoRotate = false;

void hydrateAutoRotate();

if (autoRotateButton) {
  autoRotateButton.addEventListener("click", () => {
    window.setTimeout(() => {
      autoRotateValue = autoRotateButton.getAttribute("aria-pressed") === "true";
      void saveAutoRotate(autoRotateValue);
    }, 0);
  });

  new MutationObserver(() => {
    if (syncingAutoRotate) return;
    setAutoRotatePressed(autoRotateValue);
  }).observe(autoRotateButton, { attributes: true, attributeFilter: ["aria-pressed"] });
}

saveGlobalButton?.addEventListener("click", () => {
  void saveAutoRotate(autoRotateValue);
});

async function hydrateAutoRotate() {
  try {
    const data = await chrome.storage.sync.get(SIGNALONLY_AUTO_ROTATE_SYNC_KEY);
    autoRotateValue = Boolean(data[SIGNALONLY_AUTO_ROTATE_SYNC_KEY]);
    setAutoRotatePressed(autoRotateValue);
  } catch {}
}

async function saveAutoRotate(value) {
  try {
    await chrome.storage.sync.set({ [SIGNALONLY_AUTO_ROTATE_SYNC_KEY]: Boolean(value) });
  } catch {}
}

function setAutoRotatePressed(value) {
  if (!autoRotateButton) return;
  syncingAutoRotate = true;
  autoRotateButton.setAttribute("aria-pressed", String(Boolean(value)));
  syncingAutoRotate = false;
}
