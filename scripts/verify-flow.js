'use strict';

/**
 * Verifikasi alur bisnis utama terhadap server yang sedang berjalan.
 *
 * Berbeda dengan integration test yang menyalakan server sendiri, skrip ini
 * memeriksa instance yang benar-benar hidup di http://localhost:3000.
 * Gunanya untuk memastikan aplikasi masih berfungsi utuh setelah migration,
 * seed, atau perubahan konfigurasi.
 *
 * Jalankan:
 *   npm start                 # terminal 1
 *   node scripts/verify-flow.js   # terminal 2
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const ACCOUNTS = {
  admin: { email: 'admin@restaurant.test', password: 'Admin123!' },
  cashier: { email: 'cashier@restaurant.test', password: 'Cashier123!' },
  kitchen: { email: 'kitchen@restaurant.test', password: 'Kitchen123!' },
  inventory: { email: 'inventory@restaurant.test', password: 'Inventory123!' },
};

// ---------------------------------------------------------------------------
// Pelaporan
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + title);
  console.log('='.repeat(70));
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log('  [OK]   ' + label + (detail ? ' -> ' + detail : ''));
  } else {
    failed += 1;
    failures.push(label + (detail ? ' -> ' + detail : ''));
    console.log('  [GAGAL] ' + label + (detail ? ' -> ' + detail : ''));
  }
  return Boolean(condition);
}

function info(label, value) {
  console.log('  ....   ' + label + ': ' + value);
}

// ---------------------------------------------------------------------------
// Klien HTTP sederhana
// ---------------------------------------------------------------------------

async function call(method, path, body, token) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  const response = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

const get = (p, t) => call('GET', p, undefined, t);
const post = (p, b, t) => call('POST', p, b, t);
const patch = (p, b, t) => call('PATCH', p, b, t);

/** Ambil daftar item apa pun bentuk responsnya (array atau { items: [] }). */
function rows(result) {
  const data = result?.body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function login(credentials) {
  const result = await post('/api/auth/login', credentials);
  if (result.status !== 200) {
    throw new Error('Login ' + credentials.email + ' gagal: ' + result.body?.message);
  }
  return result.body.data.accessToken;
}

// ---------------------------------------------------------------------------
// Skenario
// ---------------------------------------------------------------------------

async function main() {
  console.log('Verifikasi alur bisnis terhadap ' + BASE_URL);
  console.log('Waktu: ' + new Date().toISOString());

  // --- 0. Kesehatan server ---------------------------------------------------
  section('0. Kesehatan server');
  const health = await get('/health');
  check('/health mengembalikan 200', health.status === 200, 'HTTP ' + health.status);
  check('server melaporkan nama aplikasi', health.body?.data?.app?.length > 0, health.body?.data?.app);

  // --- 1. Login akun seed ---------------------------------------------------
  section('1. Login memakai akun seed');
  const tokens = {};
  for (const [role, credentials] of Object.entries(ACCOUNTS)) {
    const result = await post('/api/auth/login', credentials);
    const okLogin = check(
      'login ' + role + ' (' + credentials.email + ')',
      result.status === 200 && Boolean(result.body?.data?.accessToken),
      result.status === 200 ? 'token diterima' : 'HTTP ' + result.status + ' ' + result.body?.message
    );
    if (okLogin) tokens[role] = result.body.data.accessToken;
  }

  if (Object.keys(tokens).length < 4) {
    console.log('\nAda akun yang gagal login, verifikasi dihentikan.');
    report();
    return;
  }

  const me = await get('/api/auth/me', tokens.admin);
  check('/api/auth/me mengembalikan profil', me.status === 200 && Boolean(me.body?.data?.email));
  info('admin login sebagai', me.body?.data?.email + ' / ' + (me.body?.data?.roleNames || []).join(', '));

  // --- 2. Menu kebab, harga, dan varian ------------------------------------
  section('2. Menu produk, harga, dan varian');
  const menuResult = await get('/api/menu/products');
  const products = rows(menuResult);
  check('GET /api/menu/products tanpa login', menuResult.status === 200, 'HTTP ' + menuResult.status);
  check('menu memuat produk', products.length > 0, products.length + ' produk');

  const priced = products.filter((p) => Number(p.price) > 0);
  check('semua produk punya harga lebih dari nol', priced.length === products.length,
    priced.length + '/' + products.length + ' produk');

  const withVariants = products.filter((p) => Array.isArray(p.variants) && p.variants.length > 0);
  check('ada produk yang punya varian', withVariants.length > 0, withVariants.length + ' produk');

  const sample = withVariants[0];
  if (sample) {
    info('contoh varian', sample.name + ' (' + sample.variants.length + ' varian)');
    for (const variant of sample.variants.slice(0, 4)) {
      const delta = Number(variant.priceAdjustment || 0);
      info('  varian', variant.name + ' ' + (delta === 0 ? '(tanpa selisih)' : (delta > 0 ? '+' : '') + delta));
    }
    const variantWithPrice = sample.variants.find((v) => Number(v.priceAdjustment || 0) !== 0);
    check('varian bisa punya selisih harga', sample.variants.length > 1,
      variantWithPrice ? variantWithPrice.name + ' punya selisih harga' : 'varian tanpa selisih harga');
  }

  const categories = await get('/api/menu/categories');
  check('kategori menu tersedia', rows(categories).length > 0, rows(categories).length + ' kategori');

  // --- 3. Pelanggan memindai QR dan membuat pesanan -------------------------
  section('3. Pelanggan memindai QR meja dan membuat pesanan');
  const tables = await get('/api/tables?active=1', tokens.admin);
  const table = rows(tables)[0];
  check('ada meja aktif', Boolean(table), table ? table.code : 'tidak ada');

  const qrList = await get('/api/tables/qr/list', tokens.admin);
  const qrEntry = rows(qrList).find((entry) => table && entry.tableId === table.id) || rows(qrList)[0];
  check('QR meja tersedia', Boolean(qrEntry?.token), qrEntry ? 'token ' + qrEntry.token.slice(0, 12) + '...' : 'tidak ada');

  const resolve = await get('/api/tables/public/resolve?token=' + qrEntry.token);
  check('token QR bisa diresolve publik', resolve.status === 200, 'HTTP ' + resolve.status);

  const chosen = products.slice(0, 2);
  const orderResult = await post('/api/orders', {
    source: 'QR',
    tableToken: qrEntry.token,
    customer: { name: 'Budi Uji Alur' },
    items: [
      { product_id: chosen[0].id, quantity: 2 },
      { product_id: chosen[1].id, quantity: 1 },
    ],
  });
  check('tamu membuat order tanpa login', orderResult.status === 201,
    orderResult.status === 201 ? orderResult.body.data.orderNumber : 'HTTP ' + orderResult.status + ' ' + orderResult.body?.message);

  const order = orderResult.body?.data;
  if (!order) {
    report();
    return;
  }
  info('order dibuat', order.orderNumber + ' status ' + order.status + ' total ' + order.total);
  check('order baru berstatus PENDING', order.status === 'PENDING');
  check('order mencatat 2 item', order.items.length === 2);

  const expectedTotal =
    order.subtotal - order.discountAmount + order.taxAmount + order.serviceChargeAmount;
  check('total konsisten dengan rincian', order.total === expectedTotal,
    order.total + ' = ' + order.subtotal + ' - ' + order.discountAmount + ' + ' + order.taxAmount + ' + ' + order.serviceChargeAmount);

  const trackPending = await get('/api/orders/track/' + order.orderNumber);
  check('pelanggan bisa melacak tanpa login', trackPending.status === 200);
  check('lacakan menunjukkan PENDING', trackPending.body?.data?.status === 'PENDING');

  // --- 4. Stok awal dan aturan pengurangan --------------------------------
  section('4. Pengurangan stok sesuai aturan bisnis');
  const recipeOrder = await pickProductWithRecipe(tokens.inventory, products);
  if (!recipeOrder) {
    info('peringatan', 'tidak ada produk dengan recipe, pengurangan stok tidak diuji');
  }

  let ingredientsBefore = [];
  if (recipeOrder) {
    const beforeResult = await get('/api/inventory/ingredients?limit=200', tokens.inventory);
    ingredientsBefore = rows(beforeResult);
    info('produk uji', recipeOrder.product.name);

    // Buat order khusus uji stok supaya perhitungannya tidak tercampur.
    const stockOrder = await post('/api/orders', {
      source: 'POS',
      table_id: table.id,
      items: [{ product_id: recipeOrder.product.id, quantity: 2 }],
    }, tokens.cashier);
    check('order uji stok dibuat', stockOrder.status === 201,
      stockOrder.status === 201 ? stockOrder.body.data.orderNumber : stockOrder.body?.message);
    const stockOrderData = stockOrder.body?.data;

    // Status masih PENDING, jadi stok belum boleh bergerak.
    const unchanged = await compareStock(tokens.inventory, ingredientsBefore);
    check('stok belum berubah saat order masih PENDING', unchanged === 0,
      unchanged === 0 ? 'stok utuh' : unchanged + ' bahan bergerak');

    // Lunasi pembayaran -> order CONFIRMED -> stok keluar.
    const payment = await post('/api/payments', {
      order_id: stockOrderData.id,
      method: 'CASH',
      tender: stockOrderData.total,
    }, tokens.cashier);

    check('kasir memproses pembayaran', payment.status === 201,
      payment.status === 201 ? 'lunas' : 'HTTP ' + payment.status + ' ' + payment.body?.message);
    check('pembayaran tercatat lunas', payment.body?.data?.isFullyPaid === true);
    check('kembalian nol saat bayar pas', Number(payment.body?.data?.changeAmount || 0) === 0,
      'kembalian ' + (payment.body?.data?.changeAmount || 0));
    check('order CONFIRMED setelah lunas', payment.body?.data?.order?.status === 'CONFIRMED');

    const afterPay = await compareStock(tokens.inventory, ingredientsBefore);
    check('stok berkurang setelah pembayaran penuh', afterPay > 0,
      afterPay + ' bahan berkurang setelah lunas');

    const movements = await get(
      '/api/inventory/movements?type=SALE&order_id=' + stockOrderData.id + '&limit=100',
      tokens.inventory
    );
    check('jurnal SALE tercatat untuk order ini', rows(movements).length > 0,
      rows(movements).length + ' baris jurnal');

    const salesCount = await countSalesForOrder(tokens.inventory, stockOrderData.id);
    check('stok tidak terpotong dua kali', salesCount.deductedRows === salesCount.expectedRows,
      salesCount.deductedRows + ' baris untuk ' + salesCount.expectedRows + ' bahan');

    // Paksa konfirmasi ulang, stok harus tetap.
    const repeat = await patch('/api/orders/' + stockOrderData.id + '/status', { status: 'CONFIRMED' }, tokens.kitchen);
    info('konfirmasi ulang', 'HTTP ' + repeat.status + ' (tidak boleh mengurangi stok lagi)');
    const afterRepeat = await compareStock(tokens.inventory, ingredientsBefore);
    check('konfirmasi ulang tidak mengurangi stok lagi', afterRepeat === afterPay,
      afterRepeat + ' bahan (harus tetap ' + afterPay + ')');

    // Batalkan order -> stok kembali.
    const cancel = await post('/api/orders/' + stockOrderData.id + '/cancel',
      { reason: 'pelanggan membatalkan' }, tokens.cashier);
    info('pembatalan', 'HTTP ' + cancel.status);
    const afterCancel = await get('/api/inventory/ingredients?limit=200', tokens.inventory);
    const restored = rows(afterCancel).filter((item) => {
      const before = ingredientsBefore.find((b) => b.id === item.id);
      return before && Math.abs(Number(item.stock) - Number(before.stock)) > 0.001;
    });
    check('stok kembali setelah pembatalan', restored.length === 0,
      restored.length === 0 ? 'semua bahan kembali seperti semula'
        : restored.map((r) => r.name).join(', ') + ' belum kembali');

    const voids = await get('/api/inventory/movements?type=VOID&order_id=' + stockOrderData.id + '&limit=100', tokens.inventory);
    check('jurnal VOID tercatat', rows(voids).length > 0, rows(voids).length + ' baris');
  }

  // --- 5. Kitchen Display dan perubahan status ------------------------------
  section('5. Kitchen Display dan perubahan status');
  const board = await get('/api/kitchen/board', tokens.kitchen);
  const boardData = board.body?.data;
  const columns = boardData && typeof boardData === 'object'
    ? Object.keys(boardData).filter((key) => Array.isArray(boardData[key]))
    : [];
  check('papan dapur terbaca', board.status === 200, 'HTTP ' + board.status);
  info('kolom papan', columns.join(', ') || '(tidak ada)');

  const allBoardOrders = columns.flatMap((key) => boardData[key].map((entry) => ({ column: key, ...entry })));
  check('order uji muncul di papan dapur',
    allBoardOrders.some((entry) => entry.orderId === order.id || entry.orderNumber === order.orderNumber),
    allBoardOrders.length + ' order di papan');

  const flow = ['PREPARING', 'READY', 'COMPLETED'];
  let current = 'PENDING';
  for (const next of flow) {
    const step = await patch('/api/kitchen/orders/' + order.id + '/status', { status: next }, tokens.kitchen);
    const okStep = check('dapur mengubah status ke ' + next, step.status === 200 && step.body?.data?.status === next,
      step.status === 200 ? step.body.data.status : 'HTTP ' + step.status + ' ' + step.body?.message);
    if (!okStep) break;
    current = next;
  }
  check('order selesai COMPLETED', current === 'COMPLETED', current);

  const trackDone = await get('/api/orders/track/' + order.orderNumber);
  check('pelanggan melihat status COMPLETED', trackDone.body?.data?.status === 'COMPLETED',
    trackDone.body?.data?.status);

  // --- 6. Validasi input, otorisasi, dan penanganan error --------------------
  section('6. Validasi input, otorisasi role, dan penanganan error');

  const noAuth = await get('/api/orders');
  check('endpoint staff menolak tanpa token', noAuth.status === 401, 'HTTP ' + noAuth.status);

  const badToken = await get('/api/orders', 'token-palsu-12345');
  check('token tidak valid ditolak', badToken.status === 401, 'HTTP ' + badToken.status);

  const emptyItems = await post('/api/orders', { source: 'QR', tableToken: qrEntry.token, items: [] });
  check('order tanpa item ditolak', emptyItems.status === 400, 'HTTP ' + emptyItems.status);

  const badProduct = await post('/api/orders', {
    source: 'QR',
    tableToken: qrEntry.token,
    items: [{ product_id: 999999, quantity: 1 }],
  });
  check('produk tidak ada ditolak', badProduct.status === 404 || badProduct.status === 400,
    'HTTP ' + badProduct.status);

  const negativeQty = await post('/api/orders', {
    source: 'QR',
    tableToken: qrEntry.token,
    items: [{ product_id: chosen[0].id, quantity: -5 }],
  });
  check('jumlah negatif ditolak', negativeQty.status === 400, 'HTTP ' + negativeQty.status);

  const badTokenQr = await post('/api/orders', {
    source: 'QR',
    tableToken: 'token-palsu-xyz',
    items: [{ product_id: chosen[0].id, quantity: 1 }],
  });
  check('token QR palsu ditolak', badTokenQr.status === 400 || badTokenQr.status === 404,
    'HTTP ' + badTokenQr.status);

  const cashierInventory = await get('/api/inventory/ingredients', tokens.cashier);
  check('kasir tidak bisa baca inventory', cashierInventory.status === 403, 'HTTP ' + cashierInventory.status);

  const kitchenPayments = await get('/api/payments', tokens.kitchen);
  check('dapur tidak bisa baca pembayaran', kitchenPayments.status === 403, 'HTTP ' + kitchenPayments.status);

  const kitchenInventoryWrite = await post('/api/inventory/adjustment',
    { ingredient_id: ingredientsBefore[0]?.id || 1, direction: 'IN', quantity: 1 }, tokens.kitchen);
  check('dapur tidak bisa mengubah stok', kitchenInventoryWrite.status === 403, 'HTTP ' + kitchenInventoryWrite.status);

  const cashierUsers = await get('/api/users', tokens.cashier);
  check('kasir tidak bisa kelola user', cashierUsers.status === 403, 'HTTP ' + cashierUsers.status);

  const skipStatus = await patch('/api/orders/' + order.id + '/status', { status: 'PENDING' }, tokens.kitchen);
  check('lompatan status ke PENDING ditolak', skipStatus.status === 400 || skipStatus.status === 409,
    'HTTP ' + skipStatus.status);

  const badStatus = await patch('/api/orders/' + order.id + '/status', { status: 'MADE_UP' }, tokens.kitchen);
  check('status tidak dikenal ditolak', badStatus.status === 400, 'HTTP ' + badStatus.status);

  const overpay = await post('/api/payments',
    { order_id: order.id, method: 'CASH', tender: 1 }, tokens.cashier);
  check('pembayaran melebihi tagihan ditolak atau dicatat sebagai sisa',
    overpay.status === 201 || overpay.status === 400, 'HTTP ' + overpay.status);

  const notFound = await get('/api/orders/9999999', tokens.admin);
  check('order tidak ditemukan memberi 404', notFound.status === 404, 'HTTP ' + notFound.status);

  const summary = await get('/api/dashboard/summary', tokens.admin);
  check('laporan dashboard terbaca', summary.status === 200, 'HTTP ' + summary.status);

  const summaryBody = summary.body?.data;
  if (summaryBody) {
    info('total order hari ini', summaryBody.totalOrders ?? summaryBody.today?.totalOrders ?? '-');
    info('omzet hari ini', summaryBody.totalRevenue ?? summaryBody.today?.totalRevenue ?? '-');
  }

  const daily = await get('/api/dashboard/daily?date=' + new Date().toISOString().slice(0, 10), tokens.admin);
  check('laporan harian terbaca', daily.status === 200, 'HTTP ' + daily.status);

  const notifications = await get('/api/notifications?limit=5', tokens.admin);
  check('notifikasi terbaca', notifications.status === 200,
    'HTTP ' + notifications.status + ', ' + rows(notifications).length + ' entri');

  report();
}

/** Cari satu produk yang punya recipe agar pengurangan stok bisa diukur. */
async function pickProductWithRecipe(token, products) {
  const recipes = await get('/api/inventory/recipes?limit=200', token);
  const withRecipe = rows(recipes).filter((recipe) => Number(recipe.productId) > 0);
  if (withRecipe.length === 0) return null;

  for (const recipe of withRecipe) {
    const product = products.find((p) => Number(p.id) === Number(recipe.productId));
    if (product) return { product, recipe };
  }
  return null;
}

/** Hitung berapa bahan yang stoknya berbeda dari daftar acuan. */
async function compareStock(token, baseline) {
  const current = await get('/api/inventory/ingredients?limit=200', token);
  const now = rows(current);
  return now.filter((item) => {
    const before = baseline.find((b) => Number(b.id) === Number(item.id));
    return before && Math.abs(Number(item.stock) - Number(before.stock)) > 0.001;
  }).length;
}

/** Bandingkan jumlah baris SALE dengan jumlah bahan yang dipakai recipe. */
async function countSalesForOrder(token, orderId) {
  const movements = await get('/api/inventory/movements?type=SALE&order_id=' + orderId + '&limit=200', token);
  const list = rows(movements);
  const ingredients = new Set(list.map((m) => Number(m.ingredientId)));
  return { deductedRows: list.length, expectedRows: ingredients.size };
}

function report() {
  console.log('\n' + '='.repeat(70));
  console.log('  RINGKASAN');
  console.log('='.repeat(70));
  console.log('  Lulus  : ' + passed);
  console.log('  Gagal  : ' + failed);
  if (failures.length > 0) {
    console.log('\n  Daftar kegagalan:');
    for (const item of failures) console.log('   - ' + item);
  }
  console.log('='.repeat(70));
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('\nVerifikasi terhenti karena kesalahan tak terduga:');
  console.error(error);
  process.exitCode = 1;
});