// ====== Rank Duty Berjenjang (SERVER-SIDE ONLY) ======
// Aturan (per keputusan High Command):
//  - Rank dihitung per MINGGU (Senin–Minggu, WIB) dari jam duty yang statusnya
//    SUDAH "diterima" High Command. Laporan pending/ditolak tidak dihitung.
//  - Rank 1 butuh 30 jam dalam satu minggu. Tiap naik 1 rank, target minggu
//    berikutnya NAIK 10 jam:
//        Rank 1 → 30 jam | Rank 2 → 40 jam | Rank 3 → 50 jam | dst.
//  - Berturut-turut: rank naik bertingkat dari minggu ke minggu dalam bulan
//    yang sama. Kalau satu minggu targetnya nggak kekejar, minggu itu cuma
//    dianggap GAGAL/skip — rank yang sudah didapat TIDAK hilang, dan target
//    minggu berikutnya tetap di angka yang sama (nggak naik, nggak turun).
//  - Jam sisa TIDAK ditabung ke minggu berikutnya. Tiap minggu mulai dari 0.
//  - RESET OTOMATIS TIAP BULAN: begitu ganti bulan (kalender WIB), rank balik
//    ke 0 dan target balik ke 30 jam. Reset ini nggak butuh tombol / cron —
//    semuanya dihitung ulang on-the-fly dari tanggal absensi, jadi begitu
//    tanggal 1 lewat, hasilnya otomatis bersih.

const { jakartaNow, jakartaTodayISO } = require("./waktu");

// Target jam untuk rank pertama, dan tambahan jam tiap naik 1 rank.
// Edit dua angka ini aja kalau SOP-nya berubah.
const JAM_RANK_PERTAMA = 30;
const TAMBAHAN_JAM_PER_RANK = 10;

// Berapa jam yang dibutuhkan buat naik ke rank ke-(rankSekarang + 1).
function targetJamUntukRankBerikut(rankSekarang) {
  return JAM_RANK_PERTAMA + rankSekarang * TAMBAHAN_JAM_PER_RANK;
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Senin (WIB) dari minggu yang memuat tanggal `iso`.
function seninDariTanggal(iso) {
  const d = new Date(iso + "T00:00:00.000Z");
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Minggu = 7
  return addDaysISO(iso, -(day - 1));
}

// Batas bulan berjalan menurut kalender WIB: "YYYY-MM-01" s/d hari terakhir.
function periodeBulanIni(hariIni = jakartaTodayISO()) {
  const awal = hariIni.slice(0, 8) + "01";
  const d = new Date(awal + "T00:00:00.000Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0); // mundur 1 hari = hari terakhir bulan ini
  return { awal, akhir: d.toISOString().slice(0, 10), bulan: hariIni.slice(0, 7) };
}

const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
function labelBulan(bulanIso) {
  const [th, bl] = bulanIso.split("-");
  return `${NAMA_BULAN[Number(bl) - 1]} ${th}`;
}

// Pecah bulan berjalan jadi jendela mingguan Senin–Minggu, DIPOTONG di batas
// bulan. Jadi minggu pertama & terakhir bisa lebih pendek dari 7 hari kalau
// tanggal 1 / tanggal terakhir jatuh di tengah minggu.
function jendelaMingguan(awalBulan, akhirBulan) {
  const out = [];
  let cursor = awalBulan;
  while (cursor <= akhirBulan) {
    const senin = seninDariTanggal(cursor);
    const minggu = addDaysISO(senin, 6);
    out.push({
      senin,
      mulai: cursor,
      selesai: minggu > akhirBulan ? akhirBulan : minggu,
    });
    cursor = addDaysISO(minggu, 1);
  }
  return out;
}

// Total jam duty "hadir" berstatus "diterima" dalam rentang tanggal tertutup.
function jamDutyDiterima(absensiUser, mulai, selesai) {
  let totalMenit = 0;
  (absensiUser || []).forEach((a) => {
    if (a.tipe !== "hadir" || a.status !== "diterima") return;
    if (!a.tanggal || a.tanggal < mulai || a.tanggal > selesai) return;
    if (!a.waktuMulai || !a.waktuSelesai) return;
    const [h1, m1] = a.waktuMulai.split(":").map(Number);
    const [h2, m2] = a.waktuSelesai.split(":").map(Number);
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins < 0) mins += 24 * 60; // duty lewat tengah malam
    totalMenit += mins;
  });
  return totalMenit / 60;
}

const bulat1 = (n) => Math.round(n * 10) / 10;

// Hitung rank seorang anggota untuk BULAN BERJALAN.
// Balikannya dipakai langsung sama card di dashboard.
function hitungRankDuty(absensiUser, hariIni = jakartaTodayISO()) {
  const { awal, akhir, bulan } = periodeBulanIni(hariIni);
  const jendela = jendelaMingguan(awal, akhir);

  let rank = 0;
  const riwayat = [];
  let mingguBerjalan = null;

  jendela.forEach((w, i) => {
    const jam = jamDutyDiterima(absensiUser, w.mulai, w.selesai);
    const target = targetJamUntukRankBerikut(rank);
    const tercapai = jam >= target;
    const belumMulai = w.mulai > hariIni;
    const sedangBerjalan = !belumMulai && w.selesai >= hariIni;

    // Rank naik SEGERA begitu target minggu itu kesentuh (nggak nunggu minggu
    // selesai). Kalau sampai minggunya habis targetnya nggak kekejar, minggu
    // itu cuma di-skip — rank yang udah didapat tetap aman.
    if (tercapai) rank += 1;

    const info = {
      ke: i + 1,
      mulai: w.mulai,
      selesai: w.selesai,
      jam: bulat1(jam),
      target,
      status: belumMulai ? "belum-mulai" : tercapai ? "tercapai" : sedangBerjalan ? "berjalan" : "gagal",
    };
    riwayat.push(info);
    if (sedangBerjalan) mingguBerjalan = info;
  });

  const targetBerikut = targetJamUntukRankBerikut(rank);
  const jamMingguIni = mingguBerjalan ? mingguBerjalan.jam : 0;

  return {
    bulan,
    labelBulan: labelBulan(bulan),
    periodeAwal: awal,
    periodeAkhir: akhir,
    rank,
    // Target minggu ini: kalau rank minggu ini udah naik, yang ditampilkan
    // adalah target untuk rank berikutnya.
    targetJam: targetBerikut,
    jamMingguIni,
    sisaJam: bulat1(Math.max(0, targetBerikut - jamMingguIni)),
    mingguIniTercapai: mingguBerjalan ? mingguBerjalan.status === "tercapai" : false,
    mingguIni: mingguBerjalan,
    riwayat,
    jamRankPertama: JAM_RANK_PERTAMA,
    tambahanPerRank: TAMBAHAN_JAM_PER_RANK,
  };
}

module.exports = {
  JAM_RANK_PERTAMA,
  TAMBAHAN_JAM_PER_RANK,
  targetJamUntukRankBerikut,
  periodeBulanIni,
  jendelaMingguan,
  hitungRankDuty,
};
