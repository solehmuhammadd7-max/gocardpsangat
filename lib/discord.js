// Kirim notifikasi ke Discord webhook tiap ada laporan absensi masuk.
// Optional: kalau DISCORD_WEBHOOK_URL nggak diisi di Environment Variables,
// fungsi ini cuma diam aja (nggak bikin error, nggak ganggu proses simpan
// laporan).

const { jakartaNow } = require("./waktu");

const TIPE_LABEL = { hadir: "Hadir", izin: "Izin", cuti: "Cuti" };
const TIPE_COLOR = { hadir: 0x22c55e, izin: 0xeab308, cuti: 0x3b82f6 };

function formatTanggalSingkat(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (e) {
    return iso;
  }
}

// URL Panel Rekap tab "Verifikasi Laporan" — dipakai jadi link langsung di
// notifikasi Discord biar High Command bisa approve/reject dari HP tanpa
// perlu buka & cari-cari tab-nya manual. Isi SITE_URL di Environment
// Variables (misal https://domain-kamu.vercel.app) kalau mau link ini aktif.
function laporanPanelUrl() {
  const base = process.env.SITE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/rekap.html?tab=laporan`;
}

// user: { username, pangkat }, record: hasil dari api/absensi.js (record baru)
async function notifyLaporanMasuk(user, record) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return; // fitur opsional — belum di-setup, skip diam-diam

  const fields = [
    { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
    { name: "Tipe", value: TIPE_LABEL[record.tipe] || record.tipe, inline: true },
    { name: "Tanggal", value: formatTanggalSingkat(record.tanggal), inline: true },
  ];

  if (record.tipe === "hadir") {
    fields.push({
      name: "Jam Duty",
      value: `${record.waktuMulai || "-"} - ${record.waktuSelesai || "-"}`,
      inline: true,
    });
  }
  if (record.tipe === "cuti") {
    fields.push({
      name: "Periode Cuti",
      value: `${formatTanggalSingkat(record.cutiMulai)} s/d ${formatTanggalSingkat(record.cutiSelesai)}`,
      inline: true,
    });
  }
  if (record.keterangan) {
    fields.push({ name: "Keterangan", value: String(record.keterangan).slice(0, 500), inline: false });
  }

  const linkPanel = laporanPanelUrl();
  const payload = {
    username: "Absensi Logs",
    embeds: [
      {
        title: "Laporan Absensi Baru",
        url: record.status === "pending" ? linkPanel || undefined : undefined,
        color: TIPE_COLOR[record.tipe] || 0x64748b,
        fields,
        footer: {
          text: linkPanel
            ? `Klik judul di atas buat approve/reject dari HP • ID: ${record.id}`
            : `Status: pending — buka Panel Rekap → Verifikasi Laporan • ID: ${record.id}`,
        },
        timestamp: record.createdAt,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    // Jangan sampai kegagalan kirim webhook bikin proses utama gagal —
    // cukup dicatat di log server (Vercel → tab Logs).
    console.error("[discord webhook] gagal kirim notifikasi:", err.message);
  }
}

// user: yang submit laporan { username, pangkat }
// hc: HC yang memutuskan { username }
// record: laporan absensi yang statusnya baru diubah (sudah termasuk status & alasan terbaru)
async function notifyStatusDiproses(user, hc, record) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const diterima = record.status === "diterima";
  const fields = [
    { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
    { name: "Tipe", value: TIPE_LABEL[record.tipe] || record.tipe, inline: true },
    { name: "Tanggal", value: formatTanggalSingkat(record.tanggal), inline: true },
    { name: "Diproses oleh", value: hc.username, inline: true },
  ];
  if (!diterima && record.alasan) {
    fields.push({ name: "Alasan Ditolak", value: String(record.alasan).slice(0, 500), inline: false });
  }

  const payload = {
    username: "Absensi Logs",
    embeds: [
      {
        title: diterima ? "Laporan Diterima" : "Laporan Ditolak",
        color: diterima ? 0x22c55e : 0xef4444,
        fields,
        footer: { text: `ID: ${record.id}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[discord webhook] gagal kirim notifikasi status:", err.message);
  }
}

