// Kirim kode verifikasi lewat Gmail SMTP (nodemailer).
// Env: GMAIL_USER (alamat gmail pengirim) & GMAIL_APP_PASSWORD (App Password 16 huruf,
// bikin di Akun Google > Keamanan > Verifikasi 2 Langkah > Sandi aplikasi).
const nodemailer = require("nodemailer");
const crypto = require("crypto");

function kode6() { return String(crypto.randomInt(0, 1000000)).padStart(6, "0"); }
function hashKode(kode) { return crypto.createHmac("sha256", process.env.SESSION_SECRET || "x").update(String(kode)).digest("hex"); }
function cekGmail(email) { return /^[a-z0-9._+-]+@(gmail|googlemail)\.com$/i.test(String(email || "").trim()); }
function maskEmail(e) { const [a, d] = String(e).split("@"); return a.slice(0, 2) + "***" + (a.length > 2 ? a.slice(-1) : "") + "@" + d; }
function getIp(req) {
  let ip = String(req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (ip.includes(":")) ip = ip.split(":").slice(0, 4).join(":"); // IPv6: pakai prefix /64 biar nggak gampang beda
  return ip || "unknown";
}

async function kirimKode(to, kode, tujuan) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error("Email belum di-setup (GMAIL_USER / GMAIL_APP_PASSWORD).");
  const t = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await t.sendMail({
    from: `"Kepolisian Nexotis" <${process.env.GMAIL_USER}>`, to,
    subject: `Kode verifikasi ${kode} - Kepolisian Nexotis`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;border-top:5px solid #c81e1e;padding:20px;border:1px solid #eee">
      <h2 style="color:#c81e1e;margin:0 0 8px">KEPOLISIAN NEXOTIS</h2><p style="color:#444">${tujuan}</p>
      <div style="font-size:34px;letter-spacing:10px;font-weight:700;text-align:center;background:#fee2e2;color:#991b1b;padding:14px;border-radius:8px">${kode}</div>
      <p style="color:#777;font-size:12px">Berlaku 10 menit. Jangan bagikan kode ini ke siapa pun. Kalau bukan kamu, abaikan email ini.</p></div>`,
  });
}
module.exports = { kode6, hashKode, cekGmail, maskEmail, getIp, kirimKode };
