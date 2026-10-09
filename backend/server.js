'use strict';

const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const config = require('./config/env');
const { createApp } = require('./app');
const socketConfig = require('./config/socket');
const { testConnection, closePool } = require('./config/database');
const token = require('./utils/token');
const userService = require('./services/user.service');

/**
 * Titik masuk server: membuka HTTP + Socket.IO dan menjalankan graceful
 * shutdown supaya koneksi database ditutup dengan rapi.
 */

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.security.corsOrigin,
    credentials: true,
  },
  path: '/socket.io',
});

socketConfig.init(io);

// ---------------------------------------------------------------------------
// Realtime: room dan otorisasi handshake
// ---------------------------------------------------------------------------

io.use(async (socket, next) => {
  try {
    const raw = socket.handshake.auth?.token || socket.handshake.query?.token;

    // Koneksi tanpa token tetap boleh masuk ke ruang publik (kitchen board
    // dan lacak pesanan tidak butuh login), tapi tanpa hak masuk room privat.
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

  // Room publik boleh dimasuki siapa saja.
  const PUBLIC_ROOMS = new Set([socketConfig.ROOMS.kitchen, socketConfig.ROOMS.dashboard]);
  for (const room of requestedList) {
    if (typeof room !== 'string') continue;
    if (PUBLIC_ROOMS.has(room) || user) {
      socket.join(room);
    }
  }

  if (user) {
    // Notifikasi pribadi.
    socket.join(`user:${user.id}`);

    // Meja hanya boleh diikuti oleh staff atau pemilik QR meja tersebut.
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

// ---------------------------------------------------------------------------
// Jalankan server
// ---------------------------------------------------------------------------

let shuttingDown = false;

/**
 * @param {number} [code]
 */
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nMematikan server...');

  io.close();
  await new Promise((resolve) => server.close(resolve));

  try {
    await closePool();
    console.log('Koneksi database ditutup.');
  } catch (error) {
    console.error('Gagal menutup koneksi database:', error.message);
  }

  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown(1);
});

async function start() {
  try {
    const info = await testConnection();
    console.log(`Database terhubung: ${info.db} (${info.version})`);
  } catch (error) {
    console.error('Gagal terhubung ke database:', error.message);
    console.error('Pastikan MySQL/MariaDB sudah berjalan dan isi .env dengan benar.');
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log('');
    console.log(`  ${config.appName}`);
    console.log(`  Server    : http://localhost:${config.port}`);
    console.log(`  API       : http://localhost:${config.port}/api`);
    console.log(`  Health    : http://localhost:${config.port}/health`);
    console.log(`  QR base   : ${config.publicBaseUrl}`);
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log('');
    console.log(`  Halaman   : /login.html  /menu.html  /cashier.html  /kitchen.html  /dashboard.html`);
    console.log('');
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, server, io, start, shutdown };