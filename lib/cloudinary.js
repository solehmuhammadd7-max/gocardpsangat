// Upload 1 foto (data URL base64 dari browser) ke Cloudinary, balikin URL
// publiknya. Cloudinary punya free tier yang gak minta kartu kredit sama
// sekali — dipakai bareng-bareng sama fitur Laporan Absensi (api/absensi.js)
// dan fitur Iklan (api/admin/rekap.js) biar nggak duplikat kode.

async function uploadFotoKeCloudinary(dataUrl, publicIdPrefix) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) {
    throw new Error("CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET belum di-set.");
  }
  const form = new URLSearchParams();
  form.append("file", dataUrl); // Cloudinary terima data URL base64 langsung
  form.append("upload_preset", uploadPreset);
  form.append("public_id", publicIdPrefix);

  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const json = await resp.json();
  if (!resp.ok || !json.secure_url) {
    throw new Error(json?.error?.message || "Upload ke Cloudinary gagal.");
  }
  return json.secure_url;
}

module.exports = { uploadFotoKeCloudinary };