// Helper generik kirim embed ke webhook — dipakai notifyKlaimGaji &
// notifyPendaftaranBaru biar nggak duplikat kode fetch+try/catch.
// `url` opsional — kalau nggak dikasih, pakai DISCORD_WEBHOOK_URL (webhook
// utama). Dipisahkan supaya notifyKlaimGaji bisa pakai webhook lain sendiri.
async function kirimEmbed(payload, url) {
  const targetUrl = url || process.env.DISCORD_WEBHOOK_URL;
  if (!targetUrl) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[discord webhook] gagal kirim notifikasi:", err.message);
  }
}

// Format "6/09/2026 14:35 WIB" — WAJIB pakai jakartaNow() + getter UTC, BUKAN
// `new Date()` + getter lokal biasa, soalnya server jalan di UTC — kalau
// dibiarkan, jamnya bakal salah 7 jam walau dilabelin "WIB".
function formatTanggalWaktu(d = jakartaNow()) {
  const tgl = d.getUTCDate();
  const bln = String(d.getUTCMonth() + 1).padStart(2, "0");
  const thn = d.getUTCFullYear();
  const jam = String(d.getUTCHours()).padStart(2, "0");
  const menit = String(d.getUTCMinutes()).padStart(2, "0");
  return `${tgl}/${bln}/${thn} ${jam}:${menit} WIB`;
}

// Bikin isi pesan Logs Gaji — plain text (BUKAN embed) persis format yang
// diminta: judul "LOGS GAJI" lalu blok kode berisi field-field-nya. Dipakai
// bareng sama notifyKlaimGaji (otomatis, pas anggota klaim gaji mingguan)
// dan kirimLogsGajiManual (custom, HC isi sendiri semua field dari Panel Rekap).
function buildLogsGajiContent({ namaPetugas, pangkat, tanggalWaktu, jumlah, diberikanOleh }) {
  return [
    "LOGS GAJI",
    "```",
    `Nama : ${namaPetugas}`,
    `Pangkat : ${pangkat}`,
    `Tanggal & Waktu : ${tanggalWaktu}`,
    `Jumlah : ${jumlah}`,
    `Diberikan oleh : ${diberikanOleh}`,
    "```",
  ].join("\n");
}

// Kirim pesan plain text (bukan embed) ke webhook Logs Gaji. Terpisah dari
// kirimEmbed karena payload-nya cuma `content`, bukan `embeds`.
async function kirimLogsGaji(fields) {
  const url = process.env.DISCORD_WEBHOOK_GAJI_URL;
  if (!url) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Gaji Logs", content: buildLogsGajiContent(fields) }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[discord webhook] gagal kirim notifikasi gaji:", err.message);
  }
}

// Dipanggil tiap anggota klaim gaji mingguan (otomatis, Senin-Rabu). SENGAJA
// pakai webhook sendiri (DISCORD_WEBHOOK_GAJI_URL) — TERPISAH dari webhook
// utama yang dipakai buat log absensi/pendaftaran (DISCORD_WEBHOOK_URL). Kalau
// DISCORD_WEBHOOK_GAJI_URL belum diisi, notifikasi ini cuma diam aja.
async function notifyKlaimGaji(user, jumlah) {
  await kirimLogsGaji({
    namaPetugas: user.namaKarakter || user.username,
    pangkat: user.pangkat || "-",
    tanggalWaktu: formatTanggalWaktu(),
    jumlah: `$${Number(jumlah).toLocaleString("id-ID")}`,
    diberikanOleh: `@${user.username}`,
  });
}

