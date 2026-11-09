// ==UserScript==
// @name         YouTube Multiselect (API)
// @namespace    https://github.com/chirag127
// @version      3.3.0
// @description  Select videos with checkboxes on ANY YouTube page (search, playlist, subscriptions, channel, home) and bulk Save to Watch Later / playlist, queue, like, unlike, not interested, unsubscribe, hide watched, shift-range select, filter-select, export, copy, load entire page - powered by YouTube's InnerTube API. No per-video menu clicking.
// @author       chirag127
// @license      MIT
// @match        https://www.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @homepageURL  https://github.com/chirag127/yt-multiselect-userscript
// @supportURL   https://github.com/chirag127/yt-multiselect-userscript/issues
// @downloadURL  https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js
// @updateURL    https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LINKS = {
    donate: "https://buymeacoffee.com/chirag127",
    github: "https://github.com/chirag127/yt-multiselect-userscript",
    youtube: "https://www.youtube.com/@ChiragSinghal127",
    x: "https://x.com/singhal127",
    linkedin: "https://www.linkedin.com/in/chirag127/",
    instagram: "https://www.instagram.com/chiragsinghal127/",
    reddit: "https://www.reddit.com/user/Far_Macaron_9910/",
  };
  const BATCH = 50, MAX_PAGES = 600;
  const YTMS_KEY = "ytms.settings";
  function loadSettings() {
    let raw = null;
    try { raw = GM_getValue(YTMS_KEY, null); } catch (e) { raw = null; }
    if (!raw) { try { raw = localStorage.getItem("ytms"); } catch (e) { raw = null; } }
    let parsed = {};
    try { parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {}; } catch (e) { parsed = {}; }
    return Object.assign({ pos: "bottom-center", confirm: true }, parsed);
  }
  const settings = loadSettings();
  const saveSettings = () => {
    const payload = JSON.stringify(settings);
    try { GM_setValue(YTMS_KEY, payload); } catch (e) { /* ignore */ }
    try { localStorage.setItem("ytms", payload); } catch (e) { /* ignore */ }
  };

  // ---------- InnerTube API (page's signed-in session) ----------
  const IT = {
    key: () => window.ytcfg && ytcfg.get("INNERTUBE_API_KEY"),
    ctx: () => window.ytcfg && ytcfg.get("INNERTUBE_CONTEXT"),
    async auth() {
      const s = (document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/) || [])[1];
      const t = Math.floor(Date.now() / 1000);
      const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t + " " + s + " " + location.origin));
      return "SAPISIDHASH " + t + "_" + [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    },
    async call(ep, body) {
      const r = await fetch(location.origin + "/youtubei/v1/" + ep + "?key=" + this.key(), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Origin": location.origin, Authorization: await this.auth() },
        body: JSON.stringify(Object.assign({ context: this.ctx() }, body)),
      });
      if (!r.ok) throw new Error(ep + " HTTP " + r.status);
      return r.json();
    },
  };
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  async function editPlaylist(pid, actions, prog) {
    let done = 0;
    for (const part of chunk(actions, BATCH)) { await IT.call("browse/edit_playlist", { playlistId: pid, actions: part }); done += part.length; prog && prog(done, actions.length); }
    return done;
  }
  const addTo = (pid, ids, p) => editPlaylist(pid, ids.map((id) => ({ action: "ACTION_ADD_VIDEO", addedVideoId: id })), p);
  const removeFrom = (pid, ids, p) => editPlaylist(pid, ids.map((id) => ({ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: id })), p);
  const currentListId = () => new URLSearchParams(location.search).get("list");

  // ---------- triage: channels and watched ----------
  async function likeVideos(ids, on) {
    let done = 0;
    for (const id of ids) {
      await IT.call(on ? "like/like" : "like/removelike", { target: { videoId: id } });
      done++;
      status((on ? "Liking " : "Unliking ") + done + "/" + ids.length);
    }
    return done;
  }

  const channelOf = (card) => {
    const a = card.querySelector('a[href^="/@"],a[href^="/channel/"],a[href^="/c/"],a[href^="/user/"]');
    const href = a ? a.getAttribute("href") : "";
    const direct = href.match(/\/channel\/(UC[\w-]{22})/);
    return direct ? direct[1] : null;
  };
  const subscribedChannels = () =>
    cards().filter((c) => c.matches("ytd-channel-renderer") && /subscribed/i.test((c.querySelector("#subscribe-button,yt-subscribe-button-view-model") || {}).textContent || ""));

  // ── Channel resolution ────────────────────────────────────────────────────
  // Card elements only carry a video id. To subscribe we need the owning
  // channel's UC… id, which lives in the video's `next` response. Resolve once
  // per page and memoise: the same channel usually owns several selected
  // videos, and re-fetching would multiply the requests for no benefit.
  const channelCache = new Map();

  function findSubscribeButton(node) {
    // Walk the response tree rather than trusting a fixed path: YouTube renames
    // wrappers between releases, but the renderer's own field names are stable.
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (cur.subscribeButton && cur.subscribeButton.subscribeButtonRenderer) {
        return cur.subscribeButton.subscribeButtonRenderer;
      }
      for (const value of Object.values(cur)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return null;
  }

  // Resolve a video id to { channelId, subscribed, name }. `next` is used rather
  // than `player` because it returns the subscribe state directly, saving a
  // second round trip per video.
  //
  // Caveat worth knowing: the `subscribed` flag in `next` is served from a
  // server-side cache and can lag by minutes after a subscribe. It is therefore
  // a *hint* for the confirmation summary, never a gate. Re-subscribing a
  // channel that is already subscribed is idempotent on YouTube's side, so a
  // stale false only costs one redundant request, while trusting a stale true
  // would silently skip a channel the user asked for. The summary is worded to
  // reflect this: it says what the script will *attempt*.
  async function channelForVideo(videoId) {
    if (channelCache.has(videoId)) return channelCache.get(videoId);
    let result = null;
    try {
      const data = await IT.call("next", { videoId });
      const btn = findSubscribeButton(data);
      if (btn && btn.channelId) {
        result = {
          channelId: btn.channelId,
          subscribed: Boolean(btn.subscribed),
          name: btn.channelName || null,
        };
      }
    } catch {
      result = null;
    }
    channelCache.set(videoId, result);
    return result;
  }

  // Small jittered delay. Subscribe calls create real account state, so they are
  // paced instead of fired as a burst.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (base) => base + Math.floor(Math.random() * base * 0.6);

  async function runPool(items, worker, concurrency) {
    const queue = items.slice();
    const results = [];
    const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          results.push(await worker(item));
        } catch (error) {
          results.push({ error: String(error && error.message ? error.message : error), item });
        }
      }
    });
    await Promise.all(runners);
    return results;
  }

  /**
   * Subscribe to the channels that own the given videos, or to an already
   * resolved channel list.
   *
   * Pass `videos` to resolve-then-subscribe. Pass `channels` to skip resolution
   * entirely — which is what the menu does after the confirmation step, since
   * re-resolving every video a second time would repeat a whole round of
   * requests for information already in hand.
   *
   * Not every selected video belongs to a different channel, so channels are
   * de-duplicated first. Videos whose channel cannot be resolved are reported
   * rather than silently skipped.
   */
  async function subscribeToChannels({ videos, channels, progress }) {
    let all;
    let unresolved = [];

    if (channels) {
      all = channels;
    } else {
      const resolved = [];
      let done = 0;
      await runPool(videos, async (videoId) => {
        const info = await channelForVideo(videoId);
        progress && progress(++done, videos.length, "Resolving channels");
        if (info && info.channelId) resolved.push(info);
        else unresolved.push(videoId);
      }, 3);

      // De-duplicate by channel id, keeping the first sighting.
      const byChannel = new Map();
      for (const entry of resolved) {
        if (!byChannel.has(entry.channelId)) byChannel.set(entry.channelId, entry);
      }
      all = [...byChannel.values()];
    }

    // Subscribe to every resolved channel rather than only those the cached flag
    // calls unsubscribed. The flag lags, so filtering on it risks silently
    // skipping a channel the user selected; subscribing is idempotent, so the
    // extra request is harmless. `already` is kept only to inform the summary.
    const already = all.filter((entry) => entry.subscribed);

    const failed = [];
    let subscribed = 0;

    for (let i = 0; i < all.length; i += 1) {
      const entry = all[i];
      try {
        await IT.call("subscription/subscribe", { channelIds: [entry.channelId] });
        subscribed += 1;
      } catch (error) {
        failed.push({ channelId: entry.channelId, error: String(error && error.message ? error.message : error) });
      }
      progress && progress(i + 1, all.length, "Subscribing");
      // Pace writes; a burst of identical-timing requests is a rate-limit risk.
      if (i < all.length - 1) await sleep(jitter(220));
    }

    return { planned: all, already, unresolved, subscribed, failed };
  }

  const watchedCards = () => cards().filter((c) => {
    const bar = c.querySelector("#progress,ytd-thumbnail-overlay-resume-playback-renderer #progress,yt-thumbnail-overlay-progress-bar-view-model");
    if (!bar) return false;
    const w = parseFloat(bar.style.width || getComputedStyle(bar).width);
    return Number.isFinite(w) && w >= 95;
  });

  /**
   * The queue is a transient playlist whose id is `VL` + the video that started it. It only
   * exists while something plays, so queueing needs a watch page or an already-open queue.
   */
  const queueId = () => {
    const list = currentListId();
    if (list && list.startsWith("VL")) return list;
    const v = new URLSearchParams(location.search).get("v");
    return v ? "VL" + v : null;
  };
  async function addToQueue(ids, p) {
    const q = queueId();
    if (!q) throw new Error("Open a video first - the queue does not exist yet.");
    return addTo(q, ids, p);
  }

  // ---------- selection state ----------
  const selected = new Set();
  let active = false;

  const idFromHref = (href) => {
    const m = (href || "").match(/[?&]v=([A-Za-z0-9_-]{11})/) || (href || "").match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  const CARD_SEL = "ytd-video-renderer,ytd-rich-item-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer,ytd-playlist-video-renderer,ytd-reel-item-renderer,ytd-playlist-panel-video-renderer,yt-lockup-view-model,ytm-shorts-lockup-view-model,ytm-shorts-lockup-view-model-v2";
  const CARD_SELS = CARD_SEL.split(",");
  const cards = () => [...document.querySelectorAll(CARD_SEL)];
  function cardVideoId(card) {
    const a = card.querySelector('a#thumbnail[href],a[href*="/watch?v="],a[href*="/shorts/"]');
    return a ? idFromHref(a.href) : null;
  }
  function cardThumb(card) {
    return card.querySelector('a#thumbnail,ytd-thumbnail,yt-thumbnail-view-model,a[href*="/watch?v="],a[href*="/shorts/"]') || card;
  }

  function paintCb(cb, on) {
    cb.textContent = on ? "✓" : "";
    cb.style.background = on ? "#065fd4" : "rgba(0,0,0,.55)";
    cb.style.borderColor = on ? "#065fd4" : "#fff";
  }
  let anchorId = null;
  function orderedIds() {
    return cards().map(cardVideoId).filter(Boolean);
  }
  /**
   * Toggle one video. With `range` (shift-click) it also applies the same state to every
   * video between the last toggled card and this one, like a file manager.
   */
  function toggle(id, range) {
    const on = !selected.has(id);
    if (range && anchorId) {
      const ids = orderedIds();
      const a = ids.indexOf(anchorId), b = ids.indexOf(id);
      if (a > -1 && b > -1) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (on) selected.add(ids[i]); else selected.delete(ids[i]);
        }
      }
    }
    if (on) selected.add(id); else selected.delete(id);
    anchorId = id;
    document.querySelectorAll(".ytms-cb").forEach((cb) => paintCb(cb, selected.has(cb.dataset.id)));
    updateBar();
  }
  function injectCbs() {
    if (!active) return;
    for (const card of cards()) {
      if (card.dataset.ytmsDone) continue;
      const id = cardVideoId(card); if (!id) continue;
      //
      // Skip a card that contains another card of the same kind.
      //
      // Shorts are the reason this check exists: a Shorts shelf nests one
      // `ytm-shorts-lockup-view-model` inside another, so both matched and both
      // got a badge. Every Short ended up with 2-3 badges stacked at the same
      // coordinates; the inner one painted last and stayed unticked, which
      // looked exactly like "the tick never appears".
      //
      // One badge per outermost card only.
      //
      if (hasNestedCard(card)) continue;
      card.dataset.ytmsDone = "1";
      const host = cardThumb(card);
      //
      // Anchor the badge on the card itself, guarantee a positioning context,
      // and raise stacking above YouTube's thumbnail overlays.
      //
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      unclipBetween(card, host);

      const cb = document.createElement("div");
      cb.className = "ytms-cb"; cb.dataset.id = id;
      Object.assign(cb.style, {
        position: "absolute", top: "4px", left: "4px",
        zIndex: 2147483647,
        width: "22px", height: "22px",
        borderRadius: "50%", border: "2px solid #fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", font: "600 13px Roboto, Arial",
        cursor: "pointer",
        boxShadow: "0 1px 4px rgba(0,0,0,.6)",
        background: "rgba(0,0,0,.55)",
        pointerEvents: "auto"
      });
      paintCb(cb, selected.has(id));
      cb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(id, e.shiftKey); }, true);
      card.appendChild(cb);
    }
  }

  /** True when `card` contains another card of the same kind (nested lockup). */
  function hasNestedCard(card) {
    for (const sel of CARD_SELS) {
      if (!card.matches(sel)) continue;
      if (card.querySelector(sel)) return true;
    }
    return false;
  }

  /** Remove overflow clipping on ancestors between a card and its thumbnail. */
  function unclipBetween(card, host) {
    let node = host;
    while (node && node !== card) {
      const ov = getComputedStyle(node).overflow;
      if (ov === "hidden" || ov === "clip") node.style.overflow = "visible";
      node = node.parentElement;
    }
  }
  const loadedIds = () => [...new Set(cards().map(cardVideoId).filter(Boolean))];

  function selectAll() { loadedIds().forEach((id) => selected.add(id)); refreshCbs(); updateBar(); }
  function deselectAll() { selected.clear(); refreshCbs(); updateBar(); }
  function refreshCbs() { document.querySelectorAll(".ytms-cb").forEach((cb) => paintCb(cb, selected.has(cb.dataset.id))); }

  async function loadEntirePage(status) {
    let last = -1, stable = 0;
    for (let i = 0; i < 200 && stable < 4; i++) {
      scrollTo(0, document.documentElement.scrollHeight);
      // Expand shelves (Shorts etc.): click in-place "Show more" BUTTONS only (never <a>, which would navigate away).
      document.querySelectorAll("button,tp-yt-paper-button,ytd-button-renderer,yt-button-shape button").forEach((b) => {
        if (!b.dataset.ytmsSm && /^\s*show more\s*$/i.test(b.textContent || "")) { b.dataset.ytmsSm = "1"; try { b.click(); } catch (e) {} }
      });
      await new Promise((r) => setTimeout(r, 650));
      injectCbs();
      const n = cards().length; status && status("Loaded " + n + " videos…");
      if (n === last) stable++; else { stable = 0; last = n; }
    }
    scrollTo(0, 0); injectCbs();
  }

  // ---------- action bar ----------
  let bar, countEl, menu;
  function setPos(el) {
    const base = { position: "fixed", bottom: "16px", zIndex: 100000 };
    if (settings.pos === "bottom-left") Object.assign(el.style, base, { left: "16px", right: "auto", transform: "none" });
    else Object.assign(el.style, base, { left: "50%", right: "auto", transform: "translateX(-50%)" });
  }
  function icon(txt, title, fn) {
    const b = document.createElement("button");
    b.textContent = txt; b.title = title;
    Object.assign(b.style, { background: "transparent", border: "0", color: "#fff", cursor: "pointer", fontSize: "20px", padding: "6px", borderRadius: "8px" });
    b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.12)");
    b.onmouseleave = () => (b.style.background = "transparent");
    b.onclick = fn; return b;
  }
  function status(msg) { if (countEl) countEl.dataset.status = msg, renderCount(); }
  function renderCount() {
    if (!countEl) return;
    const s = countEl.dataset.status;
    countEl.textContent = s ? s : selected.size + " / " + loadedIds().length + " selected";
  }
  function updateBar() { countEl && (countEl.dataset.status = "", renderCount()); }

  function buildBar() {
    if (bar) return;
    bar = document.createElement("div");
    Object.assign(bar.style, { display: "flex", alignItems: "center", gap: "4px", background: "rgba(28,28,28,.96)",
      color: "#fff", padding: "6px 10px", borderRadius: "28px", boxShadow: "0 4px 20px rgba(0,0,0,.5)", font: "14px Roboto, Arial", backdropFilter: "blur(6px)" });
    setPos(bar);
    bar.appendChild(icon("✕", "Close multiselect", () => setActive(false)));
    const donate = icon("❤️", "Donate (Buy me a coffee)", () => open(LINKS.donate, "_blank"));
    bar.appendChild(donate);
    countEl = document.createElement("span");
    Object.assign(countEl.style, { minWidth: "120px", textAlign: "center", padding: "0 8px" });
    bar.appendChild(countEl);
    bar.appendChild(icon("✓✓", "Select all loaded", selectAll));
    bar.appendChild(icon("✕✓", "Deselect all", deselectAll));
    bar.appendChild(icon("📜", "Load entire page (scroll to load every video)", () => loadEntirePage(status).then(() => status("✅ Loaded " + loadedIds().length + " videos."))));
    bar.appendChild(icon("⋮", "More actions", toggleMenu));
    document.body.appendChild(bar);
    renderCount();
  }

  async function withSel(fn, needList) {
    try {
      if (!selected.size) return status("Select some videos first.");
      if (needList && !currentListId()) return status("Open a playlist to remove from it.");
      await fn([...selected]);
    } catch (e) { status("⚠️ " + e.message); }
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function toggleMenu() {
    if (menu) return closeMenu();
    menu = document.createElement("div");
    Object.assign(menu.style, { position: "fixed", zIndex: 100001, background: "#282828", color: "#fff", borderRadius: "10px",
      padding: "6px", boxShadow: "0 6px 24px rgba(0,0,0,.6)", font: "14px Roboto, Arial", minWidth: "220px" });
    const r = bar.getBoundingClientRect();
    menu.style.left = Math.max(8, r.right - 220) + "px";
    menu.style.bottom = (innerHeight - r.top + 8) + "px";
    const item = (ic, label, fn) => {
      const d = document.createElement("div");
      const sp = document.createElement("span"); sp.textContent = ic; sp.style.cssText = "display:inline-block;width:24px";
      d.appendChild(sp); d.appendChild(document.createTextNode(label));
      Object.assign(d.style, { padding: "9px 12px", borderRadius: "6px", cursor: "pointer" });
      d.onmouseenter = () => (d.style.background = "#3f3f3f"); d.onmouseleave = () => (d.style.background = "transparent");
      d.onclick = () => { closeMenu(); fn(); }; menu.appendChild(d);
    };
    item("⏳", "Save to Watch later", () => withSel(async (ids) => { const n = await addTo("WL", ids, (d, t) => status("Adding " + d + "/" + t)); status("✅ Added " + n + " to Watch Later."); }));
    item("➕", "Save to playlist…", () => withSel(async (ids) => {
      const input = prompt("Target playlist ID or URL:");
      if (!input) return status("Cancelled.");
      const m = input.match(/[?&]list=([^&]+)/);
      const target = m ? m[1] : input.trim();
      if (!target) return status("Cancelled.");
      const n = await addTo(target, ids, (d, tt) => status("Adding " + d + "/" + tt));
      status("✅ Added " + n + " to " + target + ".");
    }));
    item("👍", "Like selected", () => withSel(async (ids) => {
      const n = await likeVideos(ids, true);
      status("✅ Liked " + n + ".");
    }));
    item("👎", "Unlike selected", () => withSel(async (ids) => {
      const n = await likeVideos(ids, false);
      status("✅ Removed like from " + n + ".");
    }));
    item("🔔", "Subscribe to channels of selected", () => withSel(async (ids) => {
      // Always resolve and report first: subscribing changes real account state,
      // so the user sees exactly which channels are affected before any write.
      status("🔍 Resolving channels…");
      const plan = await subscribeToChannels({
        videos: ids,
        progress: (d, t, label) => status(label + " " + d + "/" + t),
      });

      if (!plan.planned.length) {
        return status(
          "No channels resolved." + (plan.unresolved.length ? " " + plan.unresolved.length + " video(s) had no channel." : ""),
        );
      }

      const parts = [];
      const names = plan.planned.slice(0, 8).map((c) => "  • " + (c.name || c.channelId));
      if (plan.planned.length > 8) names.push("  • …and " + (plan.planned.length - 8) + " more");
      parts.push("Subscribe to " + plan.planned.length + " channel(s):\n" + names.join("\n"));
      if (plan.already.length) parts.push("Already subscribed (cached, still safe to re-send): " + plan.already.length);
      if (plan.unresolved.length) parts.push("Could not resolve: " + plan.unresolved.length);

      if (settings.confirm && !confirm(parts.join("\n\n") + "\n\nProceed?")) return status("Cancelled.");

      const result = await subscribeToChannels({
        channels: plan.planned,
        progress: (d, t, label) => status("⏳ " + label + " " + d + "/" + t),
      });

      const summary = ["✅ Subscribed to " + result.subscribed];
      if (result.failed.length) summary.push("⚠️ " + result.failed.length + " failed");
      if (result.unresolved.length) summary.push(result.unresolved.length + " unresolved");
      status(summary.join(" · "));
    }));
    item("🔕", "Unsubscribe visible channels", async () => {
      const list = subscribedChannels();
      const ids = list.map(channelOf).filter(Boolean);
      if (!ids.length) return status("No subscribed channel cards on this page.");
      if (settings.confirm && !confirm("Unsubscribe from " + ids.length + " channel(s)?")) return status("Cancelled.");
      let done = 0;
      for (const part of chunk(ids, 50)) {
        await IT.call("subscription/unsubscribe", { channelIds: part });
        done += part.length;
        status("Unsubscribing " + done + "/" + ids.length);
      }
      list.forEach((c) => (c.style.opacity = ".35"));
      status("✅ Unsubscribed " + done + ".");
    });
    item("🙈", "Hide watched cards", () => {
      const list = watchedCards();
      if (!list.length) return status("No watched cards on this page.");
      list.forEach((c) => (c.style.display = "none"));
      status("✅ Hid " + list.length + " watched card(s) on this page.");
    });
    item("▶️", "Play all selected", () => withSel((ids) => open("https://www.youtube.com/watch_videos?video_ids=" + ids.join(","), "_blank")));
    if (currentListId()) item("🗑️", "Remove from this playlist", () => withSel(async (ids) => {
      if (settings.confirm && !confirm("Remove " + ids.length + " selected from this playlist?")) return status("Cancelled.");
      const n = await removeFrom(currentListId(), ids, (d, t) => status("Removing " + d + "/" + t)); status("✅ Removed " + n + ". Reload to refresh.");
    }), true);
    item("🔽", "Select with filter…", () => {
      const kw = (prompt("Select videos whose title/channel contains:") || "").trim().toLowerCase(); if (!kw) return;
      let n = 0;
      cards().forEach((card) => { const id = cardVideoId(card); const txt = (card.textContent || "").toLowerCase(); if (id && txt.includes(kw)) { selected.add(id); n++; } });
      refreshCbs(); updateBar(); status("✅ Selected " + n + " matching.");
    });
    item("🧹", "Select unavailable / duplicates", () => {
      const seen = new Set();
      let n = 0;
      cards().forEach((card) => {
        const id = cardVideoId(card);
        if (!id) return;
        const txt = (card.textContent || "").trim();
        const low = txt.toLowerCase();
        const dead = low.startsWith("[deleted") || low.startsWith("[private") || low.startsWith("[unavailable");
        const dup = seen.has(id);
        seen.add(id);
        if (dead || dup) { selected.add(id); n++; }
      });
      refreshCbs(); updateBar();
      status(n ? "✅ Selected " + n + " unavailable/duplicate video(s)." : "Nothing unavailable or duplicated on this page.");
    });
    item("📜", "Load entire page", () => loadEntirePage(status).then(() => status("✅ All loaded. " + loadedIds().length + " videos.")));
    item("📋", "Copy selected URLs", () => withSel(async (ids) => { await navigator.clipboard.writeText(ids.map((i) => "https://youtu.be/" + i).join("\n")); status("✅ Copied " + ids.length + " URLs."); }));
    item("💾", "Export selection (CSV)", () => withSel((ids) => { dl("selection.csv", "videoId,url\n" + ids.map((i) => i + ",https://youtu.be/" + i).join("\n"), "text/csv"); status("✅ Exported " + ids.length + "."); }));
    item("🧾", "Export selection (JSON)", () => withSel((ids) => { dl("selection.json", JSON.stringify(ids, null, 2), "application/json"); status("✅ Exported " + ids.length + "."); }));
    item("⚙️", "Settings & about", showAbout);
    document.body.appendChild(menu);
  }
  function dl(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

  // ---------- settings: context menu only ----------
  // INVARIANT: no overlay, no modal, no floater. Settings live in the userscript
  // manager's own menu (ScriptCat popup / extension right-click), each opening a
  // native prompt or alert. The previous full-screen overlay is gone on purpose.

  function refreshBar() {
    try {
      if (typeof bar !== "undefined" && bar) setPos(bar);
    } catch (e) { /* bar not built yet */ }
  }

  function editPosition() {
    const v = prompt(
      "Action bar position: bottom-center or bottom-right\n\n"
        + "bottom-left is reserved for the YouTube Toolkit script, so it is not offered here.",
      settings.pos
    );
    if (v === null) return;
    const p = String(v).trim().toLowerCase();
    if (p !== "bottom-center" && p !== "bottom-right") {
      alert('Position must be "bottom-center" or "bottom-right". Nothing changed.');
      return;
    }
    settings.pos = p;
    saveSettings();
    refreshBar();
    alert("Action bar position saved: " + p);
  }

  function toggleConfirm() {
    settings.confirm = !settings.confirm;
    saveSettings();
    alert("Confirm before destructive actions: " + (settings.confirm ? "ON" : "OFF"));
    refreshMenuLabels();
  }

  function showSetup() {
    alert([
      "YouTube Multiselect",
      "",
      "Action bar: " + settings.pos,
      "Confirm before destructive actions: " + (settings.confirm ? "on" : "off"),
      "",
      "Settings are stored in the script manager and replicated across browsers",
      "by ScriptCat's cloud sync. There is no in-page settings overlay.",
    ].join("\n"));
  }

  function showAbout() {
    alert([
      "YouTube Multiselect (API) — by chirag127",
      "",
      "Settings are in the script manager menu, not on the page.",
      "",
      "Donate:   " + LINKS.donate,
      "GitHub:   " + LINKS.github,
      "YouTube:  " + LINKS.youtube,
      "X:        " + LINKS.x,
      "LinkedIn: " + LINKS.linkedin,
      "Instagram:" + LINKS.instagram,
      "Reddit:   " + LINKS.reddit,
    ].join("\n"));
  }

  const MENU_IDS = {};

  function menuCmd(name, fn, id) {
    try {
      if (id) GM_registerMenuCommand(name, fn, { id: id });
      else GM_registerMenuCommand(name, fn);
      if (id) MENU_IDS[id] = fn;
    } catch (e) { /* manager without menu support */ }
  }

  function refreshMenuLabels() {
    menuCmd("Confirm before destructive actions: " + (settings.confirm ? "ON" : "OFF"), toggleConfirm, "ytms-confirm");
  }

  function registerSettingsMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    menuCmd("Settings: action bar position…", editPosition);
    refreshMenuLabels();
    menuCmd("Settings: show current setup", showSetup);
    menuCmd("About & links", showAbout);
  }

  // ---------- activate / toggle ----------
  function setActive(on) {
    active = on;
    document.body.classList.toggle("ytms-on", on);
    if (on) { buildBar(); injectCbs(); } else { closeMenu(); bar && bar.remove(); bar = null; document.querySelectorAll(".ytms-cb").forEach((c) => c.remove()); document.querySelectorAll("[data-ytms-done]").forEach((a) => delete a.dataset.ytmsDone); }
    fab.style.display = on ? "none" : "block";
  }

  // ---------- floating toggle button ----------
  const fab = document.createElement("button");
  function mountFab() {
    if (document.getElementById("yt-ms-fab")) { return; }
    fab.id = "yt-ms-fab"; fab.textContent = "☑ Multiselect"; fab.title = "Select videos for bulk actions (API-powered)";
    Object.assign(fab.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: 100000, padding: "10px 14px", border: 0, borderRadius: "20px", background: "#065fd4", color: "#fff", cursor: "pointer", font: "600 13px Roboto, Arial", boxShadow: "0 2px 10px rgba(0,0,0,.4)" });
    fab.onclick = () => setActive(true);
    document.body.appendChild(fab);
  }
  registerSettingsMenu();
  mountFab();
  // Debounced observer: coalesce bursts of DOM mutations into one pass per frame
  // (running injectCbs on every mutation janked the page so scroll/clicks froze).
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mountFab(); if (active) injectCbs(); });
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
