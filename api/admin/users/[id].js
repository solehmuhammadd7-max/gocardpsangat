const kvStore = require("../../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../../lib/auth");
const { hashPassword } = require("../../../lib/password");

module.exports = async (req, res) => {
  try {
    const me = await getUserFromReq(req);
    if (!me) return res.status(401).json({ error: "Belum login." });
    if (!me.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

    const { id } = req.query;
    const users = await kvStore.getUsers();
    const target = users.find((u) => u.id === id);
    if (!target) return res.status(404).json({ error: "User tidak ditemukan." });

    if (req.method === "PATCH") {
      const { pangkat, isHighCommand, newPassword, status } = req.body || {};

      // Approve/reject pendaftaran akun baru dari tab Pendaftaran di Panel
      // Rekap — juga numpang di endpoint ini, bukan endpoint baru.
      if (status !== undefined) {
        if (!["approved", "pending", "ditolak"].includes(status)) {
          return res.status(400).json({ error: "Status tidak valid." });
        }
        target.status = status;
        await kvStore.setUsers(users);
        return res.json({ ok: true, user: sanitizeUser(target) });
      }

      if (pangkat !== undefined) target.pangkat = pangkat;
      if (isHighCommand !== undefined) target.isHighCommand = !!isHighCommand;
      if (newPassword) {
        if (newPassword.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
        target.passwordHash = hashPassword(newPassword);
      }
      await kvStore.setUsers(users);
      return res.json({ ok: true, user: sanitizeUser(target) });
    }

    if (req.method === "DELETE") {
      if (target.id === me.id) return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri." });
      await kvStore.setUsers(users.filter((u) => u.id !== id));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method tidak didukung." });
  } catch (err) {
    // Log lengkap ke Vercel function logs, tapi juga kirim pesannya ke
    // client biar nggak cuma dapet "Terjadi kesalahan (500)" yang buta arah.
    console.error("Error di /api/admin/users/[id]:", err);
    return res.status(500).json({ error: `Server error: ${err.message || "unknown error"}` });
  }
};
