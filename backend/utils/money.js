'use strict';

/**
 * Utilitas perhitungan uang.
 *
 * Semua perhitungan total order melewati modul ini supaya aturannya konsisten
 * dan bisa diuji secara terpisah dari database.
 *
 * Aturan pembulatan:
 *   - subtotal setiap item dibulatkan ke 2 desimal
 *   - diskon, pajak, dan service charge dihitung dari subtotal, lalu
 *     dibulatkan ke 2 desimal dengan pembulatan setengah ke atas
 */

/**
 * Bulatkan ke jumlah desimal tertentu, setengah ke atas.
 *
 * Catatan: naive `Math.round(value * 100) / 100` tidak bisa diandalkan untuk
 * uang. Contoh (1.005 * 100) menyimpan 100.49999999999999 sehingga hasilnya
 * 1 bukan 1.01. Menambah EPSILON * faktor sebelum Math.round menutup celah
 * representasi floating point tersebut.
 *
 * @param {number|string} value
 * @param {number} [decimals=2]
 * @returns {number}
 */
function round(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;

  const factor = 10 ** decimals;
  const nudge = number >= 0 ? Number.EPSILON * factor : -Number.EPSILON * factor;
  return Math.round(number * factor + nudge) / factor;
}

/**
 * Ubah input apa pun menjadi number yang aman untuk perhitungan.
 * String hasil query MySQL (DECIMAL) dan input form tetap bisa diterima.
 *
 * @param {any} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Pastikan nilai persen berada pada rentang 0-100.
 * @param {number} value
 * @returns {number}
 */
function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return round(Math.min(100, Math.max(0, value)));
}

/**
 * Hitung total satu baris order item.
 * unitPrice sudah mencakup harga varian; harga addon dijumlahkan terpisah
 * karena addon selalu ikut dikalikan quantity produk.
 *
 * @param {{unitPrice:any, quantity:any, addons?:Array<{price:any,quantity:any}>}} item
 * @returns {{unitPrice:number, addonTotal:number, quantity:number, lineTotal:number}}
 */
function calculateLineTotal(item) {
  const quantity = Math.max(1, Math.trunc(toNumber(item.quantity, 1)));
  const unitPrice = round(toNumber(item.unitPrice));
  const addons = Array.isArray(item.addons) ? item.addons : [];

  const addonTotal = round(
    addons.reduce((sum, addon) => {
      const addonQty = Math.max(1, Math.trunc(toNumber(addon.quantity, 1)));
      return sum + toNumber(addon.price) * addonQty;
    }, 0)
  );

  return {
    unitPrice,
    addonTotal,
    quantity,
    lineTotal: round((unitPrice + addonTotal) * quantity),
  };
}

/**
 * Hitung grand total order.
 *
 * Urutan perhitungan (penting untuk konsistensi ringkasan kas):
 *   1. subtotal        = jumlah seluruh line total
 *   2. diskon          = subtotal x discountPercent / 100, maksimal sebesar subtotal
 *   3. dasar pajak     = subtotal - diskon
 *   4. pajak           = dasar pajak x taxPercent / 100
 *   5. service charge  = dasar pajak x serviceChargePercent / 100
 *   6. total           = dasar pajak + pajak + service charge
 *
 * @param {Array<object>} items baris order item
 * @param {object} [options]
 * @param {number} [options.discountPercent=0]
 * @param {number} [options.taxPercent=0]
 * @param {number} [options.serviceChargePercent=0]
 */
function calculateOrderTotals(items, options = {}) {
  // toNumber sudah menangani nilai null/undefined/NaN, jadi baris yang tidak
  // valid ikut diabaikan alih-alih membuat fungsi melempar error.
  const subtotal = round(
    (Array.isArray(items) ? items : []).reduce(
      (sum, item) => sum + toNumber(item?.lineTotal),
      0
    )
  );

  const discountPercent = clampPercent(toNumber(options.discountPercent, 0));
  const taxPercent = clampPercent(toNumber(options.taxPercent, 0));
  const serviceChargePercent = clampPercent(toNumber(options.serviceChargePercent, 0));

  const discountAmount = Math.min(round((subtotal * discountPercent) / 100), subtotal);
  const taxableBase = round(subtotal - discountAmount);
  const taxAmount = round((taxableBase * taxPercent) / 100);
  const serviceChargeAmount = round((taxableBase * serviceChargePercent) / 100);
  const total = round(taxableBase + taxAmount + serviceChargeAmount);

  return {
    subtotal,
    discountPercent,
    discountAmount,
    taxableBase,
    taxPercent,
    taxAmount,
    serviceChargePercent,
    serviceChargeAmount,
    total,
  };
}

/**
 * Hitung kembalian untuk pembayaran tunai.
 * Mengembalikan nilai negatif bila uang yang diserahkan kurang.
 *
 * @param {number} total  total tagihan
 * @param {number} tender jumlah uang yang diserahkan pelanggan
 * @returns {{tendered:number, change:number, sufficient:boolean}}
 */
function calculateChange(total, tender) {
  const totalNumber = round(toNumber(total));
  const tendered = round(toNumber(tender));
  const change = round(tendered - totalNumber);
  return { tendered, change, sufficient: change >= 0 };
}

/**
 * Format angka menjadi Rupiah untuk ditampilkan di terminal/log.
 *
 * @param {number} value
 * @returns {string}
 */
function formatRupiah(value) {
  const number = Math.round(toNumber(value));
  const sign = number < 0 ? '-' : '';
  return `${sign}Rp ${Math.abs(number).toLocaleString('id-ID')}`;
}

module.exports = {
  round,
  toNumber,
  clampPercent,
  calculateLineTotal,
  calculateOrderTotals,
  calculateChange,
  formatRupiah,
};