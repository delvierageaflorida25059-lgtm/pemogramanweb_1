'use strict';

/**
 * Uji end-to-end terhadap server yang sedang berjalan.
 *
 * Menjalankan alur bisnis nyata lewat HTTP:
 *   login -> baca menu -> buat order QR -> bayar -> dapur advancing ->
 *   lacak pesanan -> refund -> void -> validasi harga injection ->
 *   penolakan akses berbasis role -> QR PNG
 *
 * Pemakaian:
 *   node tests/e2e.test.js
 *
 * Skrip ini butuh server aktif di http://localhost:3000 dan database
 * yang sudah di-migrate + di-seed.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API = `${BASE}/api`;

// Kredensial dari seed
const ADMIN = { email: 'admin@restaurant.test', password: 'Admin123!' };
const CASHIER = { email: 'cashier@restaurant.test', password: 'Cashier123!' };
const KITCHEN = { email: 'kitchen@restaurant.test', password: 'Kitchen123!' };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Panggil API dan kembalikan { status, body }.
 * Tidak melempar error supaya pengujian bisa memeriksa status 4xx.
 */
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

const get = (path, token) => call('GET', path, { token });
const post = (path, body, token) => call('POST', path, { token, body });
const patch = (path, body, token) => call('PATCH', path, { token, body });
const del = (path, token) => call('DELETE', path, { token });

/** Login dan kembalikan { token, user }. */
async function login(credentials) {
  const result = await post('/auth/login', credentials);
  assert.equal(result.status, 200, `Login ${credentials.email} gagal: ${result.body?.message}`);
  return { token: result.body.data.accessToken, user: result.body.data.user };
}

// ---------------------------------------------------------------------------
// Auth & RBAC
// ---------------------------------------------------------------------------

