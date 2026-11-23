const kvStore = require("../lib/kv");
const { getUserFromReq } = require("../lib/auth");

// GET  : siapa saja (anggota/warga) boleh baca setelan musik supaya bisa ikut mendengarkan.
// POST : khusus High Command — ubah URL, volume, nyala/mati untuk semua user.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const m = await kvStore.getMusik();
    return res.json({ on: !!m.on, url: m.url || "", volume: m.volume, updatedAt: m.updatedAt || 0 });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  const body = req.body || {};
  const lama = await kvStore.getMusik();
  let url = typeof body.url === "string" ? body.url.trim() : lama.url;
  if (url && (!/^https?:\/\//i.test(url) || url.length > 500)) return res.status(400).json({ error: "URL harus diawali http:// atau https://" });
  let volume = Number.isFinite(+body.volume) ? Math.max(0, Math.min(100, Math.round(+body.volume))) : lama.volume;
  const on = body.on === undefined ? !!lama.on : !!body.on;
  if (on && !url) return res.status(400).json({ error: "Isi URL lagu dulu." });

  const baru = { on, url, volume, updatedAt: Date.now(), by: user.username || user.namaKarakter || "HC" };
  await kvStore.setMusik(baru);
  res.json({ ok: true, ...baru });
};
