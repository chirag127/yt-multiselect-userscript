# AGENTS.md — yt-multiselect-userscript

Single-file userscript. `yt-multiselect.user.js` at repo root IS the product. No build, no deps, `@grant none`.

## 🥇 Prime directive — always use the best method

The best available method for **every** task, always. This is not a style preference, it is
an obligation that outranks convenience, familiarity and existing code.

**If existing code is not using the best method, or is not the best code it can be, change
it.** Never preserve a worse approach out of caution about the diff, out of respect for
"that's how it already works", or to keep a change small. Small diffs matter — but a
correct, better implementation beats a tidy diff every single time.

### What "best" means, in priority order

1. **Correct.** Works on the real platform, under real load, for every variant of the input.
   A fast or elegant wrong answer is worthless. Verify against the live service, not against
   an assumption.
2. **Robust.** Uses stable platform interfaces over fragile DOM shapes. Handles absence,
   partial failure and re-runs without corrupting state. Idempotent where a retry is possible.
3. **Simple.** The smallest implementation that satisfies 1 and 2. No speculative abstraction,
   no configurability nobody asked for, no layers that exist only to look architectural.
4. **Fast.** Bounded work, batched where the platform allows it, no redundant round trips, no
   polling loops that could be an event.

When two options tie on 1–3, prefer the one with **fewer moving parts and fewer reasons to
break later** — not the one that looks more sophisticated.

### How to apply it here specifically

- **API over UI.** Reach for `youtubei/v1/*` before simulating clicks. Clicking a menu that a
  designer may reorder next month is the fallback, never the first choice.
- **Documented surfaces over internals.** `getAvailableQualityLevels()` is stable;
  reaching into a minified player field is not.
- **Batch and de-duplicate.** Never send the same request twice for one user action. Resolve
  once, memoise, then write.
- **Pace writes.** Anything that mutates account state gets staggered, jittered requests with
  bounded concurrency. A burst is indistinguishable from abuse.
- **Resolve before writing.** Show the user exactly what will change, then change it.
- **Say what actually failed.** Report `failed` / `unresolved` counts separately from success.
  Never let a partial failure read as a clean run.

### When refactoring existing code to meet this bar

Do it, but keep the diff reviewable: change one concern at a time, keep the public behaviour
identical unless the behaviour itself was the bug, and re-verify with the live test procedure
below before claiming it works. "I rewrote it to be better" without a re-test is not a fix.

## Method (best method — do not revert to UI clicking)
YouTube **InnerTube API** (`youtubei/v1/*`) using the page's signed-in session (SAPISIDHASH auth header from the SAPISID cookie).
- Enumerate: `search` (search pages) or `browse` (feeds; playlists via `browseId:"VL"+listId`), following `continuationCommand.token`.
- Edit: `browse/edit_playlist` with `ACTION_ADD_VIDEO`/`ACTION_REMOVE_VIDEO_BY_VIDEO_ID` (batched 50). Watch Later = playlistId `WL`.
- Resolve video → channel: `next` with `{videoId}`, then walk the response for
  `subscribeButton.subscribeButtonRenderer` (gives `channelId` **and** `subscribed` in one call).
  Do not add a second `player` round trip.
- Subscribe: `subscription/subscribe` with `{channelIds:[...]}`. `subscription/unsubscribe` is the inverse.
  **Always de-duplicate channel ids first** — one search page routinely holds several videos per creator.

### Learned the hard way

- The `subscribed` flag returned by `next` is **cached server-side and lags by minutes**. Treat it
  as a hint for the confirmation summary, never as a gate: filtering writes on it silently skips
  channels the user selected. Subscribing twice is idempotent; skipping is not recoverable.
- Verify a subscribe happened on the **channel page** (`#subscribe-button` text), not by re-reading
  `next` — the cached read will tell you it failed when it actually succeeded.
- `subscription/subscribe` returns HTTP 200 with an `actions` array whether or not it took effect.
  Status code alone is not evidence.

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
