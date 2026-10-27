# Changelog

## 0.3.4

- **Fixed the DSH NEXT startup failure**: `protocol.js` no longer statically imports `@deepseek-ai/cordis`; linked plugins in DSH NEXT fall back to a local `ctx.provide()` service base.
- **Fixed the false "no Desktop detected"** in DSH NEXT: it does not expose `desktopRuntime`, so the Host now reads `desktopVersion` from `primary-runtime/runtime.json`.
- Detects a stable → DSH NEXT **product-line change** instead of treating `2.0.20-next` as a routine patch; reports patch / minor / major / product-line separately.
- Added a migration card: **保留数据并更新** writes the DSH NEXT data-directory pointer to the current DSH home before handing the update to the shell, and backs up the previous pointer.
- Added a data-directory guard and **修复数据目录** action for an already-installed DSH NEXT whose pointer does not match the current home. A deliberate custom NEXT home is left alone.
- Added **ignore this version** for every plugin and for the desktop update. Ignored versions are pinned in `<DSH_HOME>/plugin-updater/ignored.json`; a newer release appears again, and the panel keeps an **已忽略** section with **取消忽略**.
- The Host now writes a handoff manifest and `restore-desktop-data.ps1` under `<DSH_HOME>/plugin-updater/` for manual recovery.
- Added the `desktopData`, `prepareDesktopUpdate`, `repairDesktopData`, `ignore` and `unignore` Remote methods, plus NEXT-manifest fallback detection.
- Fixed the host self-check's relative import and added release-line, release-kind, ignore-list and handoff-write coverage.

## 0.3.3

- Fixed the panel turning pale gray under a light DSH theme: it now uses a fixed dark-navy surface, header, row cards, text and borders that match the interface preview.
- Removed the duplicate “All current” line from the plugin section.
- Added the dsh-plugin.org listed badge to the README.

## 0.3.2

- Polished the real panel to match the interface shown on the Pages site: gradient logo tile, header dots, shimmering progress bar, row cards, status dots, cleaner version text and a footer status light.
- Widened the panel to 408px and strengthened its border, shadow and brand tint.
- Kept the update/restart/batch behavior unchanged; this is a visual polish release.
- Taught the headless render check about SVG attributes so the logo can be tested.

## 0.3.1

- Added a GitHub Pages landing page (`site/`) deployed by `.github/workflows/pages.yml`.
- Rewrote README, architecture notes and the build log to address you, the visitor, directly; added FAQ, an interface illustration and roadmap links.
- Added issue forms, a pull-request template and a security policy so you can report problems and contribute.
- Moved owner-only beginner notes out of the repository into an ignored `.local/` folder.
- Updated package homepage to the Pages site and included docs assets in the npm package.

## 0.3.0

- Updated plugin rows disappear **immediately** after a successful update; no more flashing back to the Update button before the re-check lands.
- Live progress bar with stage labels (removing / installing / re-checking) and a pnpm log line, driven by `plugin-manager/install-state` and `plugin-manager/install-log`.
- One-click **Update all** for every pending plugin, with per-package progress and a summary of failures.
- Per-row failure text and a restored-previous-version indicator.
- **Restart DSH now** action after an update returns `restart-required`.
- GitHub-ready packaging: MIT license, README, icon, changelog, `files` allowlist, public npm metadata.
- UI polish: section actions, progress block, row errors, better status banners.

## 0.2.0

- DSH Desktop update check (official version service) and update handoff through the shell's own route.
- DSH core version display (bundled with Desktop).
- Only one panel remains (the right-hand overlay was removed).
- Draggable panel with remembered position, double-click reset and Escape close.
- Optional-service probing and tolerant response parsing for kernel compatibility.

## 0.1.0

- Initial release: startup check for installed plugin packages against the npm registry.
- Sidebar entry with update count and one-click per-plugin updates.
- No agent calls or token spend.
