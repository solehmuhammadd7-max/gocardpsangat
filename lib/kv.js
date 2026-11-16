// Penyimpanan pakai Upstash Redis — Vercel KV sudah resmi di-deprecated per
// awal 2026, jadi ini pengganti yang direkomendasikan Vercel sendiri.
// Daftar gratis di https://upstash.com, buat database Redis, lalu isi
// UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN di Environment Variables.

const { Redis } = require("@upstash/redis");
const { jakartaNow } = require("./waktu");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function getUsers() { return (await redis.get("nexotis:users")) || []; }
async function setUsers(users) { await redis.set("nexotis:users", users); }
async function getAbsensi() { return (await redis.get("nexotis:absensi")) || []; }
async function setAbsensi(absensi) { await redis.set("nexotis:absensi", absensi); }
async function getArrests() { return (await redis.get("nexotis:arrests")) || []; }
async function setArrests(arrests) { await redis.set("nexotis:arrests", arrests); }

// ====== Warga (akun publik hasil login Discord, BUKAN anggota kepolisian) ======
// Disimpan terpisah dari nexotis:users supaya warga nggak pernah bisa nyentuh
// data/API anggota. Isi: { id, discordId, username, globalName, avatar, pertamaLogin, terakhirLogin }
async function getWarga() { return (await redis.get("nexotis:warga")) || []; }
async function setWarga(warga) { await redis.set("nexotis:warga", warga); }

// ====== Pengajuan Kenaikan Pangkat (target mingguan: 5x arrest + 30 jam duty) ======
async function getPromosi() { return (await redis.get("nexotis:promosi")) || []; }
async function setPromosi(promosi) { await redis.set("nexotis:promosi", promosi); }

// ====== Iklan (papan iklan foto + teks, dikelola High Command) ======
async function getIklan() { return (await redis.get("nexotis:iklan")) || []; }
async function setIklan(iklan) { await redis.set("nexotis:iklan", iklan); }

// ====== Periode rekap (jam kerja/hadir/izin/cuti/alpa) ======
// Tanggal mulai periode akumulasi. SENGAJA cuma berubah kalau High Command
// klik "Reset Semua Duty" (lihat api/admin/reset-all-duty.js) — jadi jam
// kerja dkk numpuk terus dan TIDAK auto-reset tiap ganti minggu kalender.
// Kalau belum pernah di-set (instalasi baru), diinisialisasi ke hari Senin
// minggu ini sekali, lalu disimpan supaya konsisten di request-request berikutnya.
function getMondayISOLocal(d = jakartaNow()) {
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}
async function getPeriodeMulai() {
  let mulai = await redis.get("nexotis:periodeMulai");
  if (!mulai) {
    mulai = getMondayISOLocal();
    await redis.set("nexotis:periodeMulai", mulai);
  }
  return mulai;
}
async function setPeriodeMulai(iso) { await redis.set("nexotis:periodeMulai", iso); }

module.exports = {
  getUsers, setUsers, getAbsensi, setAbsensi, getArrests, setArrests,
  getPeriodeMulai, setPeriodeMulai, getIklan, setIklan,
  getPromosi, setPromosi, getWarga, setWarga,
};
