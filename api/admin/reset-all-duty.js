const kvStore = require("../../lib/kv");
const { getUserFromReq } = require("../../lib/auth");
const { jakartaTodayISO } = require("../../lib/waktu");

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const absensi = await kvStore.getAbsensi();
  const resetCount = absensi.length;
  await kvStore.setAbsensi([]);
  // Catatan: ini SENGAJA cuma hapus "nexotis:absensi" (buat reset periode
  // gaji mingguan), TIDAK menyentuh data user sama sekali.

  // Tandai mulainya periode akumulasi baru (jam kerja/hadir/izin/cuti/alpa).
  // Ini SATU-SATUNYA tempat yang menggeser "periodeMulai" — jadi angka di
  // dashboard & Panel Rekap TIDAK bakal auto-reset sendiri tiap ganti minggu
  // kalender, cuma berubah kalau High Command klik tombol ini.
  const periodeBaru = jakartaTodayISO();
  await kvStore.setPeriodeMulai(periodeBaru);

  res.json({ ok: true, resetCount, periodeMulai: periodeBaru });
};
