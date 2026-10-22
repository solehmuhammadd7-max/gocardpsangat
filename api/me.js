const crypto = require("crypto");
const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");
const { PANGKAT_LIST } = require("../lib/pangkat");
const {
  TABEL_GAJI, getGajiPangkat, sudahKlaimMingguIni, bisaKlaimHariIni,
  MIN_HADIR_UNTUK_KLAIM_GAJI, hitungHadirMingguIni, klaimGaji,
} = require("../lib/gaji");
const {
  ARREST_TARGET_MINGGUAN, JAM_TARGET_MINGGUAN, getNextPangkat,
  getMondayISO, hitungProgresMingguIni, cekEligible,
} = require("../lib/promosi");
const { hitungRankDuty, JAM_RANK_PERTAMA, TAMBAHAN_JAM_PER_RANK } = require("../lib/rankduty");
const { notifyKlaimGaji, notifyPengajuanPromosi } = require("../lib/discord");
const { jakartaTodayISO } = require("../lib/waktu");

// Batas ukuran avatar (data URL base64). Avatar dikompres dulu di browser
// (compressAvatarFile di app.js) sebelum dikirim, jadi normalnya jauh di
// bawah ini — batas ini cuma jaga-jaga biar Redis nggak kebanjiran data.
const MAX_AVATAR_CHARS = 500 * 1024;

// Tanggal efektif mulai hitung buat 1 anggota: yang lebih baru antara
// mulainya periode global (periodeMulai) sama tanggal dia gabung.
function effectiveMulai(periodeMulai, bergabung) {
  if (bergabung && bergabung > periodeMulai) return bergabung;
  return periodeMulai;
}

