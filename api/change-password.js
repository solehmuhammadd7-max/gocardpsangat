const kvStore = require("../lib/kv");
const { getUserFromReq } = require("../lib/auth");
const { hashPassword, verifyPassword } = require("../lib/password");

module.exports = async (req, res) => {
  const me = await getUserFromReq(req);
  if (!me) return res.status(401).json({ error: "Belum login." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Password lama & password baru wajib diisi." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password baru minimal 6 karakter." });
  }

  const users = await kvStore.getUsers();
  const target = users.find((u) => u.id === me.id);
  if (!target) return res.status(404).json({ error: "Akun tidak ditemukan." });

  if (!verifyPassword(currentPassword, target.passwordHash)) {
    return res.status(401).json({ error: "Password lama salah." });
  }

  target.passwordHash = hashPassword(newPassword);
  await kvStore.setUsers(users);
  res.json({ ok: true });
};
