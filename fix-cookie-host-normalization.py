#!/usr/bin/env python3
from pathlib import Path


def patch_exact(path: str, old: str, new: str, changed_files: set[str]) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")

    old_count = text.count(old)
    new_count = text.count(new)

    if old_count == 1:
        patched = text.replace(old, new, 1)
        file_path.write_text(patched, encoding="utf-8")
        changed_files.add(path)
        return

    if old_count == 0 and new_count == 1:
        print(f"{path}: already patched")
        return

    raise RuntimeError(
        f"{path}: expected old block exactly once, found old={old_count}, new={new_count}. "
        "Refusing to patch."
    )


def main() -> None:
    changed_files: set[str] = set()

    patch_exact(
        "options/options.js",
        'siteHost.addEventListener("change", () => { resetSiteDrafts(); render(); });',
        '''siteHost.addEventListener("change", () => {
  siteHost.value = selectedHost();
  resetSiteDrafts();
  render();
});''',
        changed_files,
    )

    patch_exact(
        "options/options.js",
        'function selectedHost() { return siteHost.value.trim() || context.host || ""; }',
        '''function selectedHost() { return sanitizeHostInput(siteHost.value) || context.host || ""; }

function sanitizeHostInput(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\\/\\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\\d+$/, "")
    .replace(/\\/.*$/, "")
    .replace(/^www\\./, "")
    .replace(/\\.+$/g, "")
    .replace(/[^a-z0-9.-]/g, "");
}''',
        changed_files,
    )

    patch_exact(
        "src/background/service-worker.js",
        '''  effectiveSiteConfig as computeEffectiveSiteConfig,
  getSiteAssignment as findSiteAssignment,''',
        '''  effectiveSiteConfig as computeEffectiveSiteConfig,
  getBaseDomain,
  getSiteAssignment as findSiteAssignment,''',
        changed_files,
    )

    patch_exact(
        "src/background/service-worker.js",
        '''          const scheme = cookie.secure ? "https" : "http";
          const domain = cookie.domain.replace(/^\\./, "");
          const url = `${scheme}://${domain}${cookie.path || "/"}`;
          await chrome.cookies.set({
            url, name: cookie.name, value: cookie.value, domain: cookie.domain,
            path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite || "unspecified", expirationDate: now + maxAgeSeconds
          }).catch(() => {});''',
        '''          const setArgs = deserializeCookieForSet(
            { ...cookie, expirationDate: now + maxAgeSeconds },
            host,
            Date.now()
          );
          await chrome.cookies.set(setArgs).catch(() => {});''',
        changed_files,
    )

    patch_exact(
        "src/background/service-worker.js",
        '''function getBaseDomain(host) {
  const cleanHost = sanitizeHost(host);
  const parts = cleanHost.split(".").filter(Boolean);
  if (parts.length <= 2) return cleanHost;
  return parts.slice(-2).join(".");
}

''',
        "",
        changed_files,
    )

    if changed_files:
        print("Changed files:")
        for path in sorted(changed_files):
            print(path)
    else:
        print("No files changed; target blocks were already patched.")


if __name__ == "__main__":
    main()