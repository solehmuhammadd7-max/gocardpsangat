// Forum komunitas (gaya Invision): kategori -> topik -> post, reaksi, kutip,
// pin/kunci/pindah (High Command). Numpang di api/auth-login.js (limit 12 function).
// Redis: forum:index (ringkasan semua topik), forum:t:<id> (post per topik), forum:jumlah (hitungan post per user).
const crypto = require("crypto");
const kv = require("./kv");
const warga = require("./warga");
const { getUserFromReq } = require("./auth");
const { uploadFotoKeCloudinary } = require("./cloudinary");

const KATEGORI = [
  { id: "pengumuman", nama: "Pengumuman", desk: "Informasi resmi Kepolisian Nexotis.", hanyaHC: true },
  { id: "saran", nama: "Saran", desk: "Ide dan masukan untuk kepolisian." },
  { id: "kritik", nama: "Kritik", desk: "Sampaikan keluhan atau evaluasi." },
  { id: "tanya", nama: "Tanya Jawab", desk: "Ada yang mau ditanyakan?" },
  { id: "umum", nama: "Obrolan Umum", desk: "Ngobrol santai antar warga." },
];
const REAKSI = ["suka", "cinta", "haha", "wow", "sedih"];
const PER_TOPIK = 15, PER_POST = 10, MAX_TOPIK = 500, MAX_POST = 300;
const rid = () => crypto.randomBytes(6).toString("hex");
const potong = (t, n) => String(t == null ? "" : t).trim().slice(0, n);
const jeda = (iso, dtk) => iso && Date.now() - new Date(iso).getTime() < dtk * 1000;

// PENTING (permission): sesi ANGGOTA dicek DULU. Dulu urutannya kebalik — kalau
// seorang HC juga pernah login Discord (punya 2 cookie), dia dianggap "warga"
// dan kehilangan hak High Command. Sekarang akun anggota selalu menang.
// Hak High Command (pin/kunci/pindah/hapus) HANYA datang dari flag
// isHighCommand di akun anggota — bukan dari label, nama, atau role Discord.
async function aktor(req) {
  const u = await getUserFromReq(req);
  if (u && (u.status || "approved") === "approved") {
    // avatar anggota = data-URL besar, jangan disimpan di forum -> pakai inisial
    return { tipe: u.isHighCommand ? "hc" : "anggota", id: "u:" + u.id, nama: u.namaKarakter || u.username, avatar: null, sejak: u.bergabung || null, hc: !!u.isHighCommand };
  }
  const w = await warga.getWargaFromReq(req);
  if (w) { const s = warga.sanitizeWarga(w); return { tipe: "warga", id: "w:" + w.id, nama: s.nama, avatar: s.avatar, sejak: w.pertamaLogin, hc: false }; }
  return null;
}

// Info penulis SELALU diambil live (bukan salinan saat posting), jadi kalau
// profil/pangkat/role berubah, label & nama di post lama ikut berubah otomatis.
async function petaPenulis() {
  const [users, wargas] = await Promise.all([kv.getUsers(), kv.getWarga()]);
  const U = new Map(users.map((u) => [u.id, u])), W = new Map(wargas.map((w) => [w.id, w]));
  return (penulisId, cadangan) => {
    const id = String(penulisId || "");
    if (id.startsWith("u:")) {
      const u = U.get(id.slice(2));
      if (u && (u.status || "approved") === "approved") return { nama: u.namaKarakter || u.username, avatar: null, banner: null, bio: u.bio || "", labels: warga.labelAnggota(u), sejak: u.bergabung || null };
      return cadangan ? { nama: cadangan.penulisNama, avatar: null, banner: null, bio: "", labels: [{ teks: "Akun tidak aktif", tone: "warga" }], sejak: cadangan.sejak || null } : null;
    }
    if (id.startsWith("w:")) {
      const w = W.get(id.slice(2));
      if (w) { const s = warga.sanitizeWarga(w); return { nama: s.nama, avatar: s.avatar, banner: s.banner, bio: s.bio, labels: s.labels, sejak: w.pertamaLogin }; }
      return cadangan ? { nama: cadangan.penulisNama, avatar: cadangan.penulisAvatar || null, banner: null, bio: "", labels: [{ teks: "Warga", tone: "warga" }], sejak: cadangan.sejak || null } : null;
    }
    return cadangan ? { nama: cadangan.penulisNama, avatar: cadangan.penulisAvatar || null, banner: null, bio: "", labels: [{ teks: "Warga", tone: "warga" }], sejak: cadangan.sejak || null } : null;
  };
}

