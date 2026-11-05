const kvStore = require("../lib/kv");
const { verifyPassword, hashPassword } = require("../lib/password");
const { PANGKAT_LIST } = require("../lib/pangkat");
const { jakartaTodayISO } = require("../lib/waktu");
const { notifyPendaftaranBaru } = require("../lib/discord");
const { setSessionCookie, sanitizeUser } = require("../lib/auth");
const crypto = require("crypto");
const warga = require("../lib/warga");
const forum = require("../lib/forum");

const SESSION_TTL_SEC = 12 * 60 * 60;

function appendCookies(res, ...cookies) { res.setHeader("Set-Cookie", cookies); }

// ====== Sesi warga (sisa) ======
// Login Discord sudah DIHAPUS (tidak ada lagi tombol / alur OAuth). Endpoint
// di bawah cuma melayani sesi warga lama yang masih punya cookie:
//   GET  /api/auth-login?aksi=warga-me
//   GET  /api/auth-login?aksi=warga-beranda
//   POST /api/auth-login?aksi=warga-profil
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
    try { ring = await forum.beranda(w); } catch (e) { console.error("[beranda]", e.message); }
    return res.json({ warga: warga.sanitizeWarga(w), iklan, ...ring });
  }

  return res.status(400).json({ error: "Permintaan tidak dikenal." });
}


module.exports = async (req, res) => {
  const aksi = req.query && req.query.aksi;
  if (typeof aksi === "string" && aksi.startsWith("forum-")) return forum.handle(req, res, aksi);

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

  // ====== Pendaftaran akun anggota (mandiri) ======
  // Akun baru berstatus "pending" dan TIDAK bisa login sampai di-approve High
  // Command lewat Panel Rekap -> tab Pendaftaran. Role HC tidak bisa diminta
  // lewat form ini (isHighCommand selalu false).
  if (req.body && req.body.daftar === true) {
    const { username, password, namaKarakter, pangkat } = req.body;
    const uname = String(username || "").trim();
    const nama = String(namaKarakter || "").replace(/\s+/g, " ").trim().slice(0, 100);

    if (!/^[A-Za-z0-9_.-]{3,24}$/.test(uname)) {
      return res.status(400).json({ error: "Username 3-24 karakter: huruf, angka, titik, strip, atau underscore." });
    }
    if (typeof password !== "string" || password.length < 6 || password.length > 100) {
      return res.status(400).json({ error: "Password minimal 6 karakter." });
    }
    if (!nama) return res.status(400).json({ error: "Nama karakter wajib diisi." });
    if (!PANGKAT_LIST.includes(pangkat)) return res.status(400).json({ error: "Pangkat tidak valid." });

    let users;
    try { users = await kvStore.getUsers(); }
    catch (err) {
      console.error("[auth-login/daftar] gagal konek Upstash:", err.message);
      return res.status(500).json({ error: "Gagal konek ke database — coba lagi nanti." });
    }
    if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
      return res.status(409).json({ error: "Username sudah dipakai." });
    }

    const baru = {
      id: crypto.randomBytes(8).toString("hex"),
      username: uname,
      passwordHash: hashPassword(password),
      namaKarakter: nama,
      pangkat,
      isHighCommand: false,
      avatar: null,
      status: "pending",
      bergabung: jakartaTodayISO(),
    };
    users.push(baru);
    try { await kvStore.setUsers(users); }
    catch (err) {
      console.error("[auth-login/daftar] gagal simpan:", err.message);
      return res.status(500).json({ error: "Gagal menyimpan pendaftaran — coba lagi." });
    }

    try { await notifyPendaftaranBaru(baru); } catch (e) { /* notif opsional */ }
    return res.json({ ok: true });
  }

  // Anggota (username + password).
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

  try {
    setSessionCookie(res, user.id, SESSION_TTL_SEC);
  } catch (err) {
    console.error("[auth-login] gagal buat sesi:", err.message);
    return res.status(500).json({ error: "Gagal membuat sesi login — cek SESSION_SECRET sudah diisi." });
  }

  res.json({ ok: true, user: sanitizeUser(user) });
};
