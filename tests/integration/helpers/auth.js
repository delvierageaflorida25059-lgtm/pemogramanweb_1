'use strict';

/**
 * Helper login untuk test integrasi.
 *
 * Token di-cache per akun. Alasannya dua:
 *
 * 1. Kecepatan. Menyusun ulang token JWT butuh bcrypt yang memang lambat.
 * 2. Rate limit. Endpoint login dibatasi 10 permintaan per menit per IP.
 *   Tanpa cache, dozens test akan saling menabrak dan mendapat HTTP 429.
 *
 * `resetLoginCache()` dipakai test yang perlu memaksa login ulang, misalnya
 * setelah mengganti password.
 */

/** credentials -> { token, user } */
const cache = new Map();

/**
 * Login dan kembalikan objek { token, user }.
 *
 * Bentuk ini dipakai test lama yang menulis `const { token } = await login(...)`.
 * Token di-cache supaya test berikutnya tidak perlu login ulang.
 *
 * @param {object} client
 * @param {{email:string, password:string}} credentials
 * @returns {Promise<{token:string, user:object}>}
 */
async function login(client, credentials) {
  const key = credentials.email;

  if (cache.has(key)) {
    return cache.get(key);
  }

  const result = await client.post('/auth/login', credentials);

  if (result.status !== 200) {
    throw new Error(
      `Login ${credentials.email} gagal (HTTP ${result.status}): ${result.body?.message ?? 'tidak diketahui'}`
    );
  }

  const entry = { token: result.body.data.accessToken, user: result.body.data.user };
  cache.set(key, entry);
  return entry;
}

/** Login paksa, mengabaikan cache. Mengembalikan objek yang sama. */
async function loginFresh(client, credentials) {
  const result = await client.post('/auth/login', credentials);
  if (result.status !== 200) {
    throw new Error(
      `Login ${credentials.email} gagal (HTTP ${result.status}): ${result.body?.message ?? 'tidak diketahui'}`
    );
  }
  const entry = { token: result.body.data.accessToken, user: result.body.data.user };
  cache.set(credentials.email, entry);
  return entry;
}

/** Menghapus cache, misalnya setelah password diubah. */
function resetLoginCache(email = null) {
  if (email) cache.delete(email);
  else cache.clear();
}

module.exports = { login, loginFresh, resetLoginCache };