// Migrasi otomatis dari versi forum lama (1 key nexotis:forum) — sekali saja.
async function getIdx() {
  let idx = await kv.forumGet("index");
  if (idx) return idx;
  idx = [];
  const lama = await kv.getForum();
  for (const p of Array.isArray(lama) ? lama : []) {
    const mk = (x) => ({ id: x.id, isi: x.isi, penulisId: x.penulisId, penulisNama: x.penulisNama, penulisAvatar: x.penulisAvatar || null, penulisTipe: x.penulisTipe, sejak: null, tanggal: x.tanggal, reaksi: {} });
    const posts = [mk(p), ...(p.komentar || []).map(mk)];
    await kv.forumSet("t:" + p.id, { posts });
    const akhir = posts[posts.length - 1];
    idx.push({ id: p.id, kat: p.jenis === "kritik" ? "kritik" : "saran", judul: p.judul, penulisId: p.penulisId, penulisNama: p.penulisNama, penulisTipe: p.penulisTipe,
      tanggal: p.tanggal, balasan: posts.length - 1, views: 0, pin: false, kunci: false, terakhir: { nama: akhir.penulisNama, tanggal: akhir.tanggal }, cuplikan: p.isi.slice(0, 140) });
  }
  await kv.forumSet("index", idx);
  return idx;
}
const simpanIdx = (idx) => kv.forumSet("index", idx);
async function ubahJumlah(id, d) { const j = (await kv.forumGet("jumlah")) || {}; j[id] = Math.max(0, (j[id] || 0) + d); await kv.forumSet("jumlah", j); }
// Foto (data URL dari browser, sudah dikompres) -> Cloudinary. Maks 3 foto per post.
const RE_FOTO = /^data:image\/(jpeg|png|webp);base64,/;
async function unggah(arr, prefix) {
  if (!Array.isArray(arr) || !arr.length) return [];
  const l = arr.slice(0, 3);
  for (const d of l) {
    if (typeof d !== "string" || !RE_FOTO.test(d)) throw new Error("Format foto tidak valid.");
    if (d.length > 1.2 * 1024 * 1024) throw new Error("Foto terlalu besar.");
  }
  try { return await Promise.all(l.map((d, i) => uploadFotoKeCloudinary(d, `${prefix}-${i}`))); }
  catch (e) { throw new Error("Upload foto gagal: " + e.message); }
}
const katOf = (id) => KATEGORI.find((k) => k.id === id);
const publik = (m) => ({ id: m.id, kat: m.kat, judul: m.judul, penulisNama: m.penulisNama, penulisTipe: m.penulisTipe, tanggal: m.tanggal, balasan: m.balasan, views: m.views || 0, pin: !!m.pin, kunci: !!m.kunci, terakhir: m.terakhir, cuplikan: m.cuplikan, thumb: m.thumb || null });

