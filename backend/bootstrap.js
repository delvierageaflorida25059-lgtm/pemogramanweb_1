'use strict';

/**
 * Bootstrap server HTTP + Socket.IO.
 *
 * Dipisahkan dari server.js supaya unit dan integration test bisa menjalankan
 * server yang PERSIS sama dengan produksi, termasuk realtime Socket.IO.
 *
 * Kalau bootstrap ditulis dua kali (satu di server.js, satu di test), cepat
 * atau lambat keduanya akan berbeda - dan test jadi tidak berguna.
 */

const http = require('node:http');
const { Server } = require('socket.io');

const { createApp } = require('./app');
const config = require('./config/env');
const socketConfig = require('./config/socket');
const token = require('./utils/token');
const userService = require('./services/user.service');

/**
 * Membangun seluruh stack aplikasi.
 *
 * @param {object} [options]
 * @param {boolean} [options.withSocket=true]  pasang Socket.IO atau tidak
 * @param {string}  [options.clientPath='/socket.io']
 * @returns {{app:import('express').Express, server:http.Server, io:import('socket.io').Server|null}}
 */
function createServer(options = {}) {
  const { withSocket = true, clientPath = '/socket.io' } = options;

  const app = createApp();
  const server = http.createServer(app);

  if (!withSocket) {
    return { app, server, io: null };
  }

  const io = new Server(server, {
    cors: {
      origin: config.security.corsOrigin,
      credentials: true,
    },
    path: clientPath,
  });

  socketConfig.init(io);
  attachSocketHandlers(io);

  return { app, server, io };
}

/**
 * Otorisasi handshake dan junction ke ruang (room).
 * @param {import('socket.io').Server} io
 */
function attachSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.query?.token;

      // Koneksi tanpa token tetap boleh masuk ke ruang publik, tapi tanpa hak
      // masuk room privat.
      if (!raw) {
        socket.data.user = null;
        return next();
      }

      const payload = token.verifyAccessToken(String(raw));
      const user = await userService.findAuthUserById(payload.sub);

      if (!user || user.status !== 'ACTIVE') {
        socket.data.user = null;
        return next();
      }

      socket.data.user = {
        id: user.id,
        name: user.name,
        roles: user.roles,
        permissions: user.permissions,
      };
      return next();
    } catch {
      socket.data.user = null;
      return next();
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const requested = socket.handshake.auth?.rooms;
    const requestedList = Array.isArray(requested) ? requested : [];

    // Ruang publik boleh dimasuki siapa saja.
    const PUBLIC_ROOMS = new Set([socketConfig.ROOMS.kitchen, socketConfig.ROOMS.dashboard]);
    for (const room of requestedList) {
      if (typeof room !== 'string') continue;
      if (PUBLIC_ROOMS.has(room) || user) socket.join(room);
    }

    if (user) {
      socket.join(`user:${user.id}`);

      const tableCode = socket.handshake.auth?.tableCode;
      if (typeof tableCode === 'string' && tableCode) {
        socket.data.tableCode = tableCode;
        socket.join(socketConfig.ROOMS.table(tableCode));
      }
    }

    socket.emit('connection:ready', {
      authenticated: Boolean(user),
      user: user ? { id: user.id, name: user.name, roles: user.roles } : null,
    });

    socket.on('rooms:join', (rooms) => {
      if (!Array.isArray(rooms)) return;
      for (const room of rooms) {
        if (typeof room !== 'string') continue;
        if (PUBLIC_ROOMS.has(room) || user) socket.join(room);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${socket.id} terputus: ${reason}`);
    });

    if (user) {
      console.log(`[socket] ${user.name} (${user.roles.join(', ')}) terhubung.`);
    } else {
      console.log(`[socket] ${socket.id} terhubung sebagai tamu.`);
    }
  });
}

/**
 * Menutup server, Socket.IO, dan connection pool database dengan rapi.
 *
 * @param {{server:http.Server, io:import('socket.io').Server|null}} instance
 * @param {object} [options]
 * @param {boolean} [options.closePool=true]
 */
async function closeServer(instance, options = {}) {
  const { closePool = true } = options;

  if (instance.io) {
    await new Promise((resolve) => instance.io.close(resolve));
  }
  await new Promise((resolve) => instance.server.close(resolve));

  if (closePool) {
    const { closePool: closeDbPool } = require('./config/database');
    await closeDbPool().catch(() => {});
  }
}

module.exports = { createServer, attachSocketHandlers, closeServer };