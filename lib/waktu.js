// WIB (Asia/Jakarta) = UTC+7, TANPA daylight saving (jadi offset-nya tetap,
// gak pernah berubah sepanjang tahun). Server (Vercel) jalan di UTC, sedangkan
// SEMUA aturan bisnis di web ini (jam berapa laporan hadir dicatat, hari apa
// gaji boleh diklaim, dst) berpatokan ke WIB — jadi mana pun logic yang butuh
// "hari ini" / "jam berapa sekarang" WAJIB lewat sini, JANGAN langsung
// `new Date()` mentah-mentah. Kalau nggak, antara jam 00:00–06:59 WIB
// (masih 17:00–23:59 UTC hari sebelumnya), server bakal salah nganggep masih
// "kemarin" — laporan hadir yang disubmit jam segitu jadi gak kehitung.

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

// Balikin Date yang kalau dibaca pakai getter UTC (getUTCDate, getUTCDay,
// getUTCHours, dst — BUKAN getDate/getDay/getHours biasa) hasilnya = waktu
// WIB saat ini. Trik ini konsisten di mana pun server-nya dijalankan.
function jakartaNow() {
  return new Date(Date.now() + JAKARTA_OFFSET_MS);
}

// "YYYY-MM-DD" hari ini menurut kalender WIB.
function jakartaTodayISO() {
  return jakartaNow().toISOString().slice(0, 10);
}

// "YYYY-MM-DD" (kalender WIB) dari sebuah ISO timestamp (mis. arrest.tanggal
// yang disimpan pakai `new Date().toISOString()` / UTC). Dipakai buat nentuin
// arrest record itu "milik" tanggal WIB yang mana, biar konsisten sama
// tanggal absensi yang emang udah WIB dari awal.
function jakartaDateFromISO(isoString) {
  return new Date(new Date(isoString).getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

module.exports = { jakartaNow, jakartaTodayISO, jakartaDateFromISO };
