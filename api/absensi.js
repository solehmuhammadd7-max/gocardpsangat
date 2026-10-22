const crypto = require("crypto");
const kvStore = require("../lib/kv");
const { getUserFromReq } = require("../lib/auth");
const { notifyLaporanMasuk } = require("../lib/discord");
const { uploadFotoKeCloudinary } = require("../lib/cloudinary");
const { jakartaTodayISO } = require("../lib/waktu");

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });

  const absensiAll = await kvStore.getAbsensi();

  if (req.method === "GET") {
    const periodeMulai = await kvStore.getPeriodeMulai();
    return res.json({ absensi: absensiAll.filter((a) => a.userId === user.id), periodeMulai });
  }

  if (req.method === "POST") {
    const { tipe, tanggal, waktuMulai, waktuSelesai, cutiMulai, cutiSelesai, foto, keterangan } = req.body || {};
    const fotoList = Array.isArray(foto) ? foto.filter(Boolean) : [];
    if (!["hadir", "izin", "cuti"].includes(tipe)) return res.status(400).json({ error: "Tipe tidak valid." });
    if (tipe === "hadir" && (fotoList.length < 1 || fotoList.length > 3)) return res.status(400).json({ error: "Wajib 1–3 foto bukti untuk laporan hadir." });

    // Anti-curang: cegah laporan HADIR ganda di tanggal yang sama. Kalau
    // laporan sebelumnya di tanggal itu sudah "ditolak", boleh submit ulang
    // (dianggap laporan baru pengganti) — yang diblokir cuma kalau masih ada
    // laporan "pending" atau "diterima" di tanggal tersebut.
    if (tipe === "hadir") {
      const tanggalCek = tanggal || jakartaTodayISO();
      const sudahAda = absensiAll.some(
        (a) => a.userId === user.id && a.tipe === "hadir" && a.tanggal === tanggalCek && a.status !== "ditolak"
      );
      if (sudahAda) return res.status(409).json({ error: "Kamu sudah punya laporan hadir untuk tanggal ini (masih pending/diterima)." });
    }

    // Batas aman per foto (base64) supaya nggak numpuk jadi request raksasa yang
    // ditolak platform dengan 413 Payload Too Large sebelum sempat sampai ke sini.
    const MAX_FOTO_BYTES = 1.5 * 1024 * 1024; // ~1.5MB per foto setelah decode base64
    const tooBig = fotoList.some((src) => typeof src === "string" && src.length * 0.75 > MAX_FOTO_BYTES);
    if (tooBig) return res.status(413).json({ error: "Salah satu foto masih terlalu besar. Coba upload ulang foto tersebut." });
    if (tipe === "cuti" && (!cutiMulai || !cutiSelesai)) return res.status(400).json({ error: "Periode cuti wajib diisi." });

    // SEMUA laporan (hadir/izin/cuti) WAJIB di-ACC dulu sama High Command
    // sebelum berstatus "diterima" — nggak ada lagi auto-diterima, soalnya
    // jam duty yang "diterima" ini yang jadi patokan Target Kenaikan Pangkat
    // (lihat lib/promosi.js), jadi harus lewat verifikasi manual dulu.
    const statusAwal = "pending";
    const absensiId = crypto.randomBytes(8).toString("hex");

    // Upload tiap foto ke Vercel Blob dulu, baru simpan URL-nya (bukan base64-nya)
    // ke record. Kalau salah satu upload gagal, kita hentikan sebelum sempat nulis
    // apa pun ke Redis, supaya nggak ada foto "setengah kesimpan".
    let fotoUrls = [];
    try {
      fotoUrls = await Promise.all(
        fotoList.map((dataUrl, i) => uploadFotoKeCloudinary(dataUrl, `absensi/${absensiId}-${i}`))
      );
    } catch (e) {
      return res.status(500).json({ error: "Gagal mengunggah foto: " + e.message });
    }

    const record = {
      id: absensiId,
      userId: user.id,
      tanggal: tanggal || jakartaTodayISO(),
      tipe,
      waktuMulai: tipe === "hadir" ? waktuMulai : null,
      waktuSelesai: tipe === "hadir" ? waktuSelesai : null,
      cutiMulai: tipe === "cuti" ? cutiMulai : null,
      cutiSelesai: tipe === "cuti" ? cutiSelesai : null,
      foto: fotoUrls,
      keterangan: keterangan || "",
      status: statusAwal,
      alasan: null,
      createdAt: new Date().toISOString(),
    };
    absensiAll.push(record);
    await kvStore.setAbsensi(absensiAll);

    await notifyLaporanMasuk(user, record);
    return res.json({ ok: true, record });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
