// ====== Logika Target Kenaikan Pangkat (SERVER-SIDE ONLY) ======
// Sengaja dipisah dari app.js (yang dikirim mentah-mentah ke browser semua
// anggota) biar logikanya aman dari utak-atik client.
//
// ATURAN (per keputusan High Command):
//  - Buat naik 1 pangkat, dalam SATU MINGGU BERJALAN (Senin-Minggu, WIB)
//    anggota wajib:
//      • Bikin minimal 5 Arrest Record
//      • Akumulasi minimal 30 jam duty YANG SUDAH DITERIMA High Command
//        (laporan hadir yang masih "pending"/"ditolak" TIDAK dihitung)
//  - Kalau sudah memenuhi keduanya, anggota bisa "Ajukan Kenaikan Pangkat"
//    dari Dashboard. Pengajuan ini WAJIB di-ACC dulu sama High Command
//    (lewat Panel Rekap -> tab "Kenaikan Pangkat") sebelum pangkatnya
//    benar-benar naik — bukan naik otomatis.
//  - Maksimal 1 pengajuan aktif (pending/diterima) per anggota per minggu,
//    biar nggak spam ajuan di minggu yang sama.

const { jakartaNow, jakartaDateFromISO } = require("./waktu");

const PANGKAT_LIST = [
  "Broad of police Commissioners",
  "Chief of Police",
  "Assistant Chief",
  "Deputy Chief",
  "Commander",
  "Captain II",
  "Captain I",
  "Lieutenant II",
  "Lieutenant I",
  "Detective Supervisor",
  "Sergeant II",
  "Sergeant I",
  "Prob. Sergeant",
  "Detective III",
  "Detective II",
  "Detective I",
  "PO III+1",
  "PO III",
  "PO II",
  "PO I",
  "Prob. Police Officer",
];

// Target mingguan buat naik 1 pangkat — edit angka ini aja kalau syaratnya
// mau diubah sesuai SOP fraksi.
const ARREST_TARGET_MINGGUAN = 5;
const JAM_TARGET_MINGGUAN = 30;

// Senin (WIB) dari minggu yang sedang berjalan, format "YYYY-MM-DD".
// Dipakai konsisten sebagai "kunci minggu" buat progress & anti-spam ajuan.
function getMondayISO(d = jakartaNow()) {
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}
function getSundayISO(mondayIso) {
  const d = new Date(mondayIso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// Pangkat tujuan berikutnya (1 tingkat lebih tinggi). null kalau sudah di
// puncak (Broad of police Commissioners) atau pangkatnya nggak dikenali.
function getNextPangkat(pangkatSekarang) {
  const idx = PANGKAT_LIST.indexOf(pangkatSekarang);
  if (idx <= 0) return null;
  return PANGKAT_LIST[idx - 1];
}

// Hitung progress minggu berjalan (Senin-Minggu WIB):
//  - jumlah Arrest Record yang dibuat anggota itu
//  - total jam duty dari laporan "hadir" yang statusnya "diterima"
// `absensiUser` & `arrestsUser` = filter punya 1 user aja (dari caller).
function hitungProgresMingguIni(absensiUser, arrestsUser) {
  const senin = getMondayISO();
  const minggu = getSundayISO(senin);

  let totalMenit = 0;
  (absensiUser || []).forEach((a) => {
    if (a.tipe !== "hadir" || a.status !== "diterima") return;
    if (!a.tanggal || a.tanggal < senin || a.tanggal > minggu) return;
    if (!a.waktuMulai || !a.waktuSelesai) return;
    const [h1, m1] = a.waktuMulai.split(":").map(Number);
    const [h2, m2] = a.waktuSelesai.split(":").map(Number);
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60;
    totalMenit += mins;
  });

  const jumlahArrest = (arrestsUser || []).filter((a) => {
    if (!a.tanggal) return false;
    const tgl = jakartaDateFromISO(a.tanggal);
    return tgl >= senin && tgl <= minggu;
  }).length;

  return { jamDuty: totalMenit / 60, jumlahArrest, minggu: senin };
}

// Sudah memenuhi kedua syarat minggu ini atau belum.
function cekEligible(progres) {
  return progres.jamDuty >= JAM_TARGET_MINGGUAN && progres.jumlahArrest >= ARREST_TARGET_MINGGUAN;
}

module.exports = {
  PANGKAT_LIST,
  ARREST_TARGET_MINGGUAN,
  JAM_TARGET_MINGGUAN,
  getNextPangkat,
  getMondayISO,
  hitungProgresMingguIni,
  cekEligible,
};
