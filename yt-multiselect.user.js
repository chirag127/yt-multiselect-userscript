// ==UserScript==
// @name         YouTube Multiselect (API)
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  One button, any YouTube page (search, subscriptions, playlist, home): load ALL results (incl. Shorts) via the InnerTube API and bulk add-to-Watch-Later / add-to-playlist / remove / export — no per-video clicking, no scrolling.
// @author       chirag127
// @license      MIT
// @match        https://www.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @homepageURL  https://github.com/chirag127/yt-multiselect-userscript
// @supportURL   https://github.com/chirag127/yt-multiselect-userscript/issues
// @downloadURL  https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js
// @updateURL    https://github.com/chirag127/yt-multiselect-userscript/raw/main/yt-multiselect.user.js
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BATCH = 50;          // edit_playlist actions per request
  const MAX_PAGES = 600;     // continuation safety cap

  // ---- InnerTube client (reuses the page's signed-in session) ----
  const IT = {
    key: () => window.ytcfg && ytcfg.get("INNERTUBE_API_KEY"),
    ctx: () => window.ytcfg && ytcfg.get("INNERTUBE_CONTEXT"),
    async auth() {
      const sapisid = (document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/) || [])[1];
      const ts = Math.floor(Date.now() / 1000);
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid + " " + location.origin));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return "SAPISIDHASH " + ts + "_" + hex;
    },
    async call(endpoint, body) {
      const r = await fetch(location.origin + "/youtubei/v1/" + endpoint + "?key=" + this.key(), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Origin": location.origin, Authorization: await this.auth() },
        body: JSON.stringify(Object.assign({ context: this.ctx() }, body)),
      });
      if (!r.ok) throw new Error(endpoint + " HTTP " + r.status);
      return r.json();
    },
  };

  // ---- Recursively collect video ids (regular + Shorts + playlist items) ----
  function collect(node, out) {
    if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
    if (!node || typeof node !== "object") return;
    const id11 = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v);
    for (const k of ["videoRenderer", "playlistVideoRenderer", "compactVideoRenderer", "gridVideoRenderer", "reelItemRenderer", "playlistPanelVideoRenderer"]) {
      if (node[k] && id11(node[k].videoId)) out.add(node[k].videoId);
    }
    if (node.lockupViewModel && id11(node.lockupViewModel.contentId)) out.add(node.lockupViewModel.contentId); // new lockups incl. playlist items
    if (node.reelWatchEndpoint && id11(node.reelWatchEndpoint.videoId)) out.add(node.reelWatchEndpoint.videoId); // Shorts
    for (const k in node) collect(node[k], out);
  }
  function findToken(node) {
    let token = null;
    (function walk(n) {
      if (token || !n || typeof n !== "object") return;
      if (n.continuationCommand && n.continuationCommand.token) { token = n.continuationCommand.token; return; }
      for (const k in n) walk(n[k]);
    })(node);
    return token;
  }

  // ---- Where are we? pick the right endpoint ----
  function context() {
    const u = new URL(location.href), p = u.pathname, q = u.searchParams;
    if (q.get("list")) return { type: "playlist", id: q.get("list"), label: "Playlist " + q.get("list") };
    if (p === "/results") return { type: "search", query: q.get("search_query") || "", label: 'Search: "' + (q.get("search_query") || "") + '"' };
    if (p === "/feed/subscriptions") return { type: "browse", id: "FEsubscriptions", label: "Subscriptions feed" };
    if (p === "/feed/trending") return { type: "browse", id: "FEtrending", label: "Trending" };
    if (p === "/" || p === "") return { type: "browse", id: "FEwhat_to_watch", label: "Home feed" };
    return { type: "unknown", label: "This page isn't supported — open search, a playlist, or a feed" };
  }

  async function loadAll(onProgress) {
    const c = context();
    let ep, body;
    if (c.type === "playlist") { ep = "browse"; body = { browseId: "VL" + c.id }; }
    else if (c.type === "search") { ep = "search"; body = { query: c.query }; }
    else if (c.type === "browse") { ep = "browse"; body = { browseId: c.id }; }
    else return { ids: [], ctx: c };
    const ids = new Set();
    let resp = await IT.call(ep, body);
    for (let i = 0; i < MAX_PAGES; i++) {
      collect(resp, ids);
      onProgress && onProgress(ids.size);
      const tk = findToken(resp);
      if (!tk) break;
      resp = await IT.call(ep, { continuation: tk });
    }
    return { ids: [...ids], ctx: c };
  }

  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  async function editPlaylist(playlistId, actions, onProgress) {
    let done = 0;
    for (const part of chunk(actions, BATCH)) {
      await IT.call("browse/edit_playlist", { playlistId, actions: part });
      done += part.length; onProgress && onProgress(done, actions.length);
    }
    return done;
  }
  const addTo = (pid, ids, p) => editPlaylist(pid, ids.map((id) => ({ action: "ACTION_ADD_VIDEO", addedVideoId: id })), p);
  const removeFrom = (pid, ids, p) => editPlaylist(pid, ids.map((id) => ({ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: id })), p);

  const parsePid = (s) => { const m = (s || "").match(/[?&]list=([^&]+)/); return m ? m[1] : (s || "").trim(); };
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---- UI ----
  let panel, statusEl;
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };

  function iconBtn(icon, title, fn) {
    const b = document.createElement("button");
    b.textContent = icon; b.title = title;
    Object.assign(b.style, { width: "38px", height: "38px", margin: "3px", border: "0", borderRadius: "8px",
      background: "#272727", color: "#fff", cursor: "pointer", fontSize: "17px" });
    b.onmouseenter = () => (b.style.background = "#3f3f3f");
    b.onmouseleave = () => (b.style.background = "#272727");
    b.onclick = fn;
    return b;
  }

  async function withIds(fn) {
    try {
      setStatus("⏳ Loading all videos…");
      const { ids, ctx } = await loadAll((n) => setStatus("⏳ Loaded " + n + "…"));
      if (ctx.type === "unknown") return setStatus("⚠️ " + ctx.label);
      if (!ids.length) return setStatus("No videos found here.");
      await fn(ids, ctx);
    } catch (e) { setStatus("⚠️ " + e.message); }
  }

  function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }
    const c = context();
    panel = document.createElement("div");
    Object.assign(panel.style, { position: "fixed", right: "16px", bottom: "72px", zIndex: 99999, width: "268px",
      background: "#181818", color: "#fff", padding: "12px", borderRadius: "10px", boxShadow: "0 4px 20px rgba(0,0,0,.5)", font: "13px Roboto, Arial" });
    const t = document.createElement("div");
    t.textContent = c.label; Object.assign(t.style, { fontWeight: "600", marginBottom: "8px", wordBreak: "break-all" });
    panel.appendChild(t);

    const row = document.createElement("div");
    row.style.display = "flex"; row.style.flexWrap = "wrap";
    row.appendChild(iconBtn("🔢", "Count all videos (load everything)", () => withIds((ids) => setStatus("✅ " + ids.length + " videos found."))));
    row.appendChild(iconBtn("⏳", "Add ALL to Watch Later", () => withIds(async (ids) => {
      const n = await addTo("WL", ids, (d, tot) => setStatus("⏳ Adding " + d + "/" + tot)); setStatus("✅ Added " + n + " to Watch Later.");
    })));
    row.appendChild(iconBtn("➕", "Add ALL to a playlist (paste its ID/URL)", () => withIds(async (ids) => {
      const target = parsePid(prompt("Target playlist ID or URL:")); if (!target) return setStatus("Cancelled.");
      const n = await addTo(target, ids, (d, tot) => setStatus("⏳ Adding " + d + "/" + tot)); setStatus("✅ Added " + n + " to " + target + ".");
    })));
    if (c.type === "playlist") {
      row.appendChild(iconBtn("🗑️", "Remove ALL from THIS playlist", () => withIds(async (ids, ctx) => {
        if (!confirm("Remove ALL " + ids.length + " videos from this playlist?")) return setStatus("Cancelled.");
        const n = await removeFrom(ctx.id, ids, (d, tot) => setStatus("⏳ Removing " + d + "/" + tot)); setStatus("✅ Removed " + n + ". Reload to refresh.");
      })));
    }
    row.appendChild(iconBtn("📋", "Copy all video URLs", () => withIds(async (ids) => {
      await navigator.clipboard.writeText(ids.map((id) => "https://youtu.be/" + id).join("\n")); setStatus("✅ Copied " + ids.length + " URLs.");
    })));
    row.appendChild(iconBtn("💾", "Export all as CSV", () => withIds((ids, ctx) => {
      download((ctx.id || "youtube") + ".csv", "videoId,url\n" + ids.map((id) => id + ",https://youtu.be/" + id).join("\n"), "text/csv");
      setStatus("✅ Exported " + ids.length + " rows.");
    })));
    row.appendChild(iconBtn("🧾", "Export all as JSON", () => withIds((ids, ctx) => {
      download((ctx.id || "youtube") + ".json", JSON.stringify({ source: ctx.label, videoIds: ids }, null, 2), "application/json");
      setStatus("✅ Exported " + ids.length + " ids.");
    })));
    panel.appendChild(row);

    statusEl = document.createElement("div");
    Object.assign(statusEl.style, { marginTop: "8px", minHeight: "16px", opacity: ".9" });
    panel.appendChild(statusEl);
    document.body.appendChild(panel);
  }

  function mountButton() {
    if (document.getElementById("yt-ms-btn")) return;
    const b = document.createElement("button");
    b.id = "yt-ms-btn"; b.textContent = "☑ Multiselect"; b.title = "YouTube Multiselect (API) — bulk actions on all videos here";
    Object.assign(b.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: 99999, padding: "10px 14px",
      border: "0", borderRadius: "20px", background: "#065fd4", color: "#fff", cursor: "pointer", font: "600 13px Roboto, Arial", boxShadow: "0 2px 10px rgba(0,0,0,.4)" });
    b.onclick = togglePanel;
    document.body.appendChild(b);
  }

  mountButton();
  new MutationObserver(() => mountButton()).observe(document.documentElement, { childList: true, subtree: true });
})();