async function handle(req, res, aksi) {
  let me;
  try { me = await aktor(req); } catch (e) { return res.status(500).json({ error: "Gagal konek ke database." }); }
  if (!me) return res.status(401).json({ error: "Belum login." });
  const q = req.query || {}, b = req.body || {};
  const idx = await getIdx();
  const cari = (id) => idx.find((x) => x.id === id);
  const bolehBuat = (k) => !!k && (!k.hanyaHC || me.hc);

  if (req.method === "GET") {
    if (aksi === "forum-home") {
      const kategori = KATEGORI.map((k) => {
        const t = idx.filter((x) => x.kat === k.id);
        const last = t.slice().sort((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal))[0];
        return { ...k, topik: t.length, post: t.reduce((n, x) => n + x.balasan + 1, 0), terakhir: last ? { id: last.id, judul: last.judul, nama: last.terakhir.nama, tanggal: last.terakhir.tanggal } : null, bolehBuat: bolehBuat(k) };
      });
      const warg = await kv.getWarga();
      const ring = (x) => ({ id: x.id, judul: x.judul, kat: x.kat, katNama: (katOf(x.kat) || {}).nama || x.kat, nama: x.terakhir.nama, tanggal: x.terakhir.tanggal, balasan: x.balasan, views: x.views || 0, pin: !!x.pin });
      const aktivitas = idx.slice().sort((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal)).slice(0, 6).map(ring);
      const populer = idx.filter((x) => (x.views || 0) > 0).sort((a, c) => (c.views || 0) - (a.views || 0) || c.balasan - a.balasan).slice(0, 4).map(ring);
      return res.json({ peran: me.tipe, kategori, aktivitas, populer, stat: { topik: idx.length, post: idx.reduce((n, x) => n + x.balasan + 1, 0), warga: warg.length } });
    }
    if (aksi === "forum-topik-list") {
      const semua = q.kat === "semua", k = katOf(q.kat);
      if (!semua && !k) return res.status(404).json({ error: "Kategori tidak ditemukan." });
      const kata = String(q.q || "").toLowerCase().trim();
      let t = idx.filter((x) => (semua || x.kat === q.kat) && (!kata || x.judul.toLowerCase().includes(kata) || x.cuplikan.toLowerCase().includes(kata)));
      const urut = { baru: (a, c) => c.tanggal.localeCompare(a.tanggal), populer: (a, c) => (c.views || 0) - (a.views || 0) || c.balasan - a.balasan }[q.urut] || ((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal));
      t = t.slice().sort((a, c) => (c.pin ? 1 : 0) - (a.pin ? 1 : 0) || urut(a, c));
      const halTotal = Math.max(1, Math.ceil(t.length / PER_TOPIK)), hal = Math.min(Math.max(1, +q.hal || 1), halTotal);
      return res.json({ kat: k ? { ...k, bolehBuat: bolehBuat(k) } : { id: "semua", nama: "Hasil Pencarian", desk: "" }, total: t.length, hal, halTotal, topik: t.slice((hal - 1) * PER_TOPIK, hal * PER_TOPIK).map(publik) });
    }
    if (aksi === "forum-topik") {
      const m = cari(q.id);
      if (!m) return res.status(404).json({ error: "Topik tidak ditemukan." });
      const doc = (await kv.forumGet("t:" + m.id)) || { posts: [] };
      const halTotal = Math.max(1, Math.ceil(doc.posts.length / PER_POST)), hal = Math.min(Math.max(1, +q.hal || 1), halTotal);
      if (hal === 1) { m.views = (m.views || 0) + 1; await simpanIdx(idx); }
      const jumlah = (await kv.forumGet("jumlah")) || {};
      const penulis = await petaPenulis();
      const posts = doc.posts.slice((hal - 1) * PER_POST, hal * PER_POST).map((p, i) => {
        const no = (hal - 1) * PER_POST + i + 1, rk = {}, a = penulis(p.penulisId, p);
        Object.values(p.reaksi || {}).forEach((r) => { rk[r] = (rk[r] || 0) + 1; });
        return { id: p.id, no, isi: p.isi, foto: p.foto || [], penulisId: p.penulisId, penulisNama: a.nama, penulisAvatar: a.avatar, labels: a.labels, bio: a.bio, sejak: a.sejak, jumlahPost: jumlah[p.penulisId] || 0,
          tanggal: p.tanggal, edit: p.edit || null, reaksi: rk, sayaReaksi: (p.reaksi || {})[me.id] || null, bolehEdit: p.penulisId === me.id, bolehHapus: no > 1 && (me.hc || p.penulisId === me.id) };
      });
      const k = katOf(m.kat);
      return res.json({ peran: me.tipe, hal, halTotal, kategori: me.hc ? KATEGORI.map((x) => ({ id: x.id, nama: x.nama })) : [],
        topik: { ...publik(m), katNama: k ? k.nama : m.kat, bolehKelola: me.hc, bolehBalas: !m.kunci || me.hc, bolehHapus: me.hc || (m.penulisId === me.id && doc.posts.length === 1) }, posts });
    }
    if (aksi === "forum-profil") {
      const id = String(q.id || ""), a = (await petaPenulis())(id);
      if (!a) return res.status(404).json({ error: "Profil tidak ditemukan." });
      const jumlah = (await kv.forumGet("jumlah")) || {};
      const topik = idx.filter((x) => x.penulisId === id).slice().sort((x, y) => y.tanggal.localeCompare(x.tanggal)).slice(0, 8).map(publik);
      // Cuma info publik: nama, avatar, bio, label. Username/ID Discord TIDAK dikirim.
      return res.json({ id, nama: a.nama, avatar: a.avatar, banner: a.banner, bio: a.bio, labels: a.labels, sejak: a.sejak, jumlahPost: jumlah[id] || 0, jumlahTopik: topik.length, topik });
    }
    return res.status(400).json({ error: "Aksi tidak dikenal." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });
  const now = new Date().toISOString();

  if (aksi === "forum-buat") {
    const k = katOf(b.kat), judul = potong(b.judul, 100), isi = potong(b.isi, 5000);
    if (!k) return res.status(400).json({ error: "Pilih kategori." });
    if (!bolehBuat(k)) return res.status(403).json({ error: "Kategori ini khusus High Command." });
    if (judul.length < 3) return res.status(400).json({ error: "Judul minimal 3 karakter." });
    if (isi.length < 5) return res.status(400).json({ error: "Isi minimal 5 karakter." });
    if (jeda(idx.filter((x) => x.penulisId === me.id).map((x) => x.tanggal).sort().pop(), 30)) return res.status(429).json({ error: "Tunggu sebentar sebelum membuat topik lagi." });
    const id = rid();
    let foto;
    try { foto = await unggah(b.foto, `forum/${id}`); } catch (e) { return res.status(400).json({ error: e.message }); }
    await kv.forumSet("t:" + id, { posts: [{ id: rid(), isi, foto, penulisId: me.id, penulisNama: me.nama, penulisAvatar: me.avatar, penulisTipe: me.tipe, sejak: me.sejak, tanggal: now, reaksi: {} }] });
    idx.unshift({ id, kat: k.id, judul, penulisId: me.id, penulisNama: me.nama, penulisTipe: me.tipe, tanggal: now, balasan: 0, views: 0, pin: false, kunci: false, terakhir: { nama: me.nama, tanggal: now }, cuplikan: isi.slice(0, 140), thumb: foto[0] || null });
    while (idx.length > MAX_TOPIK) { const i = idx.map((x) => !x.pin).lastIndexOf(true); if (i < 0) break; const [gone] = idx.splice(i, 1); await kv.forumDel("t:" + gone.id); }
    await simpanIdx(idx); await ubahJumlah(me.id, 1);
    return res.json({ ok: true, id });
  }

  const m = cari(b.id);
  if (!m) return res.status(404).json({ error: "Topik tidak ditemukan." });
  const doc = (await kv.forumGet("t:" + m.id)) || { posts: [] };
  const sinkron = async () => {
    const a = doc.posts[doc.posts.length - 1];
    m.balasan = Math.max(0, doc.posts.length - 1);
    if (a) m.terakhir = { nama: a.penulisNama, tanggal: a.tanggal };
    m.cuplikan = doc.posts[0] ? doc.posts[0].isi.slice(0, 140) : m.cuplikan;
    m.thumb = doc.posts[0] && doc.posts[0].foto && doc.posts[0].foto[0] || null;
    await kv.forumSet("t:" + m.id, doc); await simpanIdx(idx);
  };

  if (aksi === "forum-balas") {
    const isi = potong(b.isi, 5000), ada = Array.isArray(b.foto) && b.foto.length > 0;
    if (m.kunci && !me.hc) return res.status(403).json({ error: "Topik ini dikunci." });
    if (!isi && !ada) return res.status(400).json({ error: "Balasan tidak boleh kosong." });
    if (doc.posts.length >= MAX_POST) return res.status(400).json({ error: "Topik ini sudah penuh." });
    if (jeda(doc.posts.filter((p) => p.penulisId === me.id).map((p) => p.tanggal).sort().pop(), 5)) return res.status(429).json({ error: "Pelan-pelan, tunggu beberapa detik." });
    let foto;
    try { foto = await unggah(b.foto, `forum/${m.id}-${rid()}`); } catch (e) { return res.status(400).json({ error: e.message }); }
    doc.posts.push({ id: rid(), isi, foto, penulisId: me.id, penulisNama: me.nama, penulisAvatar: me.avatar, penulisTipe: me.tipe, sejak: me.sejak, tanggal: now, reaksi: {} });
    await sinkron(); await ubahJumlah(me.id, 1);
    return res.json({ ok: true, halTotal: Math.ceil(doc.posts.length / PER_POST) });
  }
  if (aksi === "forum-edit") {
    const p = doc.posts.find((x) => x.id === b.postId), isi = potong(b.isi, 5000);
    if (!p) return res.status(404).json({ error: "Post tidak ditemukan." });
    if (p.penulisId !== me.id) return res.status(403).json({ error: "Cuma bisa edit post sendiri." });
    if (isi.length < 1) return res.status(400).json({ error: "Isi tidak boleh kosong." });
    p.isi = isi; p.edit = now; await sinkron();
    return res.json({ ok: true });
  }
  if (aksi === "forum-hapus") {
    if (!b.postId) {
      if (!(me.hc || (m.penulisId === me.id && doc.posts.length === 1))) return res.status(403).json({ error: "Kamu tidak boleh menghapus topik ini." });
      for (const p of doc.posts) await ubahJumlah(p.penulisId, -1);
      idx.splice(idx.indexOf(m), 1); await kv.forumDel("t:" + m.id); await simpanIdx(idx);
      return res.json({ ok: true });
    }
    const i = doc.posts.findIndex((x) => x.id === b.postId);
    if (i < 1) return res.status(404).json({ error: "Post tidak ditemukan (post pertama = hapus topiknya)." });
    if (!(me.hc || doc.posts[i].penulisId === me.id)) return res.status(403).json({ error: "Kamu tidak boleh menghapus post ini." });
    const [gone] = doc.posts.splice(i, 1); await sinkron(); await ubahJumlah(gone.penulisId, -1);
    return res.json({ ok: true });
  }
  if (aksi === "forum-reaksi") {
    const p = doc.posts.find((x) => x.id === b.postId);
    if (!p) return res.status(404).json({ error: "Post tidak ditemukan." });
    if (!REAKSI.includes(b.reaksi)) return res.status(400).json({ error: "Reaksi tidak valid." });
    p.reaksi = p.reaksi || {};
    if (p.reaksi[me.id] === b.reaksi) delete p.reaksi[me.id]; else p.reaksi[me.id] = b.reaksi;
    await kv.forumSet("t:" + m.id, doc);
    return res.json({ ok: true });
  }
  if (aksi === "forum-mod") {
    if (!me.hc) return res.status(403).json({ error: "Khusus High Command." });
    if (b.op === "pin") m.pin = !m.pin;
    else if (b.op === "kunci") m.kunci = !m.kunci;
    else if (b.op === "pindah" && katOf(b.kat)) m.kat = b.kat;
    else return res.status(400).json({ error: "Operasi tidak dikenal." });
    await simpanIdx(idx);
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "Aksi tidak dikenal." });
}