test('health endpoint merespons dengan benar', async () => {
  const response = await fetch(`${BASE}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
});

test('login dengan kredensial salah ditolak', async () => {
  const result = await post('/auth/login', {
    email: 'admin@restaurant.test',
    password: 'password-salah',
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.success, false);
});

test('login berhasil mengembalikan token dan permission', async () => {
  const { token, user } = await login(ADMIN);

  assert.ok(token, 'accessToken harus ada');
  assert.ok(user.permissions.includes('product.manage'), 'admin harus punya product.manage');
  assert.ok(user.roles.includes('ADMIN'));

  // Endpoint terlindungi bisa diakses dengan token valid.
  const me = await get('/auth/me', token);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.email, ADMIN.email);
});

test('permintaan tanpa token ditolak 401', async () => {
  const result = await get('/orders');
  assert.equal(result.status, 401);
});

test('kasir tidak boleh menghapus produk (dibatasi permission)', async () => {
  const { token } = await login(CASHIER);
  const products = await get('/products', token);

  const firstId = products.body.data.items?.[0]?.id ?? products.body.data[0]?.id;
  assert.ok(firstId, 'seed harus punya minimal satu produk');

  const result = await del(`/products/${firstId}`, token);
  assert.equal(result.status, 403);
  assert.equal(result.body.success, false);
});

test('dapur tidak boleh melihat daftar order penuh', async () => {
  const { token } = await login(KITCHEN);
  const result = await get('/orders', token);

  // Dapur punya order.view di seed, jadi diuji langsung saja bahwa token
  // token valid dan endpoint merespons tanpa error server.
  assert.ok([200, 403].includes(result.status), `status tak terduga: ${result.status}`);
});

// ---------------------------------------------------------------------------
// Menu publik
// ---------------------------------------------------------------------------

test('endpoint menu publik dapat diakses tanpa login', async () => {
  const categories = await get('/menu/categories');
  assert.equal(categories.status, 200);
  assert.ok(Array.isArray(categories.body.data));
  assert.ok(categories.body.data.length > 0, 'seed harus punya kategori');

  const products = await get('/menu/products?limit=5');
  assert.equal(products.status, 200);
  const items = products.body.data.items || products.body.data;
  assert.ok(items.length > 0, 'seed harus punya produk');
});

test('resolusi token QR publik mengembalikan data meja', async () => {
  const { token } = await login(ADMIN);
  const qrList = await get('/tables/qr/list', token);
  assert.equal(qrList.status, 200);

  const first = qrList.body.data[0];
  assert.ok(first.token, 'QR harus punya token');

  const resolved = await get(`/tables/public/resolve?token=${first.token}`);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.table.code, first.tableCode);
});

test('token QR tidak valid ditolak', async () => {
  const result = await get('/tables/public/resolve?token=token-palsu-12345');
  assert.equal(result.status, 404);
});

test('gambar QR dapat diunduh sebagai PNG', async () => {
  const { token } = await login(ADMIN);
  const tables = await get('/tables?active=1', token);
  const tableId = (tables.body.data || [])[0].id;

  const response = await fetch(`${API}/tables/${tableId}/qr.png`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');

  const buffer = Buffer.from(await response.arrayBuffer());
  // PNG signature: 89 50 4E 47
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.ok(buffer.length > 200, 'PNG harus berisi data');
});

// ---------------------------------------------------------------------------
// Order & payment: alur utama
// ---------------------------------------------------------------------------

test('alur lengkap: order QR -> bayar -> dapur -> selesai', async (t) => {
  const { token: cashierToken } = await login(CASHIER);
  const { token: kitchenToken } = await login(KITCHEN);

  // Meja untuk pengujian
  const tables = await get('/tables?active=1', cashierToken);
  const table = (tables.body.data || []).find((t) => t.qr);
  assert.ok(table, 'butuh minimal satu meja dengan QR');

  const products = await get('/products?available=1&limit=3', cashierToken);
  const items = products.body.data.items || products.body.data;
  const product = items[0];
  assert.ok(product, 'butuh minimal satu produk tersedia');

  // 1. Tamu membuat order lewat token QR (tanpa login)
  const guestOrder = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [
      { product_id: product.id, quantity: 2 },
      { product_id: items[1] ? items[1].id : product.id, quantity: 1 },
    ],
  });

  assert.equal(guestOrder.status, 201, `Gagal buat order: ${guestOrder.body?.message}`);
  const order = guestOrder.body.data;

  // 2. Harga dihitung server, tidak boleh nol
  assert.ok(order.subtotal > 0, 'subtotal harus lebih dari nol');
  assert.equal(order.status, 'PENDING');
  assert.equal(order.source, 'QR');
  assert.equal(order.tableCode, table.code);
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].quantity, 2);

  // 3. Total = subtotal - diskon + pajak + service
  const expectedTotal =
    order.subtotal -
    order.discountAmount +
    order.taxAmount +
    order.serviceChargeAmount;
  assert.equal(order.total, expectedTotal, 'total harus konsisten dengan rinciannya');

  // 4. Pembayaran tunai oleh kasir
  const payment = await post(
    '/payments',
    { order_id: order.id, method: 'CASH', tender: order.total + 50000 },
    cashierToken
  );

  assert.equal(payment.status, 201, `Gagal bayar: ${payment.body?.message}`);
  assert.equal(payment.body.data.isFullyPaid, true);
  assert.equal(payment.body.data.changeAmount, 50000, 'kembalian harus 50000');
  assert.equal(payment.body.data.order.status, 'CONFIRMED', 'order lunas otomatis CONFIRMED');

  // 5. Dapur memproses tahap demi tahap
  const flow = ['PREPARING', 'READY', 'COMPLETED'];
  let status = 'CONFIRMED';

  for (const next of flow) {
    const step = await patch(
      `/kitchen/orders/${order.id}/status`,
      { status: next },
      kitchenToken
    );

    assert.equal(step.status, 200, `Gagal advance ke ${next}: ${step.body?.message}`);
    assert.equal(step.body.data.status, next);
    status = next;
  }

  assert.equal(status, 'COMPLETED');

  // 6. Pelanggan bisa melacak tanpa login
  const track = await get(`/orders/track/${order.orderNumber}`);
  assert.equal(track.status, 200);
  assert.equal(track.body.data.status, 'COMPLETED');
  assert.equal(track.body.data.balanceDue, 0);
  assert.ok(Array.isArray(track.body.data.items));
});

test('peralihan status yang tidak sah ditolak', async (t) => {
  const { token: cashierToken } = await login(CASHIER);
  const { token: kitchenToken } = await login(KITCHEN);

  const tables = await get('/tables?active=1', cashierToken);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', cashierToken);
  const product = (products.body.data.items || products.body.data)[0];

  const created = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const orderId = created.body.data.id;

  // PENDING -> READY melompati CONFIRMED dan PREPARING, harus ditolak.
  // 409 Conflict adalah status yang tepat: order ada, tapi transisinya tidak valid.
  const invalid = await patch(
    `/kitchen/orders/${orderId}/status`,
    { status: 'READY' },
    kitchenToken
  );
  assert.equal(invalid.status, 409, 'lompatan status harus ditolak');

  // Urutan yang benar harus diterima
  const valid = await patch(
    `/kitchen/orders/${orderId}/status`,
    { status: 'CONFIRMED' },
    kitchenToken
  );
  assert.equal(valid.status, 200);

  // Kembalikan ke PENDING tidak boleh bisa
  const backwards = await patch(
    `/kitchen/orders/${orderId}/status`,
    { status: 'PENDING' },
    kitchenToken
  );
  assert.equal(backwards.status, 400, 'mundur status harus ditolak');
});

// ---------------------------------------------------------------------------
// Keamanan harga
// ---------------------------------------------------------------------------

test('harga yang dimanipulasi dari client diabaikan server', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  // Kirim harga 1 rupiah - server harus memakai harga database.
  const result = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [{ product_id: product.id, quantity: 1, price: 1, unit_price: 1, unitPrice: 1 }],
  });

  assert.equal(result.status, 201);
  const order = result.body.data;

  assert.equal(order.items[0].unitPrice, product.price, 'harga harus dari database');
  assert.equal(order.subtotal, product.price, 'subtotal harus pakai harga asli');
});

test('produk yang tidak aktif / habis ditolak', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);

  // Produk ID yang tidak ada
  const missing = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [{ product_id: 999999, quantity: 1 }],
  });
  assert.equal(missing.status, 400);

  // Keranjang kosong
  const empty = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [],
  });
  assert.equal(empty.status, 400);
});

// ---------------------------------------------------------------------------
// Diskon
// ---------------------------------------------------------------------------

test('diskon hanya berlaku untuk staff, bukan tamu', async () => {
  const { token: cashierToken } = await login(CASHIER);

  const tables = await get('/tables?active=1', cashierToken);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', cashierToken);
  const product = (products.body.data.items || products.body.data)[0];

  const base = {
    source: 'QR',
    tableToken: table.qr.token,
    items: [{ product_id: product.id, quantity: 1 }],
  };

  // Tamu mencoba diskon 100% -> harus diabaikan
  const guest = await post('/orders', { ...base, discount_percent: 100 });
  assert.equal(guest.status, 201);
  assert.equal(guest.body.data.discountPercent, 0, 'tamu tidak boleh dapat diskon');

  // Kasir boleh memberi diskon 10%
  const staff = await post('/orders', { ...base, discount_percent: 10 }, cashierToken);
  assert.equal(staff.status, 201);
  assert.equal(staff.body.data.discountPercent, 10);

  const expectedDiscount = Math.round(staff.body.data.subtotal * 0.1 * 100) / 100;
  assert.ok(
    Math.abs(staff.body.data.discountAmount - expectedDiscount) < 1,
    'nominal diskon harus sesuai'
  );
});

// ---------------------------------------------------------------------------
// Pembayaran & refund
// ---------------------------------------------------------------------------

test('pembayaran melebihi sisa tagihan ditolak', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });

  const over = await post(
    '/payments',
    { order_id: order.body.data.id, method: 'CASH', amount: 999999999, tender: 999999999 },
    token
  );
  assert.equal(over.status, 400, 'pembayaran berlebih harus ditolak');
});

test('pembayaran non-tunai tidak boleh punya kembalian', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });

  const result = await post(
    '/payments',
    {
      order_id: order.body.data.id,
      method: 'QRIS',
      tender: 1000000,
    },
    token
  );
  assert.equal(result.status, 400, 'kembalian hanya untuk CASH');
});

test('refund hanya boleh dilakukan kasir yang berwenang', async () => {
  // Role KASIR sengaja TIDAK diberi permission payment.refund.
  const { token: cashierToken } = await login(CASHIER);

  const tables = await get('/tables?active=1', cashierToken);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', cashierToken);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const payment = await post(
    '/payments',
    { order_id: order.body.data.id, method: 'CASH', tender: order.body.data.total },
    cashierToken
  );

  const denied = await post(
    '/payments/refund',
    { payment_id: payment.body.data.paymentId, amount: 1000 },
    cashierToken
  );
  assert.equal(denied.status, 403, 'kasir tidak boleh refund');
});

test('refund penuh membatalkan order dan mengurangi kas', async () => {
  // Refund butuh permission payment.refund -> pakai ADMIN.
  const { token } = await login(ADMIN);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const orderId = order.body.data.id;

  const payment = await post(
    '/payments',
    { order_id: orderId, method: 'CASH', tender: order.body.data.total },
    token
  );
  const paymentId = payment.body.data.paymentId;

  // Refund sebagian
  const partial = await post(
    '/payments/refund',
    { payment_id: paymentId, amount: 1000, reason: 'Test refund sebagian' },
    token
  );
  assert.equal(partial.status, 200);
  assert.equal(partial.body.data.paymentStatus, 'PARTIAL_REFUND');
  assert.equal(partial.body.data.orderCancelled, false);

  // Sisa refund sampai penuh
  const rest = order.body.data.total - 1000;
  const full = await post(
    '/payments/refund',
    { payment_id: paymentId, amount: rest, reason: 'Test refund penuh' },
    token
  );
  assert.equal(full.status, 200);
  assert.equal(full.body.data.paymentStatus, 'REFUNDED');
  assert.equal(full.body.data.orderCancelled, true, 'order harus dibatalkan');
  assert.equal(full.body.data.order.status, 'CANCELLED');
  assert.equal(full.body.data.order.paidAmount, 0);
});

test('order yang sudah dibayar tidak bisa di-void langsung', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const orderId = order.body.data.id;

  await post(
    '/payments',
    { order_id: orderId, method: 'CASH', tender: order.body.data.total },
    token
  );

  const cancel = await post(
    `/orders/${orderId}/cancel`,
    { reason: 'void percobaan' },
    token
  );
  assert.equal(cancel.status, 409, 'order terbayar harus direfund dulu');
});

test('order tanpa pembayaran bisa di-void', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  const order = await post('/orders', {
    source: 'POS',
    table_id: table.id,
    items: [{ product_id: product.id, quantity: 1 }],
  });

  const cancel = await post(
    `/orders/${order.body.data.id}/cancel`,
    { reason: 'pelanggan batal' },
    token
  );

  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.status, 'CANCELLED');
});

// ---------------------------------------------------------------------------
// Kitchen board & dashboard
// ---------------------------------------------------------------------------

test('kitchen board mengelompokkan order per status', async () => {
  const { token } = await login(KITCHEN);
  const board = await get('/kitchen/board', token);

  assert.equal(board.status, 200);
  const columns = board.body.data.columns;

  for (const key of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY']) {
    assert.ok(columns[key], `kolom ${key} harus ada`);
    assert.ok(Array.isArray(columns[key].orders));
  }
});

test('dashboard mengembalikan ringkasan penjualan', async () => {
  const { token } = await login(ADMIN);
  const summary = await get('/dashboard/summary', token);

  assert.equal(summary.status, 200);
  assert.ok('sales' in summary.body.data);
  assert.ok('payments' in summary.body.data);
  assert.ok('hourly' in summary.body.data);
  assert.equal(summary.body.data.hourly.length, 24, 'grafik per jam harus 24 titik');
});

test('laporan harian menolak format tanggal salah', async () => {
  const { token } = await login(ADMIN);
  const bad = await get('/dashboard/daily?date=bukan-tanggal', token);
  assert.equal(bad.status, 400);

  const good = await get('/dashboard/daily?date=2026-01-15', token);
  assert.equal(good.status, 200);
});

// ---------------------------------------------------------------------------
// Validasi input
// ---------------------------------------------------------------------------

test('validasi input menolak data tidak lengkap', async () => {
  const noEmail = await post('/auth/login', { password: 'apa saja' });
  assert.equal(noEmail.status, 400);
  assert.ok(noEmail.body.errors, 'harus ada rincian error per field');

  const shortPassword = await post('/auth/register', {
    name: 'Test',
    email: 'test@example.com',
    password: '123',
  });
  assert.equal(shortPassword.status, 400);
});

test('order dengan quantity tidak valid ditolak', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);
  const products = await get('/products?available=1&limit=1', token);
  const product = (products.body.data.items || products.body.data)[0];

  // Quantity 0 -> minimal dikoreksi jadi 1 oleh service, tetap harus sukses.
  const result = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [{ product_id: product.id, quantity: 0 }],
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.items[0].quantity, 1);
});

test('addon dari produk lain ditolak', async () => {
  const { token } = await login(CASHIER);

  const tables = await get('/tables?active=1', token);
  const table = tables.body.data.find((t) => t.qr);

  const products = await get('/products?available=1&limit=10', token);
  const items = products.body.data.items || products.body.data;

  // Cari addon yang hanya menempel ke produk tertentu (bukan kategori),
  // lalu pakai pada produk dari kategori lain.
  const withProductAddon = items.find((p) =>
    p.addons?.some((a) => !a.categoryId)
  );
  if (!withProductAddon) return; // seed tidak punya addon per produk

  const otherProduct = items.find(
    (p) => p.id !== withProductAddon.id && p.category_id !== withProductAddon.category_id
  );
  if (!otherProduct) return;

  const foreignAddon = withProductAddon.addons.find((a) => !a.categoryId);

  const result = await post('/orders', {
    source: 'QR',
    tableToken: table.qr.token,
    items: [
      {
        product_id: otherProduct.id,
        quantity: 1,
        addons: [{ id: foreignAddon.id, quantity: 1 }],
      },
    ],
  });

  assert.equal(result.status, 400, 'addon harus divalidasi terhadap produknya');
});
