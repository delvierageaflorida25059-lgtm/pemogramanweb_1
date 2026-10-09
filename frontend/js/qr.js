/**
 * Helper QR Code di sisi klien.
 *
 * QR digenerate di backend (backend/services/qr.service.js) memakai pustaka
 * `qrcode`. Frontend hanya menampilkan hasilnya sebagai <img>. Tidak ada
 * algoritma QR yang ditulis ulang di sisi klien.
 */

/**
 * URL gambar PNG QR untuk sebuah meja.
 * Memakai endpoint backend yang sudah diautentikasi.
 *
 * @param {number} tableId
 * @param {number} [width=320]
 */
export function qrImageUrl(tableId, width = 320) {
  return `/api/tables/${encodeURIComponent(tableId)}/qr.png?width=${width}`;
}

/**
 * Buat elemen <img> QR lengkap dengan tautan unduh dan judul.
 *
 * @param {object} table
 * @param {number} table.id
 * @param {string} table.code
 * @param {string} table.name
 * @param {number} [width=240]
 * @returns {HTMLElement}
 */
export function createQrCard(table, width = 240) {
  const wrapper = document.createElement('div');
  wrapper.className = 'qr-card';

  const image = document.createElement('img');
  image.className = 'qr-card__image';
  image.src = qrImageUrl(table.id, width);
  image.alt = `QR code meja ${table.code}`;
  image.width = width;
  image.height = width;

  const caption = document.createElement('p');
  caption.className = 'qr-card__label';
  caption.textContent = `Meja ${table.code}`;

  const downloadLink = document.createElement('a');
  downloadLink.className = 'btn btn--outline btn--small';
  downloadLink.href = qrImageUrl(table.id, 640);
  // Unduh lewat link biasa; Aturan same-origin mengizinkan unduh <img> ini.
  downloadLink.download = `qr-meja-${table.code.toLowerCase()}.png`;
  downloadLink.textContent = 'Unduh PNG';

  wrapper.append(image, caption, downloadLink);
  return wrapper;
}

/**
 * Ambil daftar QR aktif (JSON) untuk halaman admin.
 * Panggil setelah halaman selesai mount supaya request berjalan paralel.
 *
 * @returns {Promise<Array<{tableId:number,tableCode:string,tableName:string,url:string}>>}
 */
export async function fetchActiveQr(accessToken) {
  const response = await fetch('/api/tables/qr/list', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Gagal memuat daftar QR.');
  }

  const body = await response.json();
  return body.data || [];
}