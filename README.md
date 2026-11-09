# ☑ YouTube Multiselect (API)

One button on **any** YouTube page (search, subscriptions, playlist, home) → load **ALL** results (incl. Shorts) via YouTube's InnerTube API and bulk **add to Watch Later / add to playlist / remove / export** — no per-video clicking, no scrolling.

## Install
First read the shared **[userscript install guide](https://github.com/chirag127/userscript-install-guide)** (how to set up ScriptCat/Tampermonkey). Then click:
**[Install yt-multiselect.user.js](https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js)**

## Use
Click **☑ Multiselect** (bottom-right) → pick an action (hover for titles):
🔢 count · ⏳ Watch Later · ➕ playlist (paste ID/URL) · 🗑️ remove (playlist pages) · 📋 copy URLs · 💾 CSV · 🧾 JSON.

Acts on **all** videos the page can return (follows API pagination), including Shorts. Uses your signed-in session; touches only your own account.

## Settings — in the script menu, never on the page

There is **no settings overlay**. Open the ScriptCat popup (or the extension right-click menu), find
*YouTube Multiselect (API)*, and use:

| Entry | Effect |
|---|---|
| `Settings: action bar position…` | `bottom-center` or `bottom-right` (`bottom-left` is reserved for the YouTube Toolkit) |
| `Confirm before destructive actions: ON/OFF` | Toggles the confirm prompt; label shows current state |
| `Settings: show current setup` | Prints current settings |
| `About & links` | Author links |

Settings are stored via `GM_setValue`, so ScriptCat's cloud sync carries them across browsers.
The previous full-screen modal was removed on purpose — it overlapped YouTube's UI and other
scripts.

## This script owns removal

Bulk **removal** from a playlist lives here and nowhere else. `⋮ → Select unavailable / duplicates`
marks dead and duplicate rows, then `⋮ → Remove from this playlist` deletes them.
`yt-toolkit-userscript` detects the same rows but cannot delete them, so there is exactly one code
path that removes videos.

## License
[MIT](LICENSE) © 2026 chirag127

<!-- docs-single-source -->
## 📚 Documentation

Documentation for this repository lives in the umbrella workspace, in exactly **one** place:

| What | Where |
|------|-------|
| This script's note | [`docs/okf/scripts/yt-multiselect-userscript.md`](../../../../../docs/okf/scripts/yt-multiselect-userscript.md) |
| All notes, catalogued | [`docs/okf/index.md`](../../../../../docs/okf/index.md) |
| Shared knowledge | [`docs/okf/concepts/`](../../../../../docs/okf/concepts/) |

It is **not** copied into this repository. Nothing in this workspace is duplicated: one
document, one file. Verify with `node c:\ws\scripts\check-okf.mjs`.
