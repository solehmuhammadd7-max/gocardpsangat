// ====== Sistem Gaji Mingguan (FLAT per pangkat, SERVER-SIDE) ======
// Nominal per pangkat per minggu. BUKAN dihitung dari jam duty — flat sesuai
// pangkat. Nominal boleh diubah kapan pun, tinggal edit angka di bawah,
// nggak perlu redeploy struktur apa pun.
//
// CATATAN PENAMAAN: key di bawah harus PERSIS sama kayak PANGKAT_LIST
// (app.js / lib/pangkat.js) — termasuk yang kepenulisannya "Broad of police
// Commissioners" (bukan "Board...") dan "Deputy Chief" (bukan "...Of
// Police") — soalnya itu yang beneran kesimpen di data pangkat tiap
// anggota. Kalau suatu saat ejaan pangkat itu dibetulin di PANGKAT_LIST,
// key di sini WAJIB ikut diubah bareng, kalau nggak gajinya kebaca 0.
const TABEL_GAJI = {
  "Broad of police Commissioners": 6000000,
  "Chief of Police": 5000000,
  "Assistant Chief": 4000000,
  "Deputy Chief": 3100000,
  "Commander": 2200000,
  "Captain II": 1000000,
  "Captain I": 950000,
  "Lieutenant II": 900000,
  "Lieutenant I": 850000,
  "Detective Supervisor": 760000,
  "Sergeant II": 730000,
  "Sergeant I": 700000,
  "Prob. Sergeant": 680000,
  "Detective III": 650000,
  "Detective II": 630000,
  "Detective I": 600000,
  "PO III+1": 580000,
  "PO III": 550000,
  "PO II": 530000,
  "PO I": 500000,
  "Prob. Police Officer": 300000, // nggak ada di list terbaru — tetap dipakai nominal lama
};

const { jakartaNow } = require("./waktu");

// Minimal jumlah HARI hadir (status "diterima") dalam minggu berjalan
// sebelum boleh klaim gaji mingguan. Ganti angka ini aja kalau mau ubah
// syaratnya (misal dari 2 ke 3 hari).
const MIN_HADIR_UNTUK_KLAIM_GAJI = 2;

function getGajiPangkat(pangkat) {
  return TABEL_GAJI[pangkat] || 0;
}

function getMondayISO(d = jakartaNow()) {
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

function sudahKlaimMingguIni(user) {
  return user.gajiKlaimMinggu === getMondayISO();
}

// Jendela pengambilan gaji: HANYA Senin(1)–Rabu(3) MENURUT WIB. Kalau lewat
// Rabu tanpa diklaim, jatah minggu itu hangus — nggak bisa diambil susulan
// di Kamis-Minggu, dan minggu berikutnya mulai dari nol lagi.
function bisaKlaimHariIni(d = jakartaNow()) {
  const day = d.getUTCDay(); // 0=Minggu, 1=Senin, ... 6=Sabtu (WIB)
  return day >= 1 && day <= 3;
}

function tambahHari(isoDate, delta) {
  const d = new Date(isoDate + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Hitung berapa HARI (bukan jam) anggota itu udah lapor hadir & DITERIMA
// selama MINGGU KEMARIN (Senin s/d Minggu minggu lalu) — BUKAN minggu
// berjalan. Klaim gaji cuma dibuka Senin-Rabu minggu berjalan buat bayar
// hasil kerja minggu KEMARIN yang udah rampung & sudah di-reset tiap hari
// Minggu, jadi yang dihitung ya total absensi minggu lalu itu, persis
// sebelum reset di hari Minggu-nya. Dipakai buat syarat minimal hadir
// sebelum boleh klaim gaji SELF-SERVICE — TIDAK berlaku buat "Kirim Gaji"
// manual dari Panel Rekap (itu sengaja bebas, tanpa batas, karena High
// Command yang input sendiri).
function hitungHadirMingguIni(absensiUser) {
  const seninMingguIni = getMondayISO();
  const seninMingguLalu = tambahHari(seninMingguIni, -7);
  const mingguMingguLalu = tambahHari(seninMingguIni, -1); // Minggu sebelum Senin minggu ini
  const hari = new Set();
  (absensiUser || []).forEach((a) => {
    if (a.tipe === "hadir" && a.status === "diterima" && a.tanggal >= seninMingguLalu && a.tanggal <= mingguMingguLalu) {
      hari.add(a.tanggal);
    }
  });
  return hari.size;
}

// Mutasi objek user langsung — caller wajib kvStore.setUsers(users) setelahnya.
// `absensiUser` = daftar record absensi milik user itu sendiri (buat cek
// syarat minimal hadir).
// Return:
//  - jumlah (number)   -> berhasil diklaim
//  - null              -> sudah klaim minggu ini
//  - "diluar-jadwal"   -> di luar jendela Senin–Rabu (gaji minggu ini sudah/akan hangus)
//  - "kurang-hadir"    -> belum memenuhi minimal hadir minggu ini
function klaimGaji(user, absensiUser = []) {
  if (!bisaKlaimHariIni()) return "diluar-jadwal";
  if (sudahKlaimMingguIni(user)) return null;
  if (hitungHadirMingguIni(absensiUser) < MIN_HADIR_UNTUK_KLAIM_GAJI) return "kurang-hadir";

  const jumlah = getGajiPangkat(user.pangkat);
  const minggu = getMondayISO();
  user.gajiKlaimMinggu = minggu;
  user.riwayatGaji = user.riwayatGaji || [];
  user.riwayatGaji.unshift({ minggu, jumlah, tanggal: new Date().toISOString() });
  user.riwayatGaji = user.riwayatGaji.slice(0, 12); // simpan 12 riwayat terakhir
  return jumlah;
}

module.exports = {
  TABEL_GAJI, getGajiPangkat, getMondayISO, sudahKlaimMingguIni, bisaKlaimHariIni,
  MIN_HADIR_UNTUK_KLAIM_GAJI, hitungHadirMingguIni, klaimGaji,
};
