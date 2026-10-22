const { clearSessionCookie } = require("../lib/auth");
const warga = require("../lib/warga");

module.exports = (req, res) => {
  clearSessionCookie(res); // set header Set-Cookie anggota
  const anggota = res.getHeader("Set-Cookie");
  // hapus juga sesi warga (kalau ada) — dua cookie dikirim sekaligus
  res.setHeader("Set-Cookie", [].concat(anggota || [], warga.clearWargaCookie(req)));
  res.json({ ok: true });
};
