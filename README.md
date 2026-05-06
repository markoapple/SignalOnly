![SignalOnly preview](assets/readme-hero.png)

# SignalOnly

SignalOnly is a local Chromium extension for alt management, per-site identity profiles, fingerprint spoofing, cookie separation, SOCKS routing, WebRTC leak control, and cleaner browsing.

The main use is simple: keep different site identities separated without constantly switching Chrome profiles, clearing cookies manually, or rebuilding the same setup over and over.

Assign a profile to a site, and SignalOnly gives that site a stable alternate browser surface. The profile carries its own fingerprint values, storage salts, cookie behavior, cleanup rules, and local UI state. SOCKS proxy and browser privacy controls are global Chromium settings, with per-site behavior applied where Chrome exposes host scoping. It does not promise invisibility; it gives each site/profile a local, inspectable browser surface and reversible rules.

This is useful for alt accounts, privacy testing, account separation, and making noisy sites less annoying without breaking every login flow.

## How it works

SignalOnly runs as a Manifest V3 extension. The background worker handles profiles, site assignments, proxy settings, privacy controls, exclusions, dynamic rules, and cookie jars. The content script runs early on pages and injects the shield when the current site has an active profile.

The shield changes the browser signals that sites usually read when they try to identify you. Instead of leaking the same raw browser state everywhere, each assigned profile gets its own stable surface. The default goal is not random noise every reload. The goal is a believable profile that stays consistent.

Auto-Rotate is the exception and is marked as an advanced volatile mode. When it is enabled, fingerprint shielding derives a fresh page-load seed from the selected profile, so the profile family stays recognizable but the session surface changes on reload. Keep it off when you want long-lived, stable account separation.

Cookie handling works through per-site cookie identities. SignalOnly can switch and clone cookie jars for the current site scope. When you switch identities, it snapshots the previous jar, clears the current scope, and restores the target jar when one exists. That makes alt switching much less annoying because you are not constantly logging in and out by hand.

Storage access is namespaced with profile salts, so normal page storage APIs are separated at the JavaScript API layer for assigned profiles. This is not a full Chromium storage partition; existing origin storage can still exist outside the namespace, and changes that happen before the shield loads require a reload to fully settle.

The extension also has optional cleanup rules for recommendations, comments, overlays, sticky junk, metrics, and motion-heavy page elements.

## What it does

 **Fingerprint Spoofing**: Feeds fake but consistent data to scripts checking Canvas, WebGL, AudioContext, DOMRects, Math precision, screen posture, plugins, and hardware concurrency.
 **Optional Auto-Rotate**: Advanced volatile mode that uses a fresh fingerprint seed per page load when fingerprint shielding is active. Default profiles remain stable.
 **Cookie Identities**: Switches and clones per-site cookie jars. Policies can keep cookies, clear on tab close, or clear on profile switch. It also sweeps known tracking cookies and caps first-party cookie lifetimes.
 **UI Cleanup**: Visually removes algorithmic recommendations, vanity metrics, overlays, and sticky headers using safe, non-destructive DOM tagging.
 **Network Routing**: Built-in global SOCKS proxy support and WebRTC leak protection.
 **Header Stripping**: Blocks declarative tracking headers (ETag, Last-Modified) on third-party requests.

## Why this exists

Most privacy extensions are built like blunt instruments. They block too much, break pages, and then expect you to babysit every site.

SignalOnly is meant to be more controlled. Keep the page working, but change what the page sees. Give each site a profile. Keep cookies separated. Keep browser signals consistent unless you explicitly enable volatile rotation. Route traffic through SOCKS when needed. Hide the parts of the page that are just attention trash.

It is not trying to be a giant hardened browser project. It is a practical local tool for managing identities inside Chromium.

## Install

Load the repository root (the folder containing `manifest.json`) as an unpacked extension in your Chromium-based browser.

Open `chrome://extensions`, enable Developer mode, click Load unpacked, and select the folder containing `manifest.json`.

Then open a normal website, click the SignalOnly icon, and assign a profile to the current site.

## Usage

Use the popup for quick current-site changes, profile assignment, module toggles, cookie identity switching, and creating new cookie alts. Current-site module toggles auto-save so button presses have visible effect instead of sitting as hidden pending edits.

Use the options page for profiles, exclusions, cookie jars, imports, exports, global settings, and the advanced Auto-Rotate mode.

After changing fingerprint, storage, or service-worker behavior, reload the page. A lot of sites read browser APIs early, so reloads matter.

Use exclusions for sites where you want SignalOnly completely out of the way, especially login providers, payment flows, or anything that acts weird when browser signals change.

## Testing

The basic test is to assign Profile A to a fingerprint test page, reload, and confirm the result stays stable. Then switch to Profile B, reload, and confirm the surface changes. Switch back to Profile A and check that the old surface and cookies return.

If Auto-Rotate is enabled, expect the fingerprint surface to change on reload. Disable it before testing stable profile identity.

Also test the actual sites you care about.

## Project layout

`manifest.json` defines the extension.

`src/background/service-worker.js` handles extension state, profiles, site assignments, cookie jars, proxy controls, rules, and exclusions.

`src/background/pure.js` contains shared pure helpers used by the service worker and tests.

`src/content/content.js` runs on pages and applies the current site config.

`src/content/auto-rotate.js` derives and sends page-load fingerprint seeds when Auto-Rotate is enabled.

`src/injected/fingerprint.js` patches page-world browser APIs.

`src/injected/auto-rotate-fingerprint.js` applies the Auto-Rotate overlay for plugin and math-surface changes.

`popup/` is the quick control panel.

`options/` is the full manager.

`rules/static-rules.json` contains the baseline tracker rules.

## Notes

SignalOnly is local. Profiles, salts, site assignments, and saved cookie jars live in Chrome extension storage.

Exports can contain profile and cookie data. Treat exported configs like private files.
