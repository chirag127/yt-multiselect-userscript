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
