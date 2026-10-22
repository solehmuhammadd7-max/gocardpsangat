// Endpoint Arrest Record. Satu file numpang 4 method biar nggak nambah
// jumlah serverless function (Vercel Hobby limit 12):
//   GET    -> daftar arrest record (semua anggota boleh lihat)
//   POST   -> submit BAP baru (semua anggota boleh bikin)
//   PATCH  -> edit arrest record (KHUSUS High Command), pakai ?id=xxx
//   DELETE -> hapus arrest record (KHUSUS High Command), pakai ?id=xxx
const crypto = require("crypto");
const kvStore = require("../lib/kv");
const { getUserFromReq } = require("../lib/auth");

const MAX_ARRESTS_DISIMPAN = 500; // biar Redis nggak bengkak nggak terbatas

async function kirimKeDiscord(arrest, fotoKtp) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const fields = [
    { name: "Nama Petugas", value: arrest.namaPetugas || "-", inline: true },
    { name: "Umur Petugas", value: arrest.umurPetugas || "-", inline: true },
    { name: "Divisi", value: arrest.divisiPetugas || "-", inline: true },
    { name: "Pangkat", value: arrest.pangkatPetugas || "-", inline: true },
    { name: "Nama Tersangka", value: arrest.namaTersangka, inline: true },
    { name: "Umur Tersangka", value: arrest.umurTersangka || "-", inline: true },
    { name: "Lokasi Penangkapan", value: arrest.lokasi || "-", inline: true },
  ];
  if (arrest.ciriTersangka) fields.push({ name: "Ciri-Ciri Tersangka", value: arrest.ciriTersangka.slice(0, 500), inline: false });
  if (arrest.pasalDipilih && arrest.pasalDipilih.length) {
    fields.push({ name: "Pasal Dikenakan", value: arrest.pasalDipilih.join(", ").slice(0, 1000), inline: false });
  }
  if (arrest.totalDenda) fields.push({ name: "Total Denda", value: arrest.totalDenda, inline: true });
  fields.push({ name: "Kronologi Kejadian Perkara", value: arrest.kronologi, inline: false });

  const payload = {
    username: "Arrest Record",
    embeds: [{ title: "🚔 Arrest Record Baru", color: 0xff7aa2, fields, footer: { text: `ID Perkara: ${arrest.id}` }, timestamp: arrest.tanggal }],
  };

  try {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    if (Array.isArray(fotoKtp)) {
      fotoKtp.slice(0, 2).forEach((dataUrl, i) => {
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || "");
        if (!match) return;
        const buffer = Buffer.from(match[2], "base64");
        const ext = match[1].split("/")[1] || "jpg";
        form.append(`file${i}`, new Blob([buffer], { type: match[1] }), `ktp${i}.${ext}`);
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(url, { method: "POST", body: form, signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[arrest] gagal kirim ke Discord (berkas tetap tersimpan):", err.message);
  }
}

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });

  // ====== GET: daftar arrest record ======
  if (req.method === "GET") {
    const arrests = await kvStore.getArrests();
    return res.json({ arrests: arrests.slice(0, MAX_ARRESTS_DISIMPAN) });
  }

  // ====== POST: submit BAP baru ======
  if (req.method === "POST") {
    const {
      namaPetugas, umurPetugas, divisiPetugas,
      namaTersangka, umurTersangka, ciriTersangka, lokasi,
      kronologi, pasalDipilih, totalDenda, fotoKtp,
    } = req.body || {};

    if (!namaTersangka || !kronologi) {
      return res.status(400).json({ error: "Nama tersangka & kronologi kejadian wajib diisi." });
    }

    const arrest = {
      id: crypto.randomBytes(8).toString("hex"),
      tanggal: new Date().toISOString(),
      // Data petugas — dari form (bukan cuma username akun), pangkat tetap
      // diambil dari akun yang login (nggak bisa diisi manual/dipalsu).
      dibuatOlehUserId: user.id,
      namaPetugas: namaPetugas ? String(namaPetugas).slice(0, 100) : user.username,
      umurPetugas: umurPetugas ? String(umurPetugas).slice(0, 10) : "",
      divisiPetugas: divisiPetugas ? String(divisiPetugas).slice(0, 100) : "",
      pangkatPetugas: user.pangkat || "-",
      // Data tersangka
      namaTersangka: String(namaTersangka).slice(0, 150),
      umurTersangka: umurTersangka ? String(umurTersangka).slice(0, 10) : "",
      ciriTersangka: ciriTersangka ? String(ciriTersangka).slice(0, 500) : "",
      lokasi: lokasi ? String(lokasi).slice(0, 200) : "",
      // Kasus
      kronologi: String(kronologi).slice(0, 1000),
      pasalDipilih: Array.isArray(pasalDipilih) ? pasalDipilih.slice(0, 20) : [],
      totalDenda: totalDenda ? String(totalDenda) : "-",
      // Foto KTP DISIMPAN (beda dari sebelumnya) karena ini bukti utama
      // identitas tersangka yang perlu dilihat lagi lewat "Lihat Detail" —
      // dibatasi maks 2 gambar & sudah dikompres dari sisi client.
      fotoKtp: Array.isArray(fotoKtp) ? fotoKtp.slice(0, 2) : [],
    };

    try {
      const arrests = await kvStore.getArrests();
      arrests.unshift(arrest);
      await kvStore.setArrests(arrests.slice(0, MAX_ARRESTS_DISIMPAN));
    } catch (err) {
      console.error("[arrest] gagal simpan ke database:", err.message);
      return res.status(500).json({ error: `Gagal menyimpan berkas: ${err.message}` });
    }

    await kirimKeDiscord(arrest, arrest.fotoKtp);
    return res.json({ ok: true, arrest });
  }

  // ====== PATCH & DELETE: khusus High Command ======
  if (req.method === "PATCH" || req.method === "DELETE") {
    if (!user.isHighCommand) return res.status(403).json({ error: "Cuma High Command yang bisa edit/hapus arrest record." });

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "ID arrest record wajib disertakan." });

    const arrests = await kvStore.getArrests();
    const idx = arrests.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: "Arrest record tidak ditemukan." });

    if (req.method === "DELETE") {
      arrests.splice(idx, 1);
      await kvStore.setArrests(arrests);
      return res.json({ ok: true });
    }

    // PATCH — HC boleh ubah field apa pun kecuali id/tanggal/dibuatOlehUserId
    const body = req.body || {};
    const editable = [
      "namaPetugas", "umurPetugas", "divisiPetugas", "pangkatPetugas",
      "namaTersangka", "umurTersangka", "ciriTersangka", "lokasi",
      "kronologi", "pasalDipilih", "totalDenda", "fotoKtp",
    ];
    editable.forEach((key) => {
      if (body[key] !== undefined) arrests[idx][key] = body[key];
    });
    await kvStore.setArrests(arrests);
    return res.json({ ok: true, arrest: arrests[idx] });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
