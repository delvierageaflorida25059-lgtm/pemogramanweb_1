'use strict';

/**
 * Helper untuk menyalakan server selama test integrasi.
 *
 * TUJUAN
 * Test integrasi tidak bergantung pada server yang dijalankan manual oleh
 * pengguna. Test memanggil startTestServer(), memakai server itu, lalu
 * menutupnya sendiri. Dengan begitu `npm run test:e2e` bisa dijalankan kapan
 * saja tanpa langkah tambahan.
 *
 * Bila ada server yang sudah berjalan di E2E_BASE_URL, helper memakainya dan
 * TIDAK menyalakan server baru. Ini memudahkan test berjalan melawan server
 * yang sedang dipakai untuk debugging manual.
 *
 * CATATAN
 * Database tetap harus berjalan. Test tidak menyalakan MySQL karena itu
 * urusan mesin, bukan urusan kode.
 */


const DEFAULT_BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

/** @returns {Promise<boolean>} true bila ada server yang merespons */
async function isServerReachable(baseUrl, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Menyediakan baseUrl yang bisa dipakai test, lengkap dengan fungsi cleanup.
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @returns {Promise<{baseUrl:string, close:() => Promise<void>, owned:boolean}>}
 */
async function startTestServer(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE;

  // Pakai server yang sudah ada kalau ada.
  if (await isServerReachable(baseUrl)) {
    return { baseUrl, close: async () => {}, owned: false };
  }

  // Batas login dinaikkan khusus untuk server milik test.
  //
  // Alasan: config/env.js membaca process.env saat pertama kali di-require.
  // Karena itu nilai harus dipasang SEBELUM app di-require, kalau tidak
  // perubahan ini tidak berlaku. Rate limit tetap diuji secara terpisah lewat
  // test regresi yang menjalankan server dengan batas bawaan.
  process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000';
  process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';

  // Memakai bootstrap yang sama dengan server produksi, termasuk Socket.IO.
  // Kalau test memakai setup sendiri, pengujian Socket.IO jadi tidak bermakna.
  const { createServer, closeServer } = require('../../../backend/bootstrap');

  const instance = createServer();
  const { server, io } = instance;

  // Port 0 berarti OS memilih port bebas, sehingga test tidak bertabrakan
  // dengan server yang mungkin sedang berjalan di port 3000.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const actualBase = `http://127.0.0.1:${port}`;

  // Beri waktu socket siap sebelum test mulai menembak.
  await waitFor(actualBase);

  const close = async () => {
    await closeServer(instance).catch(() => {});
  };

  return { baseUrl: actualBase, close, owned: true, io };
}

/** @returns {Promise<boolean>} */
async function waitFor(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isServerReachable(baseUrl, 1000)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Server di ${baseUrl} tidak merespons dalam ${timeoutMs} ms.`);
}

/**
 * Bangun ulang objek helper `call/get/post/put/patch/del` yang terikat ke
 * sebuah baseUrl, supaya test tidak perlu menyusun URL sendiri.
 *
 * @param {string} baseUrl
 */
function createClient(baseUrl) {
  const API = `${baseUrl}/api`;

  async function call(method, path, { token, body } = {}) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    return { status: response.status, body: parsed, ok: response.ok };
  }

  return {
    call,
    get: (path, token) => call('GET', path, { token }),
    post: (path, body, token) => call('POST', path, { token, body }),
    put: (path, body, token) => call('PUT', path, { token, body }),
    patch: (path, body, token) => call('PATCH', path, { token, body }),
    delete: (path, token) => call('DELETE', path, { token }),
  };
}

module.exports = { startTestServer, createClient, isServerReachable, waitFor };