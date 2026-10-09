'use strict';

/**
 * Unit test untuk backend/utils/money.js.
 *
 * Modul ini menentukan seluruh angka uang yang tampil di struk dan laporan,
 * jadi diuji tanpa database: kalau logikanya salah, seluruh transaksi ikut salah.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const money = require('../../backend/utils/money');

// ---------------------------------------------------------------------------
// round
// ---------------------------------------------------------------------------

test('round membulatkan ke 2 desimal', () => {
  assert.equal(money.round(1.005), 1.01, '1.005 harus jadi 1.01, bukan 1');
  assert.equal(money.round(2.675), 2.68);
  assert.equal(money.round(1.004), 1);
  assert.equal(money.round(10 / 3), 3.33);
});

test('round menangani nilai tidak valid tanpa melempar error', () => {
  assert.equal(money.round(NaN), 0);
  assert.equal(money.round(undefined), 0);
  assert.equal(money.round(null), 0);
  assert.equal(money.round('bukan angka'), 0);
});

test('round menerima string dari MySQL DECIMAL', () => {
  assert.equal(money.round('32500.55'), 32500.55);
  assert.equal(money.round('0.10'), 0.1);
});

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------

test('toNumber mengubah input Diverse menjadi number', () => {
  assert.equal(money.toNumber('1000'), 1000);
  assert.equal(money.toNumber(1000), 1000);
  assert.equal(money.toNumber(null), 0);
  assert.equal(money.toNumber(undefined), 0);
  assert.equal(money.toNumber(''), 0);
  assert.equal(money.toNumber('abc'), 0);
  assert.equal(money.toNumber('abc', 99), 99, 'memakai nilai fallback');
});

// ---------------------------------------------------------------------------
// clampPercent
// ---------------------------------------------------------------------------

test('clampPercent membatasi nilai ke rentang 0-100', () => {
  assert.equal(money.clampPercent(-10), 0);
  assert.equal(money.clampPercent(150), 100);
  assert.equal(money.clampPercent(10), 10);
});

// ---------------------------------------------------------------------------
// calculateLineTotal
// ---------------------------------------------------------------------------

test('calculateLineTotal menghitung harga varian dan addon', () => {
  const result = money.calculateLineTotal({
    unitPrice: 32000,
    quantity: 2,
    addons: [{ price: 4000, quantity: 1 }],
  });

  assert.equal(result.addonTotal, 4000);
  assert.equal(result.lineTotal, (32000 + 4000) * 2);
});

test('calculateLineTotal enforces quantity minimum 1', () => {
  const result = money.calculateLineTotal({ unitPrice: 10000, quantity: 0 });
  assert.equal(result.quantity, 1);
  assert.equal(result.lineTotal, 10000);
});

test('calculateLineTotal tanpa addon', () => {
  const result = money.calculateLineTotal({ unitPrice: 25000, quantity: 3 });
  assert.equal(result.addonTotal, 0);
  assert.equal(result.lineTotal, 75000);
});

// ---------------------------------------------------------------------------
// calculateOrderTotals
// ---------------------------------------------------------------------------

test('calculateOrderTotals menjumlahkan seluruh line total', () => {
  const totals = money.calculateOrderTotals([
    { lineTotal: 30000 },
    { lineTotal: 45000.5 },
  ]);

  assert.equal(totals.subtotal, 75000.5);
  assert.equal(totals.total, 75000.5, 'tanpa pajak total sama dengan subtotal');
});

test('calculateOrderTotals menerapkan pajak dan service charge', () => {
  // Subtotal 100.000, diskon 0, pajak 10% = 10.000, service 5% = 5.000
  const totals = money.calculateOrderTotals(
    [{ lineTotal: 100000 }],
    { taxPercent: 10, serviceChargePercent: 5 }
  );

  assert.equal(totals.subtotal, 100000);
  assert.equal(totals.taxableBase, 100000);
  assert.equal(totals.taxAmount, 10000);
  assert.equal(totals.serviceChargeAmount, 5000);
  assert.equal(totals.total, 115000);
});

test('calculateOrderTotals: pajak dihitung dari subtotal setelah diskon', () => {
  // Diskon 10% dari 100.000 = 10.000, dasar pajak 90.000
  const totals = money.calculateOrderTotals(
    [{ lineTotal: 100000 }],
    { discountPercent: 10, taxPercent: 10, serviceChargePercent: 5 }
  );

  assert.equal(totals.discountAmount, 10000);
  assert.equal(totals.taxableBase, 90000);
  assert.equal(totals.taxAmount, 9000, 'pajak harus 10% dari 90.000');
  assert.equal(totals.serviceChargeAmount, 4500);
  assert.equal(totals.total, 103500);
});

test('calculateOrderTotals: diskon 100% menghasilkan total pajak nol', () => {
  const totals = money.calculateOrderTotals(
    [{ lineTotal: 50000 }],
    { discountPercent: 100, taxPercent: 10, serviceChargePercent: 5 }
  );

  assert.equal(totals.discountAmount, 50000);
  assert.equal(totals.taxableBase, 0);
  assert.equal(totals.taxAmount, 0);
  assert.equal(totals.serviceChargeAmount, 0);
  assert.equal(totals.total, 0);
});

test('calculateOrderTotals: diskon dibatasi tidak melebihi subtotal', () => {
  const totals = money.calculateOrderTotals([{ lineTotal: 1000 }], { discountPercent: 500 });

  assert.equal(totals.discountAmount, 1000, 'tidak boleh melebihi subtotal');
  assert.equal(totals.total, 0);
});

test('calculateOrderTotals: keranjang kosong menghasilkan nol', () => {
  const totals = money.calculateOrderTotals([], { taxPercent: 10 });

  assert.equal(totals.subtotal, 0);
  assert.equal(totals.total, 0);
});

test('calculateOrderTotals menerima input tidak valid', () => {
  const totals = money.calculateOrderTotals([{ lineTotal: 'abc' }, null, undefined]);

  assert.equal(totals.subtotal, 0);
  assert.equal(totals.total, 0);
});

// ---------------------------------------------------------------------------
// calculateChange
// ---------------------------------------------------------------------------

test('calculateChange menghitung kembalian tunai', () => {
  const result = money.calculateChange(37500, 50000);

  assert.equal(result.tendered, 50000);
  assert.equal(result.change, 12500);
  assert.equal(result.sufficient, true);
});

test('calculateChange menandai uang yang kurang', () => {
  const result = money.calculateChange(50000, 30000);

  assert.equal(result.change, -20000);
  assert.equal(result.sufficient, false);
});

test('calculateChange: uang pas tidak ada kembalian', () => {
  const result = money.calculateChange(50000, 50000);

  assert.equal(result.change, 0);
  assert.equal(result.sufficient, true);
});

// ---------------------------------------------------------------------------
// formatRupiah
// ---------------------------------------------------------------------------

test('formatRupiah memakai format ribuan Indonesia', () => {
  assert.equal(money.formatRupiah(32000), 'Rp 32.000');
  assert.equal(money.formatRupiah(1000000), 'Rp 1.000.000');
  assert.equal(money.formatRupiah(0), 'Rp 0');
});

test('formatRupiah menangani nilai negatif', () => {
  assert.equal(money.formatRupiah(-5000), '-Rp 5.000');
});