// Kirim Logs Gaji CUSTOM — semua field (nama, pangkat, jumlah, diberikan oleh)
// diisi bebas sama High Command dari Panel Rekap → tab "Kirim Gaji". Dipakai
// buat kasus di luar klaim mingguan biasa (misal bonus, koreksi, dll) —
// TIDAK mengubah data user apa pun, cuma ngirim log ke Discord.
async function kirimLogsGajiManual({ namaPetugas, pangkat, jumlah, diberikanOleh }) {
  await kirimLogsGaji({
    namaPetugas,
    pangkat,
    tanggalWaktu: formatTanggalWaktu(),
    jumlah,
    diberikanOleh,
  });
}

// Dipanggil tiap ada pendaftaran akun baru (menunggu approval High Command).
async function notifyPendaftaranBaru(pendaftar) {
  const base = process.env.SITE_URL;
  const linkPanel = base ? `${base.replace(/\/+$/, "")}/rekap.html?tab=pendaftaran` : null;
  await kirimEmbed({
    username: "Pendaftaran Logs",
    embeds: [
      {
        title: "🆕 Pendaftaran Akun Baru — Menunggu Approval",
        url: linkPanel || undefined,
        color: 0xeab308,
        fields: [
          { name: "Username", value: pendaftar.username, inline: true },
          { name: "Nama Karakter", value: pendaftar.namaKarakter || "-", inline: true },
        ],
        footer: { text: linkPanel ? "Klik judul di atas untuk approve/reject dari HP." : "Buka Panel Rekap → tab Pendaftaran untuk approve/reject." },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

// Dipanggil tiap anggota ajukan kenaikan pangkat (setelah memenuhi target
// mingguan: 5x arrest record + 30 jam duty). Menunggu di-ACC High Command
// lewat Panel Rekap -> tab "Kenaikan Pangkat".
async function notifyPengajuanPromosi(user, request) {
  const base = process.env.SITE_URL;
  const linkPanel = base ? `${base.replace(/\/+$/, "")}/rekap.html?tab=promosi` : null;
  await kirimEmbed({
    username: "Kenaikan Pangkat",
    embeds: [
      {
        title: "⭐ Pengajuan Kenaikan Pangkat — Menunggu Approval",
        url: linkPanel || undefined,
        color: 0xeab308,
        fields: [
          { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
          { name: "Pangkat Tujuan", value: request.pangkatTarget, inline: true },
          { name: "Arrest Record Minggu Ini", value: String(request.arrestCount), inline: true },
          { name: "Jam Duty Minggu Ini", value: `${request.jamDuty} jam`, inline: true },
        ],
        footer: { text: linkPanel ? "Klik judul di atas buat approve/reject dari HP." : `Buka Panel Rekap → tab Kenaikan Pangkat • ID: ${request.id}` },
        timestamp: request.tanggal,
      },
    ],
  });
}

// Dipanggil tiap High Command memproses (terima/tolak) pengajuan kenaikan pangkat.
async function notifyPromosiDiproses(user, hc, request) {
  const diterima = request.status === "diterima";
  const fields = [
    { name: "Anggota", value: `${user.username}`, inline: true },
    { name: diterima ? "Pangkat Baru" : "Pangkat Tujuan", value: request.pangkatTarget, inline: true },
    { name: "Diproses oleh", value: hc.username, inline: true },
  ];
  if (!diterima && request.alasan) {
    fields.push({ name: "Alasan Ditolak", value: String(request.alasan).slice(0, 500), inline: false });
  }
  await kirimEmbed({
    username: "Kenaikan Pangkat",
    embeds: [
      {
        title: diterima ? "🎖️ Kenaikan Pangkat Disetujui" : "Pengajuan Kenaikan Pangkat Ditolak",
        color: diterima ? 0x22c55e : 0xef4444,
        fields,
        footer: { text: `ID: ${request.id}` },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

module.exports = {
  notifyLaporanMasuk, notifyStatusDiproses, notifyKlaimGaji, kirimLogsGajiManual, notifyPendaftaranBaru,
  notifyPengajuanPromosi, notifyPromosiDiproses,
};
