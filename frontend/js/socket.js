/**
 * Client Socket.IO untuk realtime.
 *
 * Library socket.io.js disajikan otomatis oleh server di /socket.io/socket.io.js,
 * jadi tidak perlu diimpor lewat bundler.
 */

import { tokenStore } from './api.js';

let socket = null;
let manualDisconnect = false;

const ROOMS = {
  kitchen: 'kitchen',
  dashboard: 'dashboard',
  order: (id) => `order:${id}`,
  table: (code) => `table:${code}`,
};

/**
 * Hubungkan ke server Socket.IO.
 *
 * @param {object} [options]
 * @param {string[]} [options.rooms]     ruang yang mau diikuti
 * @param {string}   [options.tableCode] meja yang sedang dibuka (untuk tamu QR)
 * @returns {object|null} socket
 */
export function connect(options = {}) {
  const { rooms = [], tableCode = null } = options;

  if (typeof io === 'undefined') {
    console.warn('[socket] library socket.io.js belum termuat.');
    return null;
  }

  if (socket && socket.connected) {
    if (rooms.length > 0) socket.emit('rooms:join', rooms);
    return socket;
  }

  manualDisconnect = false;

  socket = io({
    path: '/socket.io',
    auth: {
      token: tokenStore.accessToken,
      rooms,
      tableCode,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: 20,
  });

  socket.on('connect', () => {
    document.body?.classList.add('socket-connected');
    socket.emit('rooms:join', rooms);
  });

  socket.on('disconnect', () => {
    document.body?.classList.remove('socket-connected');
  });

  socket.on('connect_error', (error) => {
    // Socket.IO memakai polling sebagai cadangan, jadi error koneksi tidak
    // perlu ditunjukkan ke user. Cukup dicatat di console.
    console.warn('[socket] gagal terhubung:', error.message);
  });

  return socket;
}

/** Tutup koneksi socket. */
export function disconnect() {
  manualDisconnect = true;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/** @returns {object|null} */
export function getSocket() {
  return socket;
}

/** @returns {boolean} */
export function isConnected() {
  return Boolean(socket && socket.connected);
}

/**
 * Daftarkan handler event.
 *
 * @param {string} event
 * @param {Function} handler
 * @param {object} [target=socket]
 */
export function on(event, handler, target = socket) {
  if (!target) return () => {};
  target.on(event, handler);
  return () => target.off(event, handler);
}

/**
 * Berhenti modalités saat tab tidak terlihat supaya halaman tidak wasting
 * resource saat ditinggalkan.
 */
export function pauseWhenHidden() {
  document.addEventListener('visibilitychange', () => {
    if (!socket || manualDisconnect) return;
    if (document.hidden) {
      socket.disconnect();
    } else {
      socket.connect();
    }
  });
}

export const socketRooms = ROOMS;
