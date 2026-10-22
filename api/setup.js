// Endpoint ini cuma bisa dipakai SEKALI (selama belum ada user sama sekali)
// dan wajib tahu SETUP_SECRET (diisi sendiri di Environment Variables Vercel,
// bukan di-commit) — supaya orang random nggak bisa bikin akun High Command
// sendiri lewat endpoint publik ini.

const crypto = require("crypto");
const { jakartaTodayISO } = require("../lib/waktu");
const kvStore = require("../lib/kv");
const { hashPassword } = require("../lib/password");

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "Method tidak didukung.");

  const missingEnv = ["SETUP_SECRET", "SESSION_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
    .filter((key) => !process.env[key]);
  if (missingEnv.length) {
    console.error("Env var belum diisi:", missingEnv.join(", "));
    return fail(res, 500, `Konfigurasi server belum lengkap: ${missingEnv.join(", ")} belum diisi di Environment Variables Vercel (lalu redeploy).`);
  }

  const { secret, username, password, pangkat } = req.body || {};

  if (secret !== process.env.SETUP_SECRET) {
    return fail(res, 401, "Setup secret salah.");
  }

  if (!username || !password || password.length < 6) {
    return fail(res, 400, "Username wajib diisi, password minimal 6 karakter.");
  }

  let users;
  try {
    users = await kvStore.getUsers();
  } catch (err) {
    console.error("[setup] gagal konek Upstash:", err.message);
    return fail(res, 500, `Gagal konek ke database: ${err.message}`);
  }

  if (users.length > 0) {
    return fail(res, 409, "Sudah ada user terdaftar — setup awal cuma bisa dipakai sekali.");
  }

  const admin = {
    id: crypto.randomBytes(8).toString("hex"),
    username: String(username).trim(),
    passwordHash: hashPassword(password),
    pangkat: pangkat || "Panglima Polisi",
    isHighCommand: true,
    avatar: null,
    status: "approved",
    bergabung: jakartaTodayISO(),
  };

  try {
    users.push(admin);
    await kvStore.setUsers(users);
  } catch (err) {
    console.error("[setup] gagal simpan ke Upstash:", err.message);
    return fail(res, 500, `Gagal simpan akun ke database: ${err.message}`);
  }

  res.json({ ok: true });
};
