# AGENTS.md — yt-multiselect-userscript

Single-file userscript. `yt-multiselect.user.js` at repo root IS the product. No build, no deps, `@grant none`.

## Method (best method — do not revert to UI clicking)
YouTube **InnerTube API** (`youtubei/v1/*`) using the page's signed-in session (SAPISIDHASH auth header from the SAPISID cookie).
- Enumerate: `search` (search pages) or `browse` (feeds; playlists via `browseId:"VL"+listId`), following `continuationCommand.token`.
- Edit: `browse/edit_playlist` with `ACTION_ADD_VIDEO`/`ACTION_REMOVE_VIDEO_BY_VIDEO_ID` (batched 50). Watch Later = playlistId `WL`.

## Rules
- One file, zero deps, `@grant none`. Bump `@version`; keep `@updateURL`/`@downloadURL` on raw `main`.
- Act only on the signed-in user's own account. Confirm destructive ops.
- Keep catching all video types in `collect()`: `*VideoRenderer.videoId`, `lockupViewModel.contentId` (new playlist items), `reelWatchEndpoint.videoId` (Shorts).

## Install docs
Shared guide: https://github.com/chirag127/userscript-install-guide — link it, never duplicate install steps.

## Test
`sctl install <raw url>`, open a search/playlist page, click ☑ Multiselect. Verify writes on a throwaway playlist first.
<!-- okf-requirement -->
## 🧠 OKF documentation requirement (mandatory)

**Every repository in this collection MUST ship an Open Knowledge Format (OKF) bundle in `okf/`.**

A repository without `okf/` is **incomplete**, even if the script works.

### What must exist

```
okf/
├── bundle.md      overview of the collection
├── index.md       catalogue of concepts
├── concepts/      all shared concept notes (architecture, metadata, scriptcat-and-sctl,
│                  testing, youtube-dom, okf-requirement)
└── scripts/       THIS repository's own script note (where one applies)
```

### Rules

1. **Never hand-edit** a repository's `okf/` copy. The canonical bundle is
   `repos/own/public/userscripts/okf/` in the `c:\ws` monorepo.
2. After changing the canonical bundle, regenerate every copy:
   `node okf/sync-okf.mjs`
3. Verify nothing has drifted: `node okf/sync-okf.mjs --check` — must exit `0`.
4. `README.md` must link to `okf/`. `AGENTS.md` (this file) must restate this requirement.
5. When adding a new script, add its note at `okf/scripts/<repo-name>.md` in the canonical
   bundle first, then sync.
6. Record durable knowledge here as a concept note: fragile selectors, platform rules,
   rejected alternatives, and mistakes that already cost time.

Full detail: [`okf/concepts/okf-requirement.md`](okf/concepts/okf-requirement.md)