// Total jam duty (laporan "hadir" berstatus "diterima") + jumlah hari hadir
// sejak `mulaiIso` sampai hari ini — dipakai buat Leaderboard dashboard.
function calcTotalJamHadir(records, mulaiIso) {
  const todayStr = jakartaTodayISO(); // WIB, bukan UTC server — biar konsisten sama kalender anggota
  const mulai = mulaiIso || todayStr;
  let totalMinutes = 0;
  const hadirDays = new Set();
  records.forEach((a) => {
    if (a.status !== "diterima" || a.tipe !== "hadir") return;
    if (a.tanggal < mulai || a.tanggal > todayStr) return;
    hadirDays.add(a.tanggal);
    if (a.waktuMulai && a.waktuSelesai) {
      const [h1, m1] = a.waktuMulai.split(":").map(Number);
      const [h2, m2] = a.waktuSelesai.split(":").map(Number);
      let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 24 * 60;
      totalMinutes += mins;
    }
  });
  return { totalJam: totalMinutes / 60, hadir: hadirDays.size };
}

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });

  // ====== Aksi: lihat struktur anggota (semua akun approved) ======
  // Numpang di GET /api/me?view=struktur — bukan endpoint baru — biar
  // jumlah serverless function tidak nambah (limit 12 di plan Hobby Vercel).
  if (req.method === "GET" && req.query && req.query.view === "struktur") {
    const users = await kvStore.getUsers();
    const members = users
      .filter((u) => (u.status || "approved") === "approved")
      .map((u) => {
        const s = sanitizeUser(u);
        return {
          id: s.id,
          username: s.username,
          namaKarakter: s.namaKarakter || "",
          pangkat: s.pangkat,
          isHighCommand: !!s.isHighCommand,
          avatar: s.avatar || null,
        };
      })
      .sort((a, b) => {
        const ia = PANGKAT_LIST.indexOf(a.pangkat);
        const ib = PANGKAT_LIST.indexOf(b.pangkat);
        const ra = ia === -1 ? PANGKAT_LIST.length : ia;
        const rb = ib === -1 ? PANGKAT_LIST.length : ib;
        if (ra !== rb) return ra - rb;
        return a.username.localeCompare(b.username);
      });
    return res.json({ members });
  }

  // ====== Aksi: papan iklan (buat dashboard) ======
  // Numpang di GET /api/me?view=iklan — dibaca semua anggota yang login,
  // sedangkan kelola (tambah/hapus) iklannya sendiri khusus High Command
  // lewat /api/admin/rekap (lihat tab "Iklan" di Panel Rekap).
  if (req.method === "GET" && req.query && req.query.view === "iklan") {
    const iklan = await kvStore.getIklan();
    return res.json({ iklan });
  }

  // ====== Aksi: leaderboard jam duty (buat dashboard) ======
  // Numpang di GET /api/me?view=leaderboard — dipakai dashboard.html biar
  // langsung kelihatan tiap kali dibuka/di-refresh. Top 5 berdasarkan total
  // jam duty terverifikasi di periode berjalan (reset ikut "Reset Semua Duty").
  if (req.method === "GET" && req.query && req.query.view === "leaderboard") {
    const users = await kvStore.getUsers();
    const absensi = await kvStore.getAbsensi();
    const periodeMulai = await kvStore.getPeriodeMulai();
    const board = users
      .filter((u) => (u.status || "approved") === "approved")
      .map((u) => {
        const records = absensi.filter((a) => a.userId === u.id);
        const mulai = effectiveMulai(periodeMulai, u.bergabung);
        const { totalJam, hadir } = calcTotalJamHadir(records, mulai);
        const rd = hitungRankDuty(records);
        return {
          id: u.id,
          username: u.username,
          namaKarakter: u.namaKarakter || "",
          pangkat: u.pangkat,
          avatar: u.avatar || null,
          totalJam: Math.round(totalJam * 10) / 10,
          hadir,
          // Rank duty bulan berjalan: rank 1 = 30 jam dalam satu minggu,
          // tiap naik rank targetnya +10 jam. Reset otomatis tiap ganti bulan.
          rank: rd.rank,
          rankTargetBerikut: rd.targetJam,
          jamMingguIni: rd.jamMingguIni,
        };
      })
      .filter((r) => r.totalJam > 0)
      .sort((a, b) => b.rank - a.rank || b.totalJam - a.totalJam || b.hadir - a.hadir)
      .slice(0, 5);
    return res.json({
      leaderboard: board,
      periodeMulai,
      rankInfo: { jamRankPertama: JAM_RANK_PERTAMA, tambahanPerRank: TAMBAHAN_JAM_PER_RANK },
    });
  }

  if (req.method === "POST") {
    const { klaimGaji: mauKlaim, updateProfile, namaKarakter, avatar, bio, ajukanPromosi } = req.body || {};

    // ====== Aksi: ajukan Kenaikan Pangkat ======
    // Cuma bisa diajukan kalau target minggu ini (5x arrest + 30 jam duty
    // yang SUDAH diterima HC) sudah terpenuhi. Pengajuan ini masuk status
    // "pending" — pangkat BELUM naik sampai di-ACC High Command lewat Panel
    // Rekap -> tab "Kenaikan Pangkat".
    if (ajukanPromosi) {
      const users = await kvStore.getUsers();
      const target = users.find((u) => u.id === user.id);
      if (!target) return res.status(404).json({ error: "Akun tidak ditemukan." });

      const pangkatTarget = getNextPangkat(target.pangkat);
      if (!pangkatTarget) return res.status(400).json({ error: "Kamu sudah berada di pangkat tertinggi." });

      const absensiUser = (await kvStore.getAbsensi()).filter((a) => a.userId === target.id);
      const arrestsUser = (await kvStore.getArrests()).filter((a) => a.dibuatOlehUserId === target.id);
      const progres = hitungProgresMingguIni(absensiUser, arrestsUser);

      if (!cekEligible(progres)) {
        return res.status(400).json({
          error: `Belum memenuhi target minggu ini: ${progres.jumlahArrest}/${ARREST_TARGET_MINGGUAN} arrest record, ${progres.jamDuty.toFixed(1)}/${JAM_TARGET_MINGGUAN} jam duty (yang sudah diterima HC).`,
        });
      }

      const promosiAll = await kvStore.getPromosi();
      const mingguIni = getMondayISO();
      const sudahAda = promosiAll.some((p) => p.userId === target.id && p.minggu === mingguIni && p.status !== "ditolak");
      if (sudahAda) return res.status(409).json({ error: "Kamu sudah punya pengajuan kenaikan pangkat untuk minggu ini." });

      const request = {
        id: crypto.randomBytes(8).toString("hex"),
        userId: target.id,
        pangkatSaat: target.pangkat,
        pangkatTarget,
        arrestCount: progres.jumlahArrest,
        jamDuty: Math.round(progres.jamDuty * 10) / 10,
        minggu: mingguIni,
        status: "pending",
        alasan: null,
        diprosesOleh: null,
        tanggal: new Date().toISOString(),
      };
      promosiAll.push(request);
      await kvStore.setPromosi(promosiAll);
      await notifyPengajuanPromosi(target, request);

      return res.json({ ok: true, request });
    }

    // ====== Aksi: update profil sendiri (nama karakter, bio & foto profil) ======
    if (updateProfile) {
      const users = await kvStore.getUsers();
      const target = users.find((u) => u.id === user.id);
      if (!target) return res.status(404).json({ error: "Akun tidak ditemukan." });

      if (namaKarakter !== undefined) {
        target.namaKarakter = String(namaKarakter).trim().slice(0, 100);
      }
      if (bio !== undefined) {
        target.bio = String(bio).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 300);
      }
      if (avatar !== undefined) {
        if (avatar === null) {
          target.avatar = null; // hapus foto profil, balik ke inisial
        } else {
          if (typeof avatar !== "string" || !avatar.startsWith("data:image/")) {
            return res.status(400).json({ error: "Format foto profil tidak valid." });
          }
          if (avatar.length > MAX_AVATAR_CHARS) {
            return res.status(400).json({ error: "Foto profil terlalu besar." });
          }
          target.avatar = avatar;
        }
      }

      await kvStore.setUsers(users);
      return res.json({ ok: true, user: sanitizeUser(target) });
    }

    // ====== Aksi: klaim gaji mingguan (flat sesuai pangkat) ======
    if (mauKlaim) {
      const users = await kvStore.getUsers();
      const target = users.find((u) => u.id === user.id);
      if (!target) return res.status(404).json({ error: "User tidak ditemukan." });

      const absensiAll = await kvStore.getAbsensi();
      const absensiUser = absensiAll.filter((a) => a.userId === user.id);

      const jumlah = klaimGaji(target, absensiUser);
      if (jumlah === "diluar-jadwal") {
        return res.status(400).json({
          error: "Pengambilan gaji cuma bisa hari Senin–Rabu. Kalau kelewat, jatah minggu ini hangus — coba lagi Senin depan.",
        });
      }
      if (jumlah === "kurang-hadir") {
        const sudah = hitungHadirMingguIni(absensiUser);
        return res.status(400).json({
          error: `Minimal hadir ${MIN_HADIR_UNTUK_KLAIM_GAJI} hari minggu ini buat bisa klaim gaji (baru ${sudah}/${MIN_HADIR_UNTUK_KLAIM_GAJI} hari).`,
        });
      }
      if (jumlah === null) {
        return res.status(400).json({ error: "Gaji minggu ini sudah kamu klaim. Coba lagi minggu depan." });
      }

      await kvStore.setUsers(users);
      await notifyKlaimGaji(target, jumlah);

      return res.json({ ok: true, jumlah });
    }

    return res.status(400).json({ error: "Aksi tidak dikenal." });
  }

  // ====== GET profil + info gaji + progress kenaikan pangkat ======
  const absensiAllUser = (await kvStore.getAbsensi()).filter((a) => a.userId === user.id);
  const sanitized = sanitizeUser(user);
  sanitized.gaji = {
    tabel: TABEL_GAJI,
    gajiSaya: getGajiPangkat(user.pangkat),
    sudahKlaimMingguIni: sudahKlaimMingguIni(user),
    bisaKlaimHariIni: bisaKlaimHariIni(),
    minHadir: MIN_HADIR_UNTUK_KLAIM_GAJI,
    hadirMingguIni: hitungHadirMingguIni(absensiAllUser),
    riwayat: user.riwayatGaji || [],
  };

  const arrestsAllUser = (await kvStore.getArrests()).filter((a) => a.dibuatOlehUserId === user.id);
  const progresPromosi = hitungProgresMingguIni(absensiAllUser, arrestsAllUser);
  const promosiAll = await kvStore.getPromosi();
  const mingguIni = getMondayISO();
  const pengajuanMingguIni = promosiAll
    .filter((p) => p.userId === user.id && p.minggu === mingguIni)
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal))[0] || null;

  sanitized.promosi = {
    targetArrest: ARREST_TARGET_MINGGUAN,
    targetJam: JAM_TARGET_MINGGUAN,
    arrestMingguIni: progresPromosi.jumlahArrest,
    jamMingguIni: Math.round(progresPromosi.jamDuty * 10) / 10,
    pangkatTarget: getNextPangkat(user.pangkat),
    eligible: cekEligible(progresPromosi),
    pengajuanMingguIni,
  };

  res.json({ user: sanitized });
};
