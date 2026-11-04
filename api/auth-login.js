const kvStore = require("../lib/kv");
const { verifyPassword } = require("../lib/password");
const { setSessionCookie, sanitizeUser } = require("../lib/auth");
const crypto = require("crypto");
const session = require("../lib/session");
const mail = require("../lib/mail");
const { hashPassword } = require("../lib/password");
const { jakartaTodayISO } = require("../lib/waktu");
const { PANGKAT_LIST } = require("../lib/pangkat");
const warga = require("../lib/warga");

const SESSION_TTL_SEC = 12 * 60 * 60;

function redirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.headers.host}/api/auth-login`;
}
function appendCookies(res, ...cookies) { res.setHeader("Set-Cookie", cookies); }

// Halaman tujuan setelah login Discord (whitelist — nggak boleh redirect sembarangan).
const TUJUAN = { warga: "/warga.html", profil: "/profil.html" };
function urlIzin(req, clientId, state, senyap) {
  const p = { client_id: clientId, response_type: "code", redirect_uri: redirectUri(req), scope: warga.discordScope(), state };
  if (senyap) p.prompt = "none"; // sudah pernah izinkan -> langsung masuk tanpa layar konfirmasi
  return "https://discord.com/oauth2/authorize?" + new URLSearchParams(p).toString();
}

// ====== Login Discord untuk WARGA ======
// Endpoint ini sudah penuh (limit 12 function Vercel Hobby), jadi login Discord
// numpang di sini lewat method GET:
//   GET /api/auth-login?aksi=discord      -> lempar ke halaman izin Discord
//   GET /api/auth-login?code=..&state=..  -> callback dari Discord (Redirect URI)
//   GET /api/auth-login?aksi=warga-me     -> profil warga + papan iklan (JSON)
//   GET /api/auth-login?aksi=warga-beranda -> profil + iklan + ringkasan forum (dashboard warga)
//   GET /api/auth-login?aksi=discord&next=profil -> sinkron ulang dari Discord, balik ke profil
//   POST /api/auth-login?aksi=warga-profil  -> edit bio / nama tampilan
//   POST /api/auth-login?aksi=warga-logout
async function handleWargaGet(req, res) {
  const q = req.query || {};

  if (q.aksi === "warga-me") {
    let w;
    try { w = await warga.getWargaFromReq(req); }
    catch (err) { return res.status(500).json({ error: "Gagal konek ke database." }); }
    if (!w) return res.status(401).json({ error: "Belum login." });
    let iklan = [];
    try { iklan = await kvStore.getIklan(); } catch (e) { /* iklan opsional */ }
    return res.json({ warga: warga.sanitizeWarga(w), iklan });
  }

  // Data dashboard warga: profil + iklan + ringkasan forum (stat, pengumuman, aktivitas).
  if (q.aksi === "warga-beranda") {
    let w;
    try { w = await warga.getWargaFromReq(req); }
    catch (err) { return res.status(500).json({ error: "Gagal konek ke database." }); }
    if (!w) return res.status(401).json({ error: "Belum login." });
    let iklan = [], ring = {};
    try { iklan = await kvStore.getIklan(); } catch (e) { /* opsional */ }
    
    return res.json({ warga: warga.sanitizeWarga(w), iklan, ...ring });
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (q.aksi === "discord") {
    if (!clientId || !clientSecret) {
      return res.redirect(302, "/index.html?err=" + encodeURIComponent("Login Discord belum di-setup (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)."));
    }
    // state = acak~tujuan. Tujuan ikut di state (dicek sama cookie) biar tombol
    // "Sinkronkan dari Discord" di halaman profil balik lagi ke profil.
    const tujuan = TUJUAN[q.next] ? q.next : "warga";
    const state = warga.newState() + "~" + tujuan;
    appendCookies(res, warga.stateCookie(req, state));
    return res.redirect(302, urlIzin(req, clientId, state, true));
  }

  if (q.code || q.error) {
    const balik = (msg) => {
      appendCookies(res, warga.clearStateCookie(req));
      return res.redirect(302, "/index.html?err=" + encodeURIComponent(msg));
    };
    const savedState = req.cookies?.[warga.STATE_COOKIE];
    const stateOk = !!savedState && savedState === q.state;
    // Discord minta izin baru (mis. habis nambah izin baca role server) -> ulangi
    // TANPA prompt=none supaya layar izin muncul. Nggak bisa loop: URL ini tanpa prompt=none.
    if (q.error && stateOk && ["interaction_required", "consent_required", "login_required"].includes(String(q.error)) && clientId) {
      return res.redirect(302, urlIzin(req, clientId, savedState, false));
    }
    if (q.error) return balik("Login Discord dibatalkan.");
    if (!stateOk) return balik("Sesi login Discord kedaluwarsa, coba lagi.");
    if (!clientId || !clientSecret) return balik("Login Discord belum di-setup.");
    const tujuan = TUJUAN[String(q.state).split("~")[1]] || TUJUAN.warga;

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code: String(q.code),
          redirect_uri: redirectUri(req),
        }),
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok || !token.access_token) throw new Error(token.error_description || token.error || "token ditolak");

      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const dc = await meRes.json();
      if (!meRes.ok || !dc.id) throw new Error("gagal ambil profil Discord");

      const list = await kvStore.getWarga();
      const now = new Date().toISOString();
      let w = list.find((x) => x.discordId === dc.id);
      if (!w) {
        w = { id: crypto.randomBytes(8).toString("hex"), discordId: dc.id, pertamaLogin: now };
        list.push(w);
      }
      w.username = dc.username;
      w.globalName = dc.global_name || null;
      w.avatar = dc.avatar || null;
      w.banner = dc.banner || null;
      w.accent = typeof dc.accent_color === "number" ? dc.accent_color : null;
      w.terakhirLogin = now;

      // Role & nickname di server Discord (opsional, cuma kalau DISCORD_GUILD_ID diisi).
      // 404 = dia bukan member server -> role dikosongkan. Error lain (jaringan/rate
      // limit) -> role lama dibiarkan, jangan sampai label hilang gara-gara gangguan sesaat.
      const cfg = warga.roleConfig();
      if (cfg.guildId && String(token.scope || "").includes("guilds.members.read")) {
        try {
          const gm = await fetch(`https://discord.com/api/users/@me/guilds/${encodeURIComponent(cfg.guildId)}/member`, {
            headers: { Authorization: `Bearer ${token.access_token}` },
          });
          if (gm.ok) {
            const m = await gm.json();
            w.roleIds = Array.isArray(m.roles) ? m.roles.map(String) : [];
            w.nick = m.nick || null;
            w.terakhirSinkron = now;
          } else if (gm.status === 404) {
            w.roleIds = []; w.nick = null; w.terakhirSinkron = now;
          }
        } catch (e) { console.error("[auth-login/discord] gagal baca role server:", e.message); }
      }
      await kvStore.setWarga(list);

      appendCookies(res, warga.setWargaCookie(req, res, w.id), warga.clearStateCookie(req));
      return res.redirect(302, tujuan);
    } catch (err) {
      console.error("[auth-login/discord] gagal:", err.message);
      return balik("Login Discord gagal, coba lagi.");
    }
  }

  return res.status(400).json({ error: "Permintaan tidak dikenal." });
}


