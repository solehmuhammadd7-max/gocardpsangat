// Sesi login tanpa penyimpanan di server: payload ditandatangani (HMAC) dan
// disimpan langsung di cookie. Setiap function serverless bisa memverifikasi
// cookie ini sendiri tanpa perlu "ingat" apa pun dari request sebelumnya —
// penting karena Vercel Functions tidak menjamin instance yang sama dipakai lagi.

const crypto = require("crypto");

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(data).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null; // panjang beda dsb.
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
