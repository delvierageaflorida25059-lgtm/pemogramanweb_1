'use strict';

/**
 * Verifikasi bahwa seluruh halaman frontend dan aset statis benar-benar
 * tersedia lewat HTTP, dan isinya tidak kosong.
 *
 * Ini belum menggantikan pengujian visual, tapi menangkap kesalahan yang
 * paling sering terjadi: path salah, file tidak ada, atau halaman kosong.
 *
 * Pemakaian: node tests/smoke-pages.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

/** Halaman yang harus bisa diakses publik. */
const PUBLIC_PAGES = [
  '/index.html',
  '/login.html',
  '/menu.html',
  '/cart.html',
  '/order.html',
];

/** Halaman yang butuh login - cukup pastikan file-nya ada dan punya <script>. */
const PROTECTED_PAGES = [
  '/cashier.html',
  '/kitchen.html',
  '/dashboard.html',
  '/admin-users.html',
  '/admin-menu.html',
  '/admin-tables.html',
  '/admin-orders.html',
  '/admin-payments.html',
];

/** Aset statis yang wajib ada. */
const STATIC_ASSETS = [
  '/css/style.css',
  '/js/api.js',
  '/js/ui.js',
  '/js/store.js',
  '/js/socket.js',
  '/js/qr.js',
  '/js/pwa.js',
  '/js/login.js',
  '/js/menu.js',
  '/js/cart.js',
  '/js/order.js',
  '/js/cashier.js',
  '/js/kitchen.js',
  '/js/dashboard.js',
  '/js/admin-users.js',
  '/js/admin-menu.js',
  '/js/admin-tables.js',
  '/js/admin-orders.js',
  '/js/admin-payments.js',
  '/js/index.js',
  '/manifest.json',
  '/sw.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/favicon.png',
];

async function fetchText(path) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.text();
  return { status: response.status, body, type: response.headers.get('content-type') };
}

test('semua halaman publik dapat diakses dan tidak kosong', async () => {
  for (const path of PUBLIC_PAGES) {
    const { status, body } = await fetchText(path);

    assert.equal(status, 200, `${path} harus merespons 200`);
    assert.ok(body.includes('<!DOCTYPE html>'), `${path} harus berupa dokumen HTML`);
    assert.ok(body.length > 200, `${path} mencurigakan terlalu pendek (${body.length} karakter)`);
    assert.ok(
      /<script\s+type="module"/.test(body),
      `${path} harus memuat script ES module`
    );
  }
});

test('halaman yang butuh login tetap tersedia sebagai berkas', async () => {
  for (const path of PROTECTED_PAGES) {
    const { status, body } = await fetchText(path);

    assert.equal(status, 200, `${path} harus merespons 200`);
    assert.ok(body.includes('<!DOCTYPE html>'), `${path} harus berupa dokumen HTML`);
    assert.ok(
      /<script\s+type="module"/.test(body),
      `${path} harus memuat script untuk logika halaman`
    );
  }
});

test('seluruh aset statis tersedia dan tidak kosong', async () => {
  for (const path of STATIC_ASSETS) {
    const response = await fetch(`${BASE}${path}`);

    assert.equal(response.status, 200, `${path} harus merespons 200`);

    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 0, `${path} tidak boleh kosong`);
  }
});

test('CSS memuat komponen utama yang dipakai semua halaman', async () => {
  const { status, body } = await fetchText('/css/style.css');

  assert.equal(status, 200);

  // Sebagian komponen yang wajib ada agar tampilan tidak rusak.
  for (const selector of ['.btn', '.card', '.table', '.badge', '.modal-backdrop', '.toast']) {
    assert.ok(body.includes(selector), `CSS harus memuat ${selector}`);
  }
});

test('manifest.json valid dan menunjuk ikon yang ada', async () => {
  const { status, body } = await fetchText('/manifest.json');
  assert.equal(status, 200);

  const manifest = JSON.parse(body);

  assert.ok(manifest.name, 'manifest wajib punya name');
  assert.ok(manifest.start_url, 'manifest wajib punya start_url');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'wajib punya ikon');
  assert.ok(manifest.display === 'standalone', 'PWA harus standalone');

  // Setiap ikon yang dirujuk harus benar-benar bisa diakses.
  for (const icon of manifest.icons) {
    const response = await fetch(`${BASE}${icon.src}`);
    assert.equal(response.status, 200, `ikon ${icon.src} harus tersedia`);
  }
});

test('service worker menolak cache untuk endpoint /api', async () => {
  const { status, body } = await fetchText('/sw.js');
  assert.equal(status, 200);

  // Ini guarantees penting: data pembayaran tidak boleh pernah di-cache.
  assert.ok(
    body.includes("url.pathname.startsWith('/api/')"),
    'service worker harus mengecualikan /api/ dari cache'
  );
});

test('library Socket.IO disajikan oleh server', async () => {
  const response = await fetch(`${BASE}/socket.io/socket.io.js`);
  assert.equal(response.status, 200);

  const body = await response.text();
  assert.ok(body.length > 1000, 'socket.io client harus terunduh utuh');
});

test('endpoint yang tidak dikenal membalas JSON 404', async () => {
  const response = await fetch(`${BASE}/api/tidak-ada-sama-sekali`);

  assert.equal(response.status, 404);

  const body = await response.json();
  assert.equal(body.success, false);
  assert.ok(body.message, 'harus ada pesan error');
});