// ====== Verifikasi Gmail (daftar & login dari IP baru) ======
//   POST ?aksi=reg-kirim   {username,password,email,namaKarakter,pangkat} -> kirim kode ke Gmail
//   POST ?aksi=reg-verif   {email,code}                                    -> akun dibuat (pending approval)
//   POST ?aksi=login-bind  {pre,email}   -> akun lama belum punya Gmail: kirim kode ke Gmail barunya
//   POST ?aksi=login-verif {pre,code}    -> cek kode, simpan IP, buat sesi
//   POST ?aksi=login-ulang {pre}         -> kirim ulang kode
const OTP_TTL = 600, MAX_TRY = 5, MAX_IP = 10;
const ERR_KODE = "Kode salah atau sudah kedaluwarsa.";

async function kirimOtp(key, data, email, tujuan) {
  const cd = await kvStore.otpGet("cd:" + key);
  if (cd) throw Object.assign(new Error("Tunggu 60 detik sebelum minta kode lagi."), { status: 429 });
  const kode = mail.kode6();
  await kvStore.otpSet(key, { ...data, email, h: mail.hashKode(kode), tries: 0 }, OTP_TTL);
  await kvStore.otpSet("cd:" + key, 1, 60);
  await mail.kirimKode(email, kode, tujuan);
}
async function cekOtp(key, code) {
  const o = await kvStore.otpGet(key);
  if (!o) return null;
  if (o.tries >= MAX_TRY) { await kvStore.otpDel(key); return null; }
  if (mail.hashKode(String(code || "").trim()) !== o.h) {
    o.tries++; await kvStore.otpSet(key, o, OTP_TTL); return null;
  }
  await kvStore.otpDel(key);
  return o;
}
function lolosKeSesi(res, users, user, ip) {
  user.knownIps = [ip, ...(user.knownIps || []).filter((x) => x !== ip)].slice(0, MAX_IP);
  return kvStore.setUsers(users).then(() => {
    setSessionCookie(res, user.id, SESSION_TTL_SEC);
    res.json({ ok: true, user: sanitizeUser(user) });
  });
}
function preUser(pre) {
  const p = session.verify(pre);
  return p && p.pre ? p.pre : null;
}
const makePre = (id) => session.sign({ pre: id, exp: Date.now() + OTP_TTL * 1000 });

