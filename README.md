# ☑ YouTube Multiselect (API)

One button on **any** YouTube page (search, subscriptions, playlist, home) → load **ALL** results (incl. Shorts) via YouTube's InnerTube API and bulk **add to Watch Later / add to playlist / remove / export** — no per-video clicking, no scrolling.

## Install
First read the shared **[userscript install guide](https://github.com/chirag127/userscript-install-guide)** (how to set up ScriptCat/Tampermonkey). Then click:
**[Install yt-multiselect.user.js](https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js)**

## Use
Click **☑ Multiselect** (bottom-right) → pick an action (hover for titles):
🔢 count · ⏳ Watch Later · ➕ playlist (paste ID/URL) · 🗑️ remove (playlist pages) · 📋 copy URLs · 💾 CSV · 🧾 JSON.

Acts on **all** videos the page can return (follows API pagination), including Shorts. Uses your signed-in session; touches only your own account.

## License
[MIT](LICENSE) © 2026 chirag127
<!-- okf-bundle -->
## 🧠 Knowledge bundle (OKF)

This repository ships its documentation as an
**Open Knowledge Format** bundle in `okf/` —
written so both a human and an AI agent can understand the script without reading the code.

| File | Contents |
|------|----------|
| `okf/bundle.md` | Overview of the collection |
| `okf/index.md` | Catalogue of concepts |
| `okf/concepts/` | Shared knowledge (architecture, metadata, testing, DOM notes) |
| `okf/scripts/` | This script's own note (where applicable) |

Regenerate every repository's copy from the canonical bundle with `node okf/sync-okf.mjs`.
