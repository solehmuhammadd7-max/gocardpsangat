const kvStore = require("./kv");
const session = require("./session");

const SESSION_COOKIE = "nexotis_session";

async function getUserFromReq(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = session.verify(token);
  if (!payload) return null;
  const users = await kvStore.getUsers();
  return users.find((u) => u.id === payload.userId) || null;
}

function setSessionCookie(res, userId, maxAgeSec) {
  const token = session.sign({ userId, exp: Date.now() + maxAgeSec * 1000 });
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Jangan pernah kirim passwordHash ke frontend.
function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = { getUserFromReq, setSessionCookie, clearSessionCookie, sanitizeUser };