async function handleOtpPost(req, res, aksi) {
  const b = req.body || {};
  try {
    if (aksi === "reg-kirim") {
      const username = String(b.username || "").trim(), email = String(b.email || "").trim().toLowerCase();
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return res.status(400).json({ error: "Username 3-24 karakter (huruf/angka/_ . -)." });
      if (String(b.password || "").length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
      if (!mail.cekGmail(email)) return res.status(400).json({ error: "Harus pakai alamat Gmail (@gmail.com)." });
      const users = await kvStore.getUsers();
      if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "Username sudah dipakai." });
      if (users.some((u) => (u.email || "").toLowerCase() === email)) return res.status(409).json({ error: "Gmail ini sudah terdaftar." });
      const pangkat = PANGKAT_LIST.includes(b.pangkat) ? b.pangkat : PANGKAT_LIST[PANGKAT_LIST.length - 1];
      await kirimOtp("reg:" + email, { username, passwordHash: hashPassword(String(b.password)), namaKarakter: String(b.namaKarakter || "").trim().slice(0, 40), pangkat }, email, "Masukkan kode ini untuk menyelesaikan pendaftaran akun kamu.");
      return res.json({ ok: true });
    }
    if (aksi === "reg-verif") {
      const email = String(b.email || "").trim().toLowerCase();
      const o = await cekOtp("reg:" + email, b.code);
      if (!o) return res.status(400).json({ error: ERR_KODE });
      const users = await kvStore.getUsers();
      if (users.some((u) => u.username.toLowerCase() === o.username.toLowerCase())) return res.status(409).json({ error: "Username sudah dipakai." });
      users.push({ id: crypto.randomBytes(8).toString("hex"), username: o.username, passwordHash: o.passwordHash, namaKarakter: o.namaKarakter, pangkat: o.pangkat, email, emailVerified: true, isHighCommand: false, avatar: null, status: "pending", bergabung: jakartaTodayISO(), knownIps: [mail.getIp(req)] });
      await kvStore.setUsers(users);
      return res.json({ ok: true });
    }
    const uid = preUser(b.pre);
    if (!uid) return res.status(401).json({ error: "Sesi verifikasi habis, login ulang." });
    const users = await kvStore.getUsers();
    const user = users.find((u) => u.id === uid);
    if (!user) return res.status(404).json({ error: "Akun tidak ditemukan." });
    const ip = mail.getIp(req);
    if (aksi === "login-bind") {
      if (user.email) return res.status(400).json({ error: "Akun ini sudah punya Gmail." });
      const email = String(b.email || "").trim().toLowerCase();
      if (!mail.cekGmail(email)) return res.status(400).json({ error: "Harus pakai alamat Gmail (@gmail.com)." });
      if (users.some((u) => (u.email || "").toLowerCase() === email)) return res.status(409).json({ error: "Gmail ini sudah dipakai akun lain." });
      await kirimOtp("login:" + uid, { ip }, email, "Masukkan kode ini untuk menautkan Gmail ke akun kamu.");
      return res.json({ ok: true, email: mail.maskEmail(email) });
    }
    if (aksi === "login-ulang") {
      const o = await kvStore.otpGet("login:" + uid);
      const email = user.email || (o && o.email);
      if (!email) return res.status(400).json({ error: "Isi Gmail dulu." });
      await kirimOtp("login:" + uid, { ip }, email, "Ada login dari perangkat/IP baru. Masukkan kode ini untuk melanjutkan.");
      return res.json({ ok: true });
    }
    if (aksi === "login-verif") {
      const o = await cekOtp("login:" + uid, b.code);
      if (!o) return res.status(400).json({ error: ERR_KODE });
      if (!user.email) { user.email = o.email; user.emailVerified = true; }
      return await lolosKeSesi(res, users, user, ip);
    }
    return res.status(400).json({ error: "Permintaan tidak dikenal." });
  } catch (err) {
    console.error("[auth-login/otp]", err.message);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Gagal memproses / mengirim email: " + err.message });
  }
}

