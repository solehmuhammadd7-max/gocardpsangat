// Sesi & helper untuk WARGA (login Discord). Sengaja dipisah dari lib/auth.js:
// cookie-nya beda nama (nexotis_warga) dan payload-nya bertipe "warga", jadi
// sesi warga TIDAK PERNAH dianggap sesi anggota oleh getUserFromReq().

const crypto = require("crypto");
const kvStore = require("./kv");
const session = require("./session");

const WARGA_COOKIE = "nexotis_warga";
const STATE_COOKIE = "nexotis_oauth_state";
const WARGA_TTL_SEC = 7 * 24 * 60 * 60; // warga bukan akun sensitif, 7 hari

function isLocal(req) {
  const host = String((req && req.headers && req.headers.host) || "");
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
function cookieStr(req, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isLocal(req) ? "" : "; Secure"}`;
}

async function getWargaFromReq(req) {
  const payload = session.verify(req.cookies?.[WARGA_COOKIE]);
  if (!payload || payload.t !== "warga" || !payload.wargaId) return null;
  const list = await kvStore.getWarga();
  return list.find((w) => w.id === payload.wargaId) || null;
}

function setWargaCookie(req, res, wargaId) {
  const token = session.sign({ t: "warga", wargaId, exp: Date.now() + WARGA_TTL_SEC * 1000 });
  return cookieStr(req, WARGA_COOKIE, token, WARGA_TTL_SEC);
}

// state OAuth (anti-CSRF): dibuat pas mulai login, dicek pas Discord balik.
function newState() { return crypto.randomBytes(16).toString("hex"); }
function stateCookie(req, state) { return cookieStr(req, STATE_COOKIE, state, 10 * 60); }
function clearStateCookie(req) { return cookieStr(req, STATE_COOKIE, "", 0); }
function clearWargaCookie(req) { return cookieStr(req, WARGA_COOKIE, "", 0); }

// URL foto profil Discord (atau null kalau nggak punya -> frontend pakai inisial)
function avatarUrl(discordId, avatarHash) {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
}
function bannerUrl(discordId, bannerHash) {
  if (!bannerHash) return null;
  const ext = bannerHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${discordId}/${bannerHash}.${ext}?size=600`;
}

// ====== Nama tampilan ======
// Default: ikut Discord (nickname di server > display name > username).
// Kalau warga mematikan sinkron Discord, pakai nama kustom buatan dia.
function namaDiscord(w) { return w.nick || w.globalName || w.username || "warga"; }
function namaTampil(w) { return w.sinkron === false && w.namaKustom ? w.namaKustom : namaDiscord(w); }

// Nama kustom nggak boleh menyerupai jabatan resmi (cegah orang nyamar jadi HC).
// Label resmi TIDAK PERNAH diambil dari nama — cuma dari akun anggota / role Discord.
const NAMA_TERLARANG = /high\s*command|petinggi|moderator|admin|resmi|\bhc\b/i;
function cekNamaAman(nama) {
  if (!nama) return null;
  if (nama.length < 2) return "Nama tampilan minimal 2 karakter.";
  if (NAMA_TERLARANG.test(nama)) return "Nama itu nggak boleh dipakai (mirip jabatan resmi).";
  return null;
}

// ====== Label otomatis ======
// SEMUA label cuma tampilan. Hak akses (pin/kunci/hapus di forum, dsb) SELALU
// dicek server dari akun anggota (isHighCommand), bukan dari label ini.
//
// Sumber label:
//  - Akun anggota  : isHighCommand + pangkat (diatur High Command di Panel Rekap)
//  - Warga Discord : role di server Discord (opsional, lewat env var di bawah)
//      DISCORD_GUILD_ID       ID server Discord
//      DISCORD_ROLE_HC        ID role High Command (boleh banyak, pisah koma)
//      DISCORD_ROLE_ANGGOTA   ID role Anggota PD   (boleh banyak, pisah koma)
//      DISCORD_ROLE_LAIN      label tambahan: idRole=Label,idRole=Label
const ids = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
function roleConfig() {
  const lain = String(process.env.DISCORD_ROLE_LAIN || "").split(",").map((x) => x.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return i > 0 ? { id: p.slice(0, i).trim(), label: p.slice(i + 1).trim().slice(0, 24) } : null;
  }).filter((x) => x && x.id && x.label);
  return { guildId: (process.env.DISCORD_GUILD_ID || "").trim(), hc: ids(process.env.DISCORD_ROLE_HC), anggota: ids(process.env.DISCORD_ROLE_ANGGOTA), lain };
}
function discordScope() { return roleConfig().guildId ? "identify guilds.members.read" : "identify"; }

function labelDariRole(roleIds) {
  const c = roleConfig(), r = new Set(Array.isArray(roleIds) ? roleIds : []), out = [];
  if (c.hc.some((x) => r.has(x))) out.push({ teks: "High Command", tone: "hc", dc: true });
  if (c.anggota.some((x) => r.has(x))) out.push({ teks: "Anggota PD", tone: "anggota", dc: true });
  c.lain.forEach((x) => { if (r.has(x.id)) out.push({ teks: x.label, tone: "custom", dc: true }); });
  return out;
}
function labelWarga(w) {
  const dari = labelDariRole(w.roleIds);
  const resmi = dari.some((l) => l.tone === "hc" || l.tone === "anggota");
  return resmi ? dari : [{ teks: "Warga", tone: "warga" }, ...dari];
}
function labelAnggota(u) {
  const l = [{ teks: u.isHighCommand ? "High Command" : "Anggota PD", tone: u.isHighCommand ? "hc" : "anggota" }];
  if (u.pangkat) l.push({ teks: u.pangkat, tone: "pangkat" });
  return l;
}

function sanitizeWarga(w) {
  if (!w) return null;
  return {
    id: w.id,
    username: w.username,
    nama: namaTampil(w),
    namaDiscord: namaDiscord(w),
    namaKustom: w.namaKustom || "",
    sinkron: w.sinkron !== false,
    bio: w.bio || "",
    avatar: avatarUrl(w.discordId, w.avatar),
    banner: bannerUrl(w.discordId, w.banner),
    accent: typeof w.accent === "number" ? "#" + w.accent.toString(16).padStart(6, "0") : null,
    labels: labelWarga(w),
    roleAktif: !!roleConfig().guildId,
    terakhirSinkron: w.terakhirSinkron || null,
    pertamaLogin: w.pertamaLogin,
    terakhirLogin: w.terakhirLogin,
  };
}

module.exports = {
  WARGA_COOKIE, STATE_COOKIE, getWargaFromReq, setWargaCookie, newState,
  stateCookie, clearStateCookie, clearWargaCookie, sanitizeWarga,
  roleConfig, discordScope, labelAnggota, labelWarga, cekNamaAman, namaTampil,
};
