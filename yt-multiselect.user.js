// ==UserScript==
// @name         YouTube Multiselect (API)
// @namespace    https://github.com/chirag127
// @version      2.0.0
// @description  Select videos with checkboxes on ANY YouTube page (search, playlist, subscriptions, channel, home) and bulk Save to Watch Later / playlist, filter-select, export, copy, load entire page — powered by YouTube's InnerTube API. No per-video menu clicking.
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
  const settings = Object.assign({ pos: "bottom-center", confirm: true },
    JSON.parse(localStorage.getItem("ytms") || "{}"));
  const saveSettings = () => localStorage.setItem("ytms", JSON.stringify(settings));

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

  // ---------- selection state ----------
  const selected = new Set();
  let active = false;

  const idFromHref = (href) => {
    const m = (href || "").match(/[?&]v=([A-Za-z0-9_-]{11})/) || (href || "").match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  const thumbAnchors = () =>
    [...document.querySelectorAll('a[href*="/watch?v="],a[href*="/shorts/"]')].filter((a) => a.querySelector("img") && idFromHref(a.href));
  const cardOf = (a) => a.closest("ytd-video-renderer,ytd-rich-item-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer,ytd-playlist-video-renderer,ytd-reel-item-renderer,yt-lockup-view-model") || a.parentElement;

  function paintCb(cb, on) {
    cb.textContent = on ? "✓" : "";
    cb.style.background = on ? "#065fd4" : "rgba(0,0,0,.55)";
    cb.style.borderColor = on ? "#065fd4" : "#fff";
  }
  function toggle(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    document.querySelectorAll('.ytms-cb[data-id="' + id + '"]').forEach((cb) => paintCb(cb, selected.has(id)));
    updateBar();
  }
  function injectCbs() {
    if (!active) return;
    for (const a of thumbAnchors()) {
      if (a.dataset.ytmsDone) continue;
      const id = idFromHref(a.href); if (!id) continue;
      a.dataset.ytmsDone = "1";
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      const cb = document.createElement("div");
      cb.className = "ytms-cb"; cb.dataset.id = id;
      Object.assign(cb.style, { position: "absolute", top: "6px", left: "6px", zIndex: 50, width: "22px", height: "22px",
        borderRadius: "50%", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", font: "600 13px Roboto, Arial", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,.6)" });
      paintCb(cb, selected.has(id));
      cb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }, true);
      a.appendChild(cb);
    }
  }
  const loadedIds = () => [...new Set(thumbAnchors().map((a) => idFromHref(a.href)))];

  function selectAll() { loadedIds().forEach((id) => selected.add(id)); refreshCbs(); updateBar(); }
  function deselectAll() { selected.clear(); refreshCbs(); updateBar(); }
  function refreshCbs() { document.querySelectorAll(".ytms-cb").forEach((cb) => paintCb(cb, selected.has(cb.dataset.id))); }

  async function loadEntirePage(status) {
    let last = -1, stable = 0;
    for (let i = 0; i < 150 && stable < 3; i++) {
      scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 600));
      injectCbs();
      const n = thumbAnchors().length; status && status("Loaded " + n + " videos…");
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
      d.innerHTML = "<span style='display:inline-block;width:24px'>" + ic + "</span>" + label;
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
    item("▶️", "Play all selected", () => withSel((ids) => open("https://www.youtube.com/watch_videos?video_ids=" + ids.join(","), "_blank")));
    if (currentListId()) item("🗑️", "Remove from this playlist", () => withSel(async (ids) => {
      if (settings.confirm && !confirm("Remove " + ids.length + " selected from this playlist?")) return status("Cancelled.");
      const n = await removeFrom(currentListId(), ids, (d, t) => status("Removing " + d + "/" + t)); status("✅ Removed " + n + ". Reload to refresh.");
    }), true);
    item("🔽", "Select with filter…", () => {
      const kw = (prompt("Select videos whose title/channel contains:") || "").trim().toLowerCase(); if (!kw) return;
      let n = 0;
      thumbAnchors().forEach((a) => { const id = idFromHref(a.href); const txt = (cardOf(a).textContent || "").toLowerCase(); if (id && txt.includes(kw)) { selected.add(id); n++; } });
      refreshCbs(); updateBar(); status("✅ Selected " + n + " matching.");
    });
    item("📜", "Load entire page", () => loadEntirePage(status).then(() => status("✅ All loaded. " + loadedIds().length + " videos.")));
    item("📋", "Copy selected URLs", () => withSel(async (ids) => { await navigator.clipboard.writeText(ids.map((i) => "https://youtu.be/" + i).join("\n")); status("✅ Copied " + ids.length + " URLs."); }));
    item("💾", "Export selection (CSV)", () => withSel((ids) => { dl("selection.csv", "videoId,url\n" + ids.map((i) => i + ",https://youtu.be/" + i).join("\n"), "text/csv"); status("✅ Exported " + ids.length + "."); }));
    item("🧾", "Export selection (JSON)", () => withSel((ids) => { dl("selection.json", JSON.stringify(ids, null, 2), "application/json"); status("✅ Exported " + ids.length + "."); }));
    item("⚙️", "Settings & about", openSettings);
    document.body.appendChild(menu);
  }
  function dl(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

  function openSettings() {
    const ov = document.createElement("div");
    Object.assign(ov.style, { position: "fixed", inset: 0, zIndex: 100002, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" });
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const box = document.createElement("div");
    Object.assign(box.style, { background: "#181818", color: "#fff", padding: "20px", borderRadius: "12px", width: "340px", font: "14px Roboto, Arial" });
    box.innerHTML = "<h3 style='margin:0 0 12px'>☑ Multiselect — Settings</h3>";
    const posLabel = document.createElement("div"); posLabel.textContent = "Action bar position:"; posLabel.style.margin = "8px 0 4px"; box.appendChild(posLabel);
    ["bottom-center", "bottom-left"].forEach((p) => {
      const l = document.createElement("label"); l.style.display = "block"; l.style.cursor = "pointer";
      const r = document.createElement("input"); r.type = "radio"; r.name = "ytmspos"; r.checked = settings.pos === p;
      r.onchange = () => { settings.pos = p; saveSettings(); setPos(bar); };
      l.appendChild(r); l.appendChild(document.createTextNode(" " + p)); box.appendChild(l);
    });
    const cl = document.createElement("label"); cl.style.display = "block"; cl.style.margin = "10px 0"; cl.style.cursor = "pointer";
    const cc = document.createElement("input"); cc.type = "checkbox"; cc.checked = settings.confirm; cc.onchange = () => { settings.confirm = cc.checked; saveSettings(); };
    cl.appendChild(cc); cl.appendChild(document.createTextNode(" Confirm before destructive actions")); box.appendChild(cl);
    const about = document.createElement("div"); about.style.marginTop = "14px"; about.style.lineHeight = "1.9";
    about.innerHTML = "<b>About</b> — by chirag127<br>" +
      link("❤️ Donate", LINKS.donate) + " · " + link("GitHub", LINKS.github) + "<br>" +
      link("YouTube", LINKS.youtube) + " · " + link("X", LINKS.x) + " · " + link("LinkedIn", LINKS.linkedin) + "<br>" +
      link("Instagram", LINKS.instagram) + " · " + link("Reddit", LINKS.reddit);
    box.appendChild(about);
    const close = document.createElement("button"); close.textContent = "Close"; Object.assign(close.style, { marginTop: "14px", padding: "8px 14px", border: 0, borderRadius: "8px", background: "#065fd4", color: "#fff", cursor: "pointer" }); close.onclick = () => ov.remove();
    box.appendChild(close); ov.appendChild(box); document.body.appendChild(ov);
  }
  const link = (t, u) => "<a href='" + u + "' target='_blank' style='color:#3ea6ff;text-decoration:none'>" + t + "</a>";

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
  mountFab();
  new MutationObserver(() => { mountFab(); if (active) injectCbs(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
