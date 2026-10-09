'use strict';

const QRCode = require('qrcode');

/**
 * Pembuat gambar QR Code.
 *
 * Decision: QR digenerate di SERVER memakai pustaka `qrcode`, bukan ditulis
 * sendiri di frontend. Alasannya:
 *   - algoritma QR (Reed-Solomon, masking, penempatan pola) mudah salah;
 *     QR yang cacat tapi "terlihat seperti QR" tidak akan bisa dipindai dan
 *     gejalanya baru terlihat saat pelanggan memblack ke kasir
 *   - dengan di-render di server, QR bisa diuji otomatis di backend
 *   - frontend cukup menampilkan <img>, jadi tidak perlu salin pustaka ke klien
 *
 * Yang di-encode hanya URL ber-token. QR TIDAK pernah memuat harga atau data
 * menu, sehingga perubahan harga tidak membuat QR lama jadi kadaluarsa.
 */

/** @param {string} url */
function buildUrl(tableCode, token) {
  const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/menu.html?token=${token}`;
}

/**
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.width=320]
 * @param {'png'|'svg'} [options.type='png']
 * @returns {Promise<Buffer|string>}
 */
async function toBuffer(url, options = {}) {
  const { width = 320, type = 'png' } = options;

  return QRCode.toBuffer(url, {
    type,
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    // Version otomatis dipilih oleh pustaka, tidak perlu dibatasi manual.
  });
}

/**
 * Render SVG, berguna untuk dicetak pada kertas ukuran tinggi.
 * @param {string} url
 */
async function toSvg(url, options = {}) {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
    ...options,
  });
}

/**
 * Buat QR untuk satu meja.
 * @param {{tableCode:string, tableName:string, token:string}} table
 */
function forTable(table) {
  return {
    tableCode: table.tableCode,
    tableName: table.tableName,
    token: table.token,
    url: buildUrl(table.tableCode, table.token),
    // Nama file saat diunduh dari halaman admin.
    filename: `qr-meja-${table.tableCode}`.toLowerCase().replace(/\s+/g, '-') + '.png',
  };
}

module.exports = { toBuffer, toSvg, forTable, buildUrl };