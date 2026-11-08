---
type: Script
title: YouTube Multiselect (API)
description: Checkbox selection on any YouTube page with bulk Save to Watch later / playlist, remove, filter-select and export — driven by the InnerTube API instead of per-video menu clicks.
repo: https://github.com/chirag127/yt-multiselect-userscript
install: https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js
version: "2.3.0"
tags: [userscript, youtube, multiselect, innertube, playlist]
timestamp: 2026-06-15T00:00:00Z
---

# YouTube Multiselect (API)

Replaces "click each video's ⋮ menu" with a checkbox per video and one action bar. The
actions are performed by calling YouTube's **InnerTube API** with the page's own signed-in
session, so a hundred videos cost a few batched requests instead of a hundred menu clicks.

## Why the API, not DOM clicking

| Approach | Cost per video | Verdict |
|----------|---------------|---------|
| Per-video ⋮ menu, DOM clicks | ~550–900 ms | Works, but slow and fragile; a card click can navigate away mid-batch |
| Checkbox sweep only | ~instant | Selects, but there is no batch action UI to act on the selection |
| InnerTube `browse/edit_playlist` | one batched request per 50 videos | Chosen |

The API calls use the user's **own** session against **their own** account. It is the same
interface the page itself uses — not a bypass of any security control.

## How it works

1. **Authenticate** with a `SAPISIDHASH` header computed from the `SAPISID` cookie and the
   origin, using `crypto.subtle` SHA-1.
2. **Enumerate** videos with `search` (search pages) or `browse` (feeds; playlists via
   `browseId: "VL" + listId`), following `continuationCommand.token` for further pages.
3. **Edit** with `browse/edit_playlist`, actions `ACTION_ADD_VIDEO` and
   `ACTION_REMOVE_VIDEO_BY_VIDEO_ID`. **Watch later is playlistId `WL`.** Batched 50 at a time.

Removal uses `ACTION_REMOVE_VIDEO_BY_VIDEO_ID` because the newer response format no longer
carries a `setVideoId`.

## UI

- One `☑ Multiselect` launcher, bottom-right.
- Per-card circular checkbox badge, one per outermost card.
- Bottom action bar: live `N / M selected`, select all, deselect all, **📜 Load entire page**, ⋮.
- ⋮ menu: Save to Watch later · Save to playlist · Play all · Remove from this playlist ·
  Select with filter · Load entire page · Copy URLs · Export CSV · Export JSON · Settings.

## Bugs fixed here, and why they matter

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Page scrolled and clicked badly, ⋮ dead | `MutationObserver` ran DOM work on **every** mutation; badge insertion caused more mutations | Debounce the observer (400 ms) |
| ⋮ menu never opened | YouTube **Trusted Types** blocked `innerHTML`; the throw was swallowed inside the click handler | Build nodes with `createElement`/`textContent` |
| Shorts ticks invisible | Shorts shelves **nest** lockups → 2–3 badges per card, inner one unticked and painted on top | One badge per outermost card (`hasNestedCard`) |
| Badge clipped/hidden on shelf Shorts | Badge was absolute inside the scrolling thumbnail anchor | Anchor on the card, `z-index` max, un-clip ancestors |

## See also

- [YouTube DOM notes](../concepts/youtube-dom.md) — the nesting trap in detail
- [Testing rules](../concepts/testing.md) — why the rect check passed while the tick was invisible
