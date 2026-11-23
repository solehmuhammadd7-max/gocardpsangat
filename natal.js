/* natal.js - tema Natal & Tahun Baru: salju, hitungan mundur, pemutar lagu.
   Ringan: tanpa library, salju berhenti saat tab disembunyikan / "kurangi gerakan" aktif.
   Ubah pengaturan di bagian CONFIG. */
(function () {
  "use strict";
  var CONFIG = {
    // Target tahun baru: 1 Jan 2027 00:00 WIB (= 31 Des 2026 17:00 UTC)
    target: Date.UTC(2026, 11, 31, 17, 0, 0),
    tahun: 2027,
    // Pilihan radio bawaan di panel High Command. Tambah sendiri: ["Nama", "url stream mp3/aac"]
    radio: [
      ["Christmas Lounge", "https://ice1.somafm.com/christmas-128-mp3"],
      ["Christmas Rocks", "https://ice1.somafm.com/xmasrocks-128-mp3"]
    ]
  };

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var LS = "natal-v1";
  var st = {};
  try { st = JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) {}
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

  /* ---------- CSS ---------- */
  var css = [
    ":root{--bg:#fbf4e6;--ink:#2b1a14;--border:#e4d3b3;--border-strong:#2b1a14;--red:#b3262e;--red-light:#d9534f;--rose-deep:#8e1c24;--pink-soft:#f6e3d2;--text:#33241c;--muted:#7a6454;--faint:#a89683;--green:#1e5a3c;--gold:#c79a2e}",
    "body::selection{background:var(--green)}",
    ".nt-lights{position:fixed;top:0;left:0;right:0;height:26px;z-index:60;pointer-events:none;display:flex;justify-content:space-around;overflow:hidden;background:linear-gradient(#0000,#0000)}",
    ".nt-lights::before{content:'';position:absolute;left:-2%;right:-2%;top:-14px;height:24px;border-bottom:2px solid #3b2a20;border-radius:0 0 50% 50%/0 0 100% 100%}",
    ".nt-lights i{position:relative;top:6px;width:9px;height:13px;border-radius:50% 50% 55% 55%;background:var(--c);box-shadow:0 0 8px 1px var(--c);animation:ntb 1.8s ease-in-out infinite;animation-delay:var(--d)}",
    ".nt-lights i::before{content:'';position:absolute;left:2px;top:-4px;width:5px;height:5px;background:#3b2a20;border-radius:1px}",
    "@keyframes ntb{50%{opacity:.35;box-shadow:0 0 2px 0 var(--c)}}",
    "body{padding-top:14px}",
    ".navbar{border-bottom:3px double var(--red)}",
    "#nt-snow{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70}",
    ".nt-cd{position:fixed;left:14px;bottom:14px;z-index:80;background:#2a1712;color:#f7ecd7;border:1px solid var(--gold);border-radius:4px;padding:9px 12px 10px;font-family:var(--f-disp,sans-serif);box-shadow:0 4px 14px #0004;max-width:calc(100vw - 90px);animation:rise .5s both}",
    ".nt-cd small{display:flex;justify-content:space-between;gap:12px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);cursor:pointer;user-select:none}",
    ".nt-cd .t{display:flex;gap:10px;margin-top:4px}",
    ".nt-cd .t div{text-align:center;min-width:34px}",
    ".nt-cd b{display:block;font-size:26px;line-height:1;font-weight:700;font-variant-numeric:tabular-nums}",
    ".nt-cd em{font-style:normal;font-size:10px;letter-spacing:.1em;text-transform:uppercase;opacity:.7}",
    ".nt-cd.min .t{display:none}",
    ".nt-cd.done b{font-size:22px}",
    ".nt-mu{position:fixed;right:14px;bottom:14px;z-index:80;font-family:var(--f-body,sans-serif)}",
    ".nt-fab{width:46px;height:46px;border-radius:50%;border:2px solid var(--gold);background:var(--red);color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 4px 14px #0004}",
    ".nt-fab svg{width:22px;height:22px;fill:currentColor}",
    ".nt-fab.on{animation:ntp 2.4s ease-in-out infinite}",
    "@keyframes ntp{50%{box-shadow:0 0 0 7px #b3262e33}}",
    ".nt-pn{position:absolute;right:0;bottom:56px;width:278px;background:#fffaf0;border:1px solid var(--border-strong);border-radius:4px;padding:12px;box-shadow:0 8px 24px #0004;display:none;color:var(--text);font-size:13px}",
    ".nt-pn.open{display:block;animation:rise .25s both}",
    ".nt-pn h4{margin:0 0 8px;font:700 17px var(--f-disp,sans-serif);color:var(--red);letter-spacing:.04em;text-transform:uppercase}",
    ".nt-tabs{display:flex;margin-bottom:8px;border:1px solid var(--border-strong);border-radius:3px;overflow:hidden}",
    ".nt-tabs button{flex:1;padding:6px;border:0;background:#fff;cursor:pointer;font:600 12px var(--f-body,sans-serif);color:var(--text)}",
    ".nt-tabs button.a{background:var(--green);color:#fff}",
    ".nt-pn input[type=text],.nt-pn select{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid var(--border-strong);border-radius:3px;background:#fff;font:13px var(--f-body,sans-serif);margin-bottom:8px}",
    ".nt-row{display:flex;gap:8px;align-items:center}",
    ".nt-row button{padding:7px 12px;border:0;border-radius:3px;background:var(--red);color:#fff;font:600 13px var(--f-body,sans-serif);cursor:pointer}",
    ".nt-row input[type=range]{flex:1;accent-color:var(--red)}",
    ".nt-msg{margin-top:6px;font-size:12px;color:var(--muted);min-height:16px}",
    "#nt-yt{position:fixed;left:-9999px;top:0;width:200px;height:200px}",
    "@media(max-width:520px){.nt-cd{left:8px;bottom:8px;padding:7px 9px}.nt-cd b{font-size:20px}.nt-cd .t{gap:6px}.nt-mu{right:8px;bottom:8px}.nt-pn{width:min(278px,calc(100vw - 20px))}}",
    "@media(prefers-reduced-motion:reduce){.nt-lights i,.nt-fab.on{animation:none}}"
  ].join("\n");
  var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  function init() {
    /* ---------- lampu hias ---------- */
    var L = el("div", "nt-lights"); L.setAttribute("aria-hidden", "true");
    var cols = ["#d9322f", "#e7b73a", "#2f9e5b", "#3b82c4"];
    var n = Math.max(10, Math.round(innerWidth / 70));
    for (var i = 0; i < n; i++) { var b = el("i"); b.style.setProperty("--c", cols[i % 4]); b.style.setProperty("--d", (i % 5) * 0.35 + "s"); L.appendChild(b); }
    document.body.appendChild(L);

    /* ---------- countdown ---------- */
    var cd = el("div", "nt-cd" + (st.cdMin ? " min" : ""));
    cd.innerHTML = "<small><span id=nt-lb>Menuju Tahun Baru " + CONFIG.tahun + "</span><span id=nt-tg>" + (st.cdMin ? "+" : "&minus;") + "</span></small>" +
      "<div class=t><div><b id=nt-d>0</b><em>hari</em></div><div><b id=nt-h>00</b><em>jam</em></div><div><b id=nt-m>00</b><em>menit</em></div><div><b id=nt-s>00</b><em>detik</em></div></div>";
    document.body.appendChild(cd);
    cd.querySelector("small").onclick = function () {
      cd.classList.toggle("min"); st.cdMin = cd.classList.contains("min"); cd.querySelector("#nt-tg").innerHTML = st.cdMin ? "+" : "&minus;"; save();
    };
    var $ = function (id) { return cd.querySelector("#nt-" + id); }, fired = false;
    function p2(x) { return x < 10 ? "0" + x : "" + x; }
    function tick() {
      var diff = CONFIG.target - Date.now();
      if (diff <= 0) {
        if (Date.now() - CONFIG.target > 36 * 3600e3) { cd.style.display = "none"; return; }
        cd.classList.add("done"); cd.querySelector(".t").innerHTML = "<b>Selamat Tahun Baru " + CONFIG.tahun + "!</b>";
        $("lb").textContent = "Happy New Year";
        if (!fired) { fired = true; if (!reduce) fireworks(); }
        return;
      }
      var t = Math.floor(diff / 1000);
      $("d").textContent = Math.floor(t / 86400); $("h").textContent = p2(Math.floor(t % 86400 / 3600));
      $("m").textContent = p2(Math.floor(t % 3600 / 60)); $("s").textContent = p2(t % 60);
    }
    tick(); setInterval(tick, 1000);

    /* ---------- salju + kembang api (satu canvas) ---------- */
    var cv = el("canvas"); cv.id = "nt-snow"; cv.setAttribute("aria-hidden", "true"); document.body.appendChild(cv);
    var ctx = cv.getContext("2d"), W, H, flakes = [], sparks = [], run = !reduce, raf;
    function size() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
    size(); addEventListener("resize", size);
    var count = innerWidth < 600 ? 28 : 55;
    for (var k = 0; k < count; k++) flakes.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2.2 + 0.8, v: Math.random() * 0.8 + 0.4, p: Math.random() * 6 });
    function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.92)";
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i]; f.y += f.v; f.p += 0.015; f.x += Math.sin(f.p) * 0.4;
        if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.3); ctx.fill();
      }
      for (var j = sparks.length - 1; j >= 0; j--) {
        var q = sparks[j]; q.x += q.vx; q.y += q.vy; q.vy += 0.04; q.a -= 0.012;
        if (q.a <= 0) { sparks.splice(j, 1); continue; }
        ctx.globalAlpha = q.a; ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, 2.5, 2.5);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function fireworks() {
      var colors = ["#ffd35a", "#ff5d5d", "#62d98a", "#ffffff", "#6cb8ff"], bursts = 0;
      var iv = setInterval(function () {
        var cx = Math.random() * W * 0.8 + W * 0.1, cy = Math.random() * H * 0.4 + 40, c = colors[bursts % 5];
        for (var a = 0; a < 46; a++) { var ang = Math.random() * 6.28, sp = Math.random() * 3 + 1; sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, a: 1, c: c }); }
        if (++bursts > 14) clearInterval(iv);
      }, 450);
    }
    if (run) frame();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) cancelAnimationFrame(raf); else if (run) frame();
    });

    /* ---------- musik bersama ----------
       Setelan (URL, volume, on/off) disimpan di server lewat /api/musik.
       Hanya High Command yang bisa mengubah; semua user ikut mendengar. */
    var mu = el("div", "nt-mu");
    var note = '<svg viewBox="0 0 24 24"><path d="M9 3v11.3A3.5 3.5 0 1 0 11 17.5V8h7V3H9z"/></svg>';
    mu.innerHTML = '<div class="nt-pn" id="nt-pn"><h4>Musik Server</h4>' +
      '<div class="nt-msg" style="margin:0 0 8px">Berlaku untuk semua user yang sedang membuka website.</div>' +
      '<input type="text" id="nt-url" placeholder="Link YouTube atau link stream radio (mp3/aac)">' +
      '<select id="nt-sel"><option value="">Pilih radio bawaan...</option></select>' +
      '<div class="nt-row" style="margin-bottom:8px"><span>Volume</span><input type="range" id="nt-vol" min="0" max="100"><b id="nt-vv" style="min-width:30px;text-align:right">50</b></div>' +
      '<div class="nt-row"><button id="nt-save">Simpan &amp; Putar</button><button id="nt-off" style="background:#555">Matikan</button></div>' +
      '<div class="nt-msg" id="nt-msg"></div>' +
      '<div class="nt-row" style="margin-top:6px"><label style="font-size:12px"><input type="checkbox" id="nt-mute"> Bisukan di perangkat ini</label></div></div>' +
      '<button class="nt-fab" id="nt-fab" aria-label="Musik">' + note + '</button>';
    document.body.appendChild(mu);
    var $m = function (id) { return mu.querySelector("#nt-" + id); };
    var pn = $m("pn"), fab = $m("fab"), msg = $m("msg"), sel = $m("sel"), isHC = false;
    mu.style.display = "none"; // tampil setelah ada musik aktif atau user adalah HC
    CONFIG.radio.forEach(function (r) { var o = el("option"); o.value = r[1]; o.textContent = r[0]; sel.appendChild(o); });
    sel.onchange = function () { if (sel.value) $m("url").value = sel.value; };
    $m("mute").checked = !!st.mute;

    var audio = new Audio(); audio.preload = "none";
    var yt = null, cur = null, cfg = { on: false, url: "", volume: 50 }, unlocked = false, playing = false, editing = false;

    function ytId(u) {
      var m = u.match(/[?&]v=([\w-]{11})/) || u.match(/youtu\.be\/([\w-]{11})/) || u.match(/(?:embed|shorts|live)\/([\w-]{11})/);
      var l = u.match(/[?&]list=([\w-]+)/);
      return { v: m && m[1], l: l && l[1], is: /youtu\.?be/.test(u) };
    }
    function loadYT(cb) {
      if (window.YT && YT.Player) return cb();
      if (!document.getElementById("nt-ytapi")) { var t = document.createElement("script"); t.id = "nt-ytapi"; t.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(t); }
      var old = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = function () { if (old) old(); cb(); };
    }
    function setVol() {
      var v = cfg.volume, mute = !!st.mute;
      audio.volume = v / 100; audio.muted = mute;
      if (yt && yt.setVolume) try { yt.setVolume(v); mute ? yt.mute() : yt.unMute(); } catch (e) {}
    }
    function state(on) { playing = on; fab.classList.toggle("on", on && !st.mute); }
    function halt() {
      cur = null; audio.pause(); audio.removeAttribute("src");
      if (yt) { try { yt.destroy(); } catch (e) {} yt = null; }
      var h = document.getElementById("nt-yt"); if (h) h.innerHTML = "";
      state(false);
    }
    function start() {
      if (!cfg.on || !cfg.url) return halt();
      cur = cfg.url + "|" + cfg.updatedAt;
      var id = ytId(cfg.url);
      if (id.is) {
        if (!id.v && !id.l) return state(false);
        audio.pause();
        loadYT(function () {
          var h = document.getElementById("nt-yt") || document.body.appendChild(el("div")); h.id = "nt-yt"; h.innerHTML = "<div id=nt-ytp></div>";
          var pv = { autoplay: 1, playsinline: 1, controls: 0 };
          if (id.l) { pv.listType = "playlist"; pv.list = id.l; pv.loop = 1; }
          yt = new YT.Player("nt-ytp", {
            width: 200, height: 200, videoId: id.v || undefined, playerVars: pv,
            events: {
              onReady: function (e) { setVol(); e.target.playVideo(); state(true); },
              onStateChange: function (e) { if (e.data === 0 && !id.l) { e.target.seekTo(0); e.target.playVideo(); } },
              onError: function () { state(false); if (isHC) msg.textContent = "Video ini tidak bisa diputar (embed dimatikan pemiliknya)."; }
            }
          });
        });
      } else {
        if (yt) { try { yt.destroy(); } catch (e) {} yt = null; }
        audio.src = cfg.url; setVol();
        audio.play().then(function () { state(true); }).catch(function () { state(false); });
      }
    }
    audio.onerror = function () { if (audio.src) { state(false); if (isHC) msg.textContent = "Stream tidak bisa dibuka."; } };

    function apply(c) {
      if (!c) return;
      var changed = c.url !== cfg.url || c.updatedAt !== cfg.updatedAt || c.on !== cfg.on;
      cfg = c; setVol();
      mu.style.display = (c.on || isHC) ? "" : "none";
      if (!c.on) { if (cur) halt(); return; }
      if (changed || !cur) { if (unlocked || !cur) start(); }
    }
    function poll() {
      if (document.hidden || editing) return;
      fetch("/api/musik", { credentials: "include", cache: "no-store" }).then(function (r) { return r.json(); }).then(apply).catch(function () {});
    }

    // browser memblokir suara sebelum ada interaksi: mulai pada klik/ketuk pertama
    function unlock() {
      unlocked = true;
      document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock);
      if (cfg.on && !playing) start();
    }
    document.addEventListener("pointerdown", unlock); document.addEventListener("keydown", unlock);

    fab.onclick = function () {
      if (isHC) { pn.classList.toggle("open"); editing = pn.classList.contains("open"); if (editing) { $m("url").value = cfg.url || ""; $m("vol").value = cfg.volume; $m("vv").textContent = cfg.volume; } return; }
      st.mute = !st.mute; save(); setVol(); state(playing);
      fab.style.opacity = st.mute ? ".55" : "1";
    };
    $m("mute").onchange = function () { st.mute = this.checked; save(); setVol(); state(playing); };
    $m("vol").oninput = function () { $m("vv").textContent = this.value; };

    function kirim(body, ok) {
      msg.textContent = "Menyimpan...";
      fetch("/api/musik", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Gagal menyimpan."); return d; }); })
        .then(function (d) { unlocked = true; apply(d); msg.textContent = ok; })
        .catch(function (e) { msg.textContent = e.message; });
    }
    $m("save").onclick = function () { kirim({ url: $m("url").value.trim(), volume: +$m("vol").value, on: true }, "Tersimpan. Semua user akan mendengar lagu ini."); };
    $m("off").onclick = function () { kirim({ on: false, volume: +$m("vol").value }, "Musik dimatikan untuk semua user."); };

    // cek apakah user ini High Command (warga / belum login = bukan)
    fetch("/api/me", { credentials: "include" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { var u = d && (d.user || d); isHC = !!(u && u.isHighCommand); if (!isHC) pn.remove(); mu.style.display = isHC ? "" : mu.style.display; })
      .catch(function () { pn.remove(); })
      .then(poll);
    setInterval(poll, 20000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