module.exports = async (req, res) => {
  const aksi = req.query && req.query.aksi;

  if (req.method === "POST" && /^(reg-|login-)/.test(String(aksi))) return handleOtpPost(req, res, aksi);

  // Warga (login Discord)
  if (req.method === "GET") return handleWargaGet(req, res);
  if (req.method === "POST" && req.query && req.query.aksi === "warga-logout") {
    appendCookies(res, warga.clearWargaCookie(req));
    return res.json({ ok: true });
  }

  // Edit profil warga: bio, nama tampilan, sinkron nama dengan Discord.
  // Avatar/banner/nickname/label SELALU ikut Discord (nggak bisa diedit di sini).
  if (req.method === "POST" && req.query && req.query.aksi === "warga-profil") {
    let me;
    try { me = await warga.getWargaFromReq(req); }
    catch (err) { return res.status(500).json({ error: "Gagal konek ke database." }); }
    if (!me) return res.status(401).json({ error: "Belum login." });
    const b = req.body || {};
    const list = await kvStore.getWarga();
    const t = list.find((x) => x.id === me.id);
    if (!t) return res.status(404).json({ error: "Akun tidak ditemukan." });

    if (b.bio !== undefined) t.bio = String(b.bio).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 300);
    if (b.sinkron !== undefined) t.sinkron = !!b.sinkron;
    if (b.namaKustom !== undefined) {
      const n = String(b.namaKustom).replace(/\s+/g, " ").trim().slice(0, 32);
      const err = warga.cekNamaAman(n);
      if (err) return res.status(400).json({ error: err });
      t.namaKustom = n;
    }
    if (t.sinkron === false && !t.namaKustom) return res.status(400).json({ error: "Isi nama tampilan dulu kalau sinkron nama Discord dimatikan." });
    await kvStore.setWarga(list);
    return res.json({ ok: true, warga: warga.sanitizeWarga(t) });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  // Anggota (username + password). Pendaftaran mandiri sudah DIHAPUS —
  // akun anggota cuma dibuat High Command (Panel Rekap / bot Discord).
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username & password wajib diisi." });

  let users;
  try {
    users = await kvStore.getUsers();
  } catch (err) {
    console.error("[auth-login] gagal konek Upstash:", err.message);
    return res.status(500).json({ error: "Gagal konek ke database — cek UPSTASH_REDIS_REST_URL/TOKEN di Environment Variables." });
  }

  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  if (user.status === "pending") {
    return res.status(403).json({ error: "Akun kamu masih menunggu approval High Command." });
  }
  if (user.status === "ditolak") {
    return res.status(403).json({ error: "Akun kamu ditolak. Hubungi Perwira Tinggi." });
  }

  // IP baru -> wajib kode Gmail. Akun lama tanpa Gmail diminta menautkan Gmail dulu.
  const ip = mail.getIp(req);
  try {
    if (!user.email) return res.json({ need: "bind", pre: makePre(user.id) });
    if (!(user.knownIps || []).includes(ip)) {
      await kirimOtp("login:" + user.id, { ip }, user.email, "Ada login dari perangkat/IP baru. Masukkan kode ini untuk melanjutkan.");
      return res.json({ need: "code", pre: makePre(user.id), email: mail.maskEmail(user.email) });
    }
    await lolosKeSesi(res, users, user, ip);
  } catch (err) {
    console.error("[auth-login] gagal:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Gagal mengirim kode ke Gmail / membuat sesi: " + err.message });
  }
};
