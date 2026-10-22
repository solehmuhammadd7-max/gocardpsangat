const crypto = require("crypto");
const { jakartaTodayISO } = require("../../lib/waktu");
const kvStore = require("../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../lib/auth");
const { hashPassword } = require("../../lib/password");

module.exports = async (req, res) => {
  const me = await getUserFromReq(req);
  if (!me) return res.status(401).json({ error: "Belum login." });
  if (!me.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  const users = await kvStore.getUsers();

  if (req.method === "GET") {
    return res.json({ users: users.map(sanitizeUser) });
  }

  if (req.method === "POST") {
    const { username, password, pangkat, isHighCommand } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username & password wajib diisi." });
    if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });

    const exists = users.some((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
    if (exists) return res.status(409).json({ error: "Username sudah dipakai." });

    const newUser = {
      id: crypto.randomBytes(8).toString("hex"),
      username: String(username).trim(),
      passwordHash: hashPassword(password),
      pangkat: pangkat || "Bhayangkara Dua",
      isHighCommand: !!isHighCommand,
      avatar: null,
      status: "approved", // dibuat langsung sama HC, jadi otomatis approved (nggak lewat alur pendaftaran)
      bergabung: jakartaTodayISO(), // dipakai biar hari sebelum gabung nggak ikut dihitung alpa
    };
    users.push(newUser);
    await kvStore.setUsers(users);
    return res.json({ ok: true, user: sanitizeUser(newUser) });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
