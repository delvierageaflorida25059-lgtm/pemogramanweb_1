/**
 * Client HTTP untuk seluruh panggilan REST API.
 *
 * Tanggung jawab modul ini:
 *   - menyisipkan header Authorization secara otomatis
 *   - membuka JSON dan melempar ApiClientError yang konsisten
 *   - mencoba refresh token sekali saat access token kedaluwarsa
 *
 * Modul ini TIDAK melakukan redirect ke login supaya halaman bisa
 * menentukan sendiri apa yang harus ditampilkan.
 */

const BASE_URL = '/api';

/** Kunci penyimpanan token di localStorage. */
const STORAGE_KEYS = {
  accessToken: 'sr_access_token',
  refreshToken: 'sr_refresh_token',
  user: 'sr_user',
};

export class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'ERROR', errors = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Penyimpanan token
// ---------------------------------------------------------------------------

export const tokenStore = {
  get accessToken() {
    return localStorage.getItem(STORAGE_KEYS.accessToken);
  },
  get refreshToken() {
    return localStorage.getItem(STORAGE_KEYS.refreshToken);
  },
  get user() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.user);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
    if (refreshToken) localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
    if (user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.user);
  },
};

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

let refreshPromise = null;

/**
 * Menukar refresh token dengan access token baru.
 * Satu Promise dipakai bersama supaya beberapa request yang gagal bersamaan
 * tidak saling berebut refresh token (refresh token dirotasi server, jadi
 * dua refresh bersamaan akan membuat satu TOKEN gagal).
 */
async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  const refreshToken = tokenStore.refreshToken;
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        tokenStore.clear();
        return null;
      }

      const body = await response.json();
      tokenStore.save({
        accessToken: body.data.accessToken,
        refreshToken: body.data.refreshToken,
        user: body.data.user,
      });
      return body.data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * @param {string} path       contoh "/products?page=1"
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.body]
 * @param {boolean} [options.auth=true]   false untuk endpoint publik
 * @param {boolean} [options._isRetry]    penanda internal
 * @returns {Promise<any>} always return body.data
 */
export async function request(path, options = {}) {
  const {
    method = 'GET',
    body = null,
    auth = true,
    _isRetry = false,
  } = options;

  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';

  if (auth && tokenStore.accessToken) {
    headers.Authorization = `Bearer ${tokenStore.accessToken}`;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(
      'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
      { code: 'NETWORK_ERROR' }
    );
  }

  // 401 dengan kode TOKEN_EXPIRED dicoba diperbaiki sekali lewat refresh.
  if (response.status === 401 && auth && !_isRetry) {
    let payload = null;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }

    if (payload?.code === 'TOKEN_EXPIRED') {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return request(path, { ...options, _isRetry: true });
      }
      tokenStore.clear();
    }
  }

  // 204 tidak punya body.
  if (response.status === 204) return null;

  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new ApiClientError(
      parsed?.message || `Permintaan gagal (HTTP ${response.status}).`,
      {
        status: response.status,
        code: parsed?.code || 'ERROR',
        errors: parsed?.errors || null,
      }
    );
  }

  return parsed?.data ?? null;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Helper URL
// ---------------------------------------------------------------------------

/**
 * Rakit query string dari objek. Nilai null/undefined dilewati.
 * @param {Record<string, any>} params
 * @returns {string} contoh "?page=1&limit=20"
 */
export function withQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.append(key, value);
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/** Ekstrak pesan error per-field dari ApiClientError untuk ditampilkan di form. */
export function fieldErrors(error) {
  return error?.errors && typeof error.errors === 'object' ? error.errors : null;
}