// Ringkasan buat dashboard warga (warga.html): stat, pengumuman, aktivitas, kategori.
async function beranda(w) {
  const idx = await getIdx(), jumlah = (await kv.forumGet("jumlah")) || {}, warg = await kv.getWarga(), sayaId = "w:" + w.id;
  const ring = (x) => ({ id: x.id, judul: x.judul, kat: x.kat, katNama: (katOf(x.kat) || {}).nama || x.kat, nama: x.terakhir.nama, tanggal: x.terakhir.tanggal, balasan: x.balasan, pin: !!x.pin });
  return {
    stat: { topik: idx.length, post: idx.reduce((n, x) => n + x.balasan + 1, 0), warga: warg.length },
    pengumuman: idx.filter((x) => x.kat === "pengumuman").sort((a, c) => (c.pin ? 1 : 0) - (a.pin ? 1 : 0) || c.tanggal.localeCompare(a.tanggal)).slice(0, 3).map((x) => ({ ...ring(x), cuplikan: x.cuplikan })),
    aktivitas: idx.slice().sort((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal)).slice(0, 6).map(ring),
    kategori: KATEGORI.map((k) => ({ id: k.id, nama: k.nama, desk: k.desk, topik: idx.filter((x) => x.kat === k.id).length })),
    saya: { post: jumlah[sayaId] || 0, topik: idx.filter((x) => x.penulisId === sayaId).length },
  };
}

module.exports = { handle, beranda };
