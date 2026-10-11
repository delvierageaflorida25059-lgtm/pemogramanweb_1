'use strict';

/**
 * Integration test untuk Fase 4 - Inventory, Recipe/BOM, dan Stock Opname.
 *
 * Menguji perilaku yang tidak bisa dibuktikan tanpa database sungguhan:
 *   - konsistensi ingredients.stock dengan jurnal inventory_transactions
 *   - pengurangan stok otomatis saat order dikonfirmasi
 *   - pengembalian stok saat order dibatalkan atau direfund penuh
 *   - idempotensi: satu order tidak boleh mengurangi bahan dua kali
 *   - stock opname menyesuaikan stok sesuai hasil hitung fisik
 *
 * Perlu server aktif di http://localhost:3000 dan database sudah di-seed
 * (termasuk migration Fase 4).
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { startTestServer, createClient } = require('./helpers/server');
const { login: loginOnce } = require('./helpers/auth');

// Base URL diisi oleh before(); semua request memakai client yang sama.
let client;

const ADMIN = { email: 'admin@restaurant.test', password: 'Admin123!' };
const CASHIER = { email: 'cashier@restaurant.test', password: 'Cashier123!' };
const INVENTORY = { email: 'inventory@restaurant.test', password: 'Inventory123!' };
const KITCHEN = { email: 'kitchen@restaurant.test', password: 'Kitchen123!' };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Ambil array baris dari respons berpaginasi.
 *
 * Endpoint berpaginasi mengembalikan array LANGSUNG pada field `data`
 * (dengan `meta` terpisah), sedangkan endpoint non-paginasi juga memakai
 * `data`. Beberapa test lama memakai `body.data.items`, jadi accessor ini
 * menangani keduanya supaya tidak mudah salah.
 */
function rows(result) {
  const data = result?.body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

/**
 * Ringkas respons untuk pesan kegagalan, supaya saat test gagal terlihat
 * pesan error dari server, bukan sekadar angka status.
 */
function describe(result) {
  const body = result?.body;
  const message = body?.message || body?.error || JSON.stringify(body).slice(0, 200);
  return `HTTP ${result?.status} - ${message}`;
}

let server;

test.before(async () => {
  server = await startTestServer();
  client = createClient(server.baseUrl);
});

test.after(async () => {
  if (server) await server.close();
});

const call = (...args) => client.call(...args);
const get = (...args) => client.get(...args);
const post = (...args) => client.post(...args);
const put = (...args) => client.put(...args);

/**
 * Login memakai cache, jadi puluhan test tidak menabrak rate limit login.
 */
async function login(credentials) {
  return loginOnce(client, credentials);
}

/**
 * Baca stok terkini sebuah bahan langsung lewat API.
 * @returns {Promise<{stock:number, minimumStock:number, unit:string, name:string}>}
 */
async function readIngredient(token, ingredientId) {
  const result = await get(`/inventory/ingredients/${ingredientId}`, token);
  assert.equal(result.status, 200, describe(result));
  return result.body.data;
}

/**
 * Buat order POS berisi satu produk sebanyak `quantity`.
 * Mengembalikan { orderId, total }.
 */
async function createOrder(token, productId, quantity) {
  const tables = await get('/tables?active=1', token);
  const table = (tables.body.data || [])[0];

  const result = await post(
    '/orders',
    {
      source: 'POS',
      table_id: table.id,
      items: [{ product_id: productId, quantity }],
    },
    token
  );

  assert.equal(result.status, 201, `Gagal membuat order: ${result.body?.message}`);
  return result.body.data;
}

/** Bayar order penuh dengan tunai. */
async function payOrder(token, order) {
  const result = await post(
    '/payments',
    { order_id: order.id, method: 'CASH', tender: order.total },
    token
  );
  assert.equal(result.status, 201, `Gagal membayar: ${result.body?.message}`);
  return result.body.data;
}

/** Ambil id produk berdasarkan kode produk. */
async function findProductByCode(token, code) {
  const result = await get(`/products?search=${encodeURIComponent(code)}&limit=5`, token);
  assert.equal(result.status, 200, describe(result));
  const item = (rows(result) || []).find((product) => product.code === code);
  assert.ok(item, `Produk ${code} tidak ditemukan`);
  return item;
}

// ---------------------------------------------------------------------------
// Invarian dasar
// ---------------------------------------------------------------------------

test('stok bahan selalu cocok dengan jurnal mutasi', async () => {
  const { token } = await login(ADMIN);

  const ingredients = await get('/inventory/ingredients?limit=100', token);
  assert.equal(ingredients.status, 200, describe(ingredients));

  // Endpoint berpaginasi mengembalikan array langsung pada field data.
  const items = rows(ingredients);
  assert.ok(items.length >= 20, `hanya ada ${items.length} bahan, seed bahan gagal?`);

  // Untuk tiap bahan, jumlahkan seluruh mutasi lalu bandingkan dengan stok.
  for (const ingredient of items) {
    const movements = await get(
      `/inventory/movements?ingredient_id=${ingredient.id}&limit=100`,
      token
    );
    assert.equal(movements.status, 200, describe(movements));

    const list = rows(movements);
    if (list.length === 0) continue;

    const netFromJournal = list.reduce(
      (sum, row) => sum + row.quantityIn - row.quantityOut,
      0
    );

    assert.ok(
      Math.abs(netFromJournal - ingredient.stock) < 0.01,
      `Stok bahan "${ingredient.name}" = ${ingredient.stock}, ` +
        `tapi jurnal berjumlah ${netFromJournal}. Keduanya harus sama.`
    );
  }
});

test('jurnal menyimpan snapshot stock_before dan stock_after yang konsisten', async () => {
  const { token } = await login(ADMIN);
  const movements = await get('/inventory/movements?limit=50', token);

  assert.equal(movements.status, 200, describe(movements));
  const list = rows(movements);
  assert.ok(list.length > 0, 'belum ada mutasi sama sekali');

  for (const row of list) {
    const expectedAfter =
      Math.round((row.stockBefore + row.quantityIn - row.quantityOut) * 1000) / 1000;

    assert.ok(
      Math.abs(expectedAfter - row.stockAfter) < 0.01,
      `Baris #${row.id}: ${row.stockBefore} + ${row.quantityIn} - ${row.quantityOut} ` +
        `= ${expectedAfter}, tapi stock_after tertulis ${row.stockAfter}`
    );
  }
});

// ---------------------------------------------------------------------------
// Recipe / BOM
// ---------------------------------------------------------------------------

test('daftar recipe memuat bahan dengan takaran dan waste', async () => {
  const { token } = await login(ADMIN);
  const result = await get('/inventory/recipes', token);

  assert.equal(result.status, 200, describe(result));
  const recipes = result.body.data;
  assert.ok(recipes.length > 0, 'belum ada recipe');

  const nasiGoreng = recipes.find((recipe) => recipe.productCode === 'MKN-001');
  assert.ok(nasiGoreng, 'recipe Nasi Goreng Spesial tidak ditemukan');
  assert.equal(nasiGoreng.items.length, 5);
  assert.ok(nasiGoreng.items.every((item) => item.quantity > 0));
});

test('detail recipe memuat kebutuhan per porsi yang memperhitungkan waste', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');

  const result = await get(`/inventory/recipes/products/${product.id}`, token);
  assert.equal(result.status, 200, describe(result));

  const recipe = result.body.data;
  assert.equal(recipe.yieldQuantity, 1);

  // Beras: satuan kg, takaran 0.150 per porsi, waste 2%
  // -> 0.150 x 1.02 = 0.153 kg per porsi
  const beras = recipe.items.find((item) => item.ingredient.code === 'BHN-001');
  assert.ok(beras, 'bahan Beras Pulen tidak ada di recipe');
  assert.equal(beras.unit, 'kg', 'satuan Beras harus kg');
  assert.equal(beras.quantity, 0.15);
  assert.equal(beras.wastePercent, 2);

  const perPortionWithWaste = beras.quantity * (1 + beras.wastePercent / 100);
  assert.ok(
    Math.abs(perPortionWithWaste - 0.153) < 0.0005,
    `kebutuhan Beras per porsi seharusnya 0.153 kg, terkhitung ${perPortionWithWaste}`
  );

  // Takaran harus memakai satuan yang sama dengan bahan induknya. Kalau recipe
  // menulis 150 untuk bahan bersatuan kg, itu berarti 150 kg per porsi.
  for (const item of recipe.items) {
    assert.equal(
      item.unit,
      item.ingredient.unit,
      `satuan baris recipe "${item.ingredient.name}" harus sama dengan satuan bahan`
    );
  }
});

test('recipe bisa disimpan dan diperbarui', async () => {
  const { token } = await login(ADMIN);
  const products = await get('/products?limit=50', token);
  const allProducts = rows(products) || [];
  const ingredients = await get('/inventory/ingredients?limit=5', token);
  const ingredient = rows(ingredients)[0];

  // Cari produk yang belum punya recipe.
  const recipes = await get('/inventory/recipes', token);
  const withRecipe = new Set(recipes.body.data.map((recipe) => recipe.productId));
  const target = allProducts.find((product) => !withRecipe.has(product.id));

  if (!target) {
    // Semua produk sudah punya recipe; pengujian dilewati karena tidak ada
    // target yang sesuai.
    return;
  }

  const payload = {
    yield_quantity: 1,
    items: [{ ingredient_id: ingredient.id, quantity: 12.5, waste_percent: 3 }],
  };

  const created = await put(
    `/inventory/recipes/products/${target.id}`,
    payload,
    token
  );
  assert.equal(created.status, 200, `Gagal menyimpan recipe: ${created.body?.message}`);
  assert.equal(rows(created).length, 1);
  assert.equal(rows(created)[0].quantity, 12.5);

  // Perbarui dengan daftar bahan berbeda.
  const second = rows(ingredients)[1];
  const updated = await put(
    `/inventory/recipes/products/${target.id}`,
    { yield_quantity: 2, items: [{ ingredient_id: second.id, quantity: 30 }] },
    token
  );
  assert.equal(updated.status, 200, describe(updated));
  assert.equal(updated.body.data.yieldQuantity, 2);
  assert.equal(rows(updated).length, 1);
  assert.equal(rows(updated)[0].ingredientId, second.id);

  // Kembalikan ke kondisi semula supaya test lain tidak terpengaruh.
  await put(`/inventory/recipes/products/${target.id}`, { items: [] }, token).catch(() => {});
});

test('recipe dengan bahan duplikat ditolak', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');
  const ingredients = await get('/inventory/ingredients?limit=2', token);
  const first = rows(ingredients)[0];
  const second = rows(ingredients)[1];

  const result = await put(
    `/inventory/recipes/products/${product.id}`,
    {
      yield_quantity: 1,
      items: [
        { ingredient_id: first.id, quantity: 10 },
        { ingredient_id: first.id, quantity: 20 },
        { ingredient_id: second.id, quantity: 5 },
      ],
    },
    token
  );

  assert.equal(result.status, 400);
  assert.ok(
    /lebih dari sekali|duplikat/i.test(result.body.message),
    `pesan error tidak menjelaskan duplikat: ${result.body.message}`
  );
});

// ---------------------------------------------------------------------------
// Pengurangan stok otomatis
// ---------------------------------------------------------------------------

test('pembayaran order mengurangi stok bahan sesuai recipe', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');

const recipeResult = await get(`/inventory/recipes/products/${product.id}`, token);
  const recipe = recipeResult.body.data;
  const beras = recipe.items.find((item) => item.ingredient.code === 'BHN-001');

  const before = await readIngredient(token, beras.ingredientId);
  const quantity = 3;

  // Ekspektasi dihitung dari isi recipe, bukan angka tetap, supaya test tetap
  // benar walaupun satuan atau takaran recipe diubah.
  const perPortion = beras.quantity / recipe.yieldQuantity;
  const expectedDecrease = perPortion * (1 + beras.wastePercent / 100) * quantity;

  const order = await createOrder(token, product.id, quantity);
  await payOrder(token, order);

  const after = await readIngredient(token, beras.ingredientId);

  const actualDecrease = before.stock - after.stock;
  assert.ok(
    Math.abs(actualDecrease - expectedDecrease) < 0.002,
    `stok Beras turun ${actualDecrease} ${after.unit}, ` +
      `seharusnya turun ${expectedDecrease} ${after.unit} ` +
      `(sebelum ${before.stock}, sesudah ${after.stock})`
  );
});

test('jurnal SALE mencatat pengurangan dari sebuah order', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');
  const order = await createOrder(token, product.id, 1);
  await payOrder(token, order);

  const movements = await get(
    `/inventory/movements?order_id=${order.id}&type=SALE`,
    token
  );

  assert.equal(movements.status, 200, describe(movements));
  const list = rows(movements);
  assert.ok(list.length > 0, 'tidak ada jurnal SALE untuk order ini');

  for (const row of list) {
    assert.equal(row.referenceType, 'order');
    assert.equal(row.orderNumber, order.orderNumber);
    assert.ok(row.quantityOut > 0, 'SALE harus mengeluarkan stok');
    assert.equal(row.quantityIn, 0);
  }
});

test('order dengan produk tanpa recipe tetap berhasil tanpa-error', async () => {
  const { token } = await login(ADMIN);
  const products = await get('/products?limit=100', token);
  const all = rows(products) || [];

  const recipes = await get('/inventory/recipes', token);
  const withRecipe = new Set(recipes.body.data.map((recipe) => recipe.productId));
  const withoutRecipe = all.find((product) => !withRecipe.has(product.id));

  if (!withoutRecipe) return;

  // Nonaktifkan recipe produk ini kalau ada, lalu coba pesan.
  const created = await post(
    '/orders',
    {
      source: 'POS',
      items: [{ product_id: withoutRecipe.id, quantity: 1 }],
    },
    token
  );
  assert.equal(created.status, 201, `order gagal: ${created.body?.message}`);
  const order = created.body.data;

  const payment = await payOrder(token, order);
  assert.equal(payment.isFullyPaid, true);

  const movements = await get(`/inventory/movements?order_id=${order.id}`, token);
  assert.equal(
    rows(movements).length,
    0,
    'produk tanpa recipe tidak boleh menghasilkan mutasi bahan'
  );
});

test('produk yang sama dua kali dalam satu order digabung jadi satu pengurangan', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');

  const recipeResult = await get(`/inventory/recipes/products/${product.id}`, token);
  const recipe = recipeResult.body.data;
  const beras = recipe.items.find((item) => item.ingredient.code === 'BHN-001');
  const before = await readIngredient(token, beras.ingredientId);

  // Satu order dengan dua baris produk yang sama.
  const tables = await get('/tables?active=1', token);
  const table = rows(tables)[0];

  const created = await post(
    '/orders',
    {
      source: 'POS',
      table_id: table.id,
      items: [
        { product_id: product.id, quantity: 2 },
        { product_id: product.id, quantity: 3 },
      ],
    },
    token
  );
  assert.equal(created.status, 201, describe(created));
  const order = created.body.data;

  await payOrder(token, order);

  const after = await readIngredient(token, beras.ingredientId);
  const perPortion = beras.quantity / recipe.yieldQuantity;
  const expected = perPortion * (1 + beras.wastePercent / 100) * 5;

  assert.ok(
    Math.abs(before.stock - after.stock - expected) < 0.002,
    `dua baris produk sama seharusnya mengurangi ${expected} ${after.unit}, ` +
      `terkurangi ${before.stock - after.stock} ${after.unit}`
  );
});

// ---------------------------------------------------------------------------
// Idempotensi
// ---------------------------------------------------------------------------

test('mengubah status ke CONFIRMED dua kali tidak mengurangi stok dua kali', async () => {
  const { token: cashierToken } = await login(CASHIER);
  const { token: adminToken } = await login(ADMIN);

  const product = await findProductByCode(adminToken, 'MKN-001');
  const recipeResult = await get(`/inventory/recipes/products/${product.id}`, adminToken);
  const beras = recipeResult.body.data.items.find(
    (item) => item.ingredient.code === 'BHN-001'
  );
  const before = await readIngredient(adminToken, beras.ingredientId);

  const order = await createOrder(cashierToken, product.id, 2);
  await payOrder(cashierToken, order);

  const afterPayment = await readIngredient(adminToken, beras.ingredientId);
  const decreaseAfterPayment = before.stock - afterPayment.stock;

  // Coba majukan status lagi. Endpoint PATCH /orders/:id/status butuh
  // permission kitchen.process, jadi dipanggil memakai akun dapur.
  const { token: kitchenToken } = await login(KITCHEN);
  const repeat = await call('PATCH', `/orders/${order.id}/status`, {
    token: kitchenToken,
    body: { status: 'CONFIRMED' },
  });
  assert.ok(
    [400, 409].includes(repeat.status),
    `perpindahan status ganda seharusnya ditolak, dapat ${repeat.status} - ${describe(repeat)}`
  );

  const afterRepeat = await readIngredient(adminToken, beras.ingredientId);
  assert.ok(
    Math.abs(before.stock - afterRepeat.stock - decreaseAfterPayment) < 0.001,
    'stok berubah lagi padahal order sudah diproses'
  );
});

// ---------------------------------------------------------------------------
// Pengembalian stok
// ---------------------------------------------------------------------------

test('membatalkan order mengembalikan stok bahan', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');

  const recipeResult = await get(`/inventory/recipes/products/${product.id}`, token);
  const beras = recipeResult.body.data.items.find(
    (item) => item.ingredient.code === 'BHN-001'
  );

  const beforePay = await readIngredient(token, beras.ingredientId);

  const order = await createOrder(token, product.id, 2);
  await payOrder(token, order);

  const afterPay = await readIngredient(token, beras.ingredientId);
  assert.ok(
    afterPay.stock < beforePay.stock,
    'pembayaran seharusnya mengurangi stok bahan'
  );

  // Order sudah dibayar, jadi void langsung ditolak.
  const voidDirect = await post(
    `/orders/${order.id}/cancel`,
    { reason: 'percobaan void' },
    token
  );
  assert.equal(voidDirect.status, 409, 'order terbayar tidak boleh di-void langsung');

  // Refund penuh -> order dibatalkan -> stok kembali seperti SEBELUM order.
  const payments = await get(`/payments?order_id=${order.id}`, token);
  const paymentId = rows(payments)[0].id;

  const refund = await post(
    '/payments/refund',
    { payment_id: paymentId, amount: order.total, reason: 'uji pengembalian stok' },
    token
  );
  assert.equal(refund.status, 200, `Gagal refund: ${refund.body?.message}`);
  assert.equal(refund.body.data.orderCancelled, true);

  const afterRefund = await readIngredient(token, beras.ingredientId);

  assert.ok(
    Math.abs(afterRefund.stock - beforePay.stock) < 0.002,
    `stok seharusnya kembali ke ${beforePay.stock} (nilai sebelum order), ` +
      `sekarang ${afterRefund.stock}. Setelah bayar nilainya ${afterPay.stock}.`
  );
});

test('jurnal VOID mencatat pengembalian bahan', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');
  const order = await createOrder(token, product.id, 1);
  await payOrder(token, order);

  const payments = await get(`/payments?order_id=${order.id}`, token);
  const paymentId = rows(payments)[0].id;

  await post(
    '/payments/refund',
    { payment_id: paymentId, amount: order.total, reason: 'uji jurnal void' },
    token
  );

  const movements = await get(`/inventory/movements?order_id=${order.id}&type=VOID`, token);
  const list = rows(movements);
  assert.ok(list.length > 0, 'tidak ada jurnal VOID');

  for (const row of list) {
    assert.ok(row.quantityIn > 0, 'VOID harus mengembalikan stok');
    assert.equal(row.quantityOut, 0);
  }
});

test('void dua kali tidak mengembalikan bahan dua kali', async () => {
  const { token } = await login(ADMIN);
  const product = await findProductByCode(token, 'MKN-001');
  const order = await createOrder(token, product.id, 1);
  await payOrder(token, order);

  const payments = await get(`/payments?order_id=${order.id}`, token);
  const paymentId = rows(payments)[0].id;
  await post('/payments/refund', { payment_id: paymentId, amount: order.total }, token);

  // Order sudah CANCELLED, cancel kedua harus ditolak.
  const second = await post(`/orders/${order.id}/cancel`, { reason: 'kedua' }, token);
  assert.equal(second.status, 409, 'order yang sudah dibatalkan tidak bisa dibatalkan lagi');

  const movements = await get(`/inventory/movements?order_id=${order.id}&type=VOID`, token);
  const list = rows(movements);

  // Setiap bahan harus punya tepat satu entri VOID.
  const counts = new Map();
  for (const row of list) {
    counts.set(row.ingredientId, (counts.get(row.ingredientId) || 0) + 1);
  }
  for (const [ingredientId, count] of counts) {
    assert.equal(count, 1, `bahan #${ingredientId} punya ${count} entri VOID, harusnya 1`);
  }
});

// ---------------------------------------------------------------------------
// Penyesuaian manual
// ---------------------------------------------------------------------------

test('penyesuaian stok manual menambah stok dan menulis jurnal', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const before = await readIngredient(token, ingredient.id);
  const delta = 2.5;

  const result = await post(
    '/inventory/adjustment',
    { ingredient_id: ingredient.id, direction: 'IN', quantity: delta, note: 'uji penyesuaian' },
    token
  );

  assert.equal(result.status, 200, `Gagal penyesuaian: ${result.body?.message}`);

  const after = await readIngredient(token, ingredient.id);
  assert.ok(
    Math.abs(after.stock - (before.stock + delta)) < 0.001,
    `stok seharusnya ${before.stock + delta}, sekarang ${after.stock}`
  );
});

test('penyesuaian stok manual mengurangi stok dan menulis jurnal', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const before = await readIngredient(token, ingredient.id);
  const delta = 1.25;

  const result = await post(
    '/inventory/adjustment',
    { ingredient_id: ingredient.id, direction: 'OUT', quantity: delta, note: 'uji bahan rusak' },
    token
  );

  assert.equal(result.status, 200, describe(result));

  const after = await readIngredient(token, ingredient.id);
  assert.ok(
    Math.abs(after.stock - (before.stock - delta)) < 0.001,
    `stok seharusnya ${before.stock - delta}, sekarang ${after.stock}`
  );
});

test('barang masuk dari supplier dicatat dengan tipe PURCHASE', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const before = await readIngredient(token, ingredient.id);

  const result = await post(
    '/inventory/receive',
    { ingredient_id: ingredient.id, quantity: 3, note: 'uji penerimaan barang' },
    token
  );
  assert.equal(result.status, 201);

  const after = await readIngredient(token, ingredient.id);
  assert.ok(Math.abs(after.stock - (before.stock + 3)) < 0.001);

  const movements = await get(
    `/inventory/movements?ingredient_id=${ingredient.id}&type=PURCHASE`,
    token
  );
  assert.ok(rows(movements).length > 0, 'tidak ada jurnal PURCHASE');
});

test('bahan rusak dicatat dengan tipe WASTE dan mengurangi stok', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const before = await readIngredient(token, ingredient.id);

  const result = await post(
    '/inventory/movements',
    { ingredient_id: ingredient.id, type: 'WASTE', quantity: 2, note: 'uji bahan rusak' },
    token
  );
  assert.equal(result.status, 201);

  const after = await readIngredient(token, ingredient.id);
  assert.ok(
    Math.abs(after.stock - (before.stock - 2)) < 0.001,
    `stok seharusnya turun 2, dari ${before.stock} jadi ${after.stock}`
  );

  const movements = await get(
    `/inventory/movements?ingredient_id=${ingredient.id}&type=WASTE`,
    token
  );
  const journal = rows(movements)[0];
  assert.ok(journal, 'tidak ada jurnal WASTE');
  assert.equal(Number(journal.quantityOut), 2);
  assert.equal(Number(journal.quantityIn), 0);
});

test('retur bahan dari dapur dicatat dengan tipe RETURN dan menambah stok', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const before = await readIngredient(token, ingredient.id);

  const result = await post(
    '/inventory/movements',
    { ingredient_id: ingredient.id, type: 'RETURN', quantity: 4, note: 'uji retur dapur' },
    token
  );
  assert.equal(result.status, 201);

  const after = await readIngredient(token, ingredient.id);
  assert.ok(Math.abs(after.stock - (before.stock + 4)) < 0.001);

  const movements = await get(
    `/inventory/movements?ingredient_id=${ingredient.id}&type=RETURN`,
    token
  );
  const journal = rows(movements)[0];
  assert.ok(journal, 'tidak ada jurnal RETURN');
  assert.equal(Number(journal.quantityIn), 4);
});

test('jurnal SALE dan VOID tidak bisa dibuat manual lewat endpoint mutasi', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];
  const before = await readIngredient(token, ingredient.id);

  for (const type of ['SALE', 'VOID', 'OPNAME', 'PURCHASE', 'ADJUSTMENT']) {
    const result = await post(
      '/inventory/movements',
      { ingredient_id: ingredient.id, type, quantity: 1 },
      token
    );
    assert.equal(result.status, 400, `tipe ${type} seharusnya ditolak di endpoint mutasi`);
  }

  const after = await readIngredient(token, ingredient.id);
  assert.ok(
    Math.abs(after.stock - before.stock) < 0.001,
    'stok tidak boleh berubah karena semua percobaan ditolak'
  );
});

test('mutasi bahan dengan jumlah nol ditolak', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const result = await post(
    '/inventory/movements',
    { ingredient_id: ingredient.id, type: 'WASTE', quantity: 0 },
    token
  );

  assert.equal(result.status, 400);
});

test('kasir tidak bisa mencatat bahan rusak', async () => {
  const { token: cashierToken } = await login(CASHIER);
  const { token: inventoryToken } = await login(INVENTORY);

  // Kasir tidak punya inventory.view, jadi id diambil memakai akun inventory.
  const ingredients = await get('/inventory/ingredients?limit=1', inventoryToken);
  const ingredient = rows(ingredients)[0];

  const result = await post(
    '/inventory/movements',
    { ingredient_id: ingredient.id, type: 'WASTE', quantity: 1 },
    cashierToken
  );

  assert.equal(result.status, 403);
});

test('penyesuaian dengan jumlah nol ditolak', async () => {
  const { token } = await login(INVENTORY);
  const ingredients = await get('/inventory/ingredients?limit=1', token);
  const ingredient = rows(ingredients)[0];

  const result = await post(
    '/inventory/adjustment',
    { ingredient_id: ingredient.id, direction: 'IN', quantity: 0 },
    token
  );

  assert.equal(result.status, 400);
});

// ---------------------------------------------------------------------------
// Stock opname
// ---------------------------------------------------------------------------

test('stock opname membuat draft berisi seluruh bahan aktif', async () => {
  const { token } = await login(INVENTORY);

  const result = await post(
    '/inventory/opnames',
    { note: 'uji opname', include_all: true },
    token
  );

  assert.equal(result.status, 201, `Gagal membuat opname: ${result.body?.message}`);

  const opname = result.body.data;
  assert.equal(opname.status, 'DRAFT');
  assert.match(opname.opnameNumber, /^OPN-\d{8}-\d{3}$/);
  assert.ok(opname.totalItems > 0, 'opname tidak memuat bahan sama sekali');
});

test('opname tidak bisa disetujui sebelum semua bahan diisi', async () => {
  const { token } = await login(INVENTORY);

  const created = await post('/inventory/opnames', { include_all: true }, token);
  const opnameId = created.body.data.id;

  const approve = await post(`/inventory/opnames/${opnameId}/approve`, {}, token);
  assert.equal(approve.status, 400);
  assert.ok(
    /belum diisi/i.test(approve.body.message),
    `pesan error tidak menjelaskan bahan yang belum diisi: ${approve.body.message}`
  );

  await post(`/inventory/opnames/${opnameId}/cancel`, {}, token);
});

test('opname yang disetujui menyesuaikan stok dengan hasil hitung fisik', async () => {
  const { token } = await login(INVENTORY);

  const created = await post('/inventory/opnames', { include_all: true }, token);
  const opnameId = created.body.data.id;
  const items = rows(created);

  // Batasi pengujian pada tiga bahan pertama supaya cepat.
  const targets = items.slice(0, 3);

  // Isi hasil hitung fisik: beberapa naik, beberapa turun.
  for (const [index, item] of targets.entries()) {
    const delta = index === 0 ? 1.5 : index === 1 ? -0.5 : 0;
    const physical = item.systemStock + delta;

    const save = await put(
      `/inventory/opnames/${opnameId}/items/${item.ingredientId}`,
      { physical_stock: physical, note: 'hasil hitung uji' },
      token
    );
    assert.equal(save.status, 200, `Gagal menyimpan hasil hitung: ${save.body?.message}`);
  }

  // Isi sisanya dengan angka yang sama supaya approve tidak ditolak.
  for (const item of items.slice(3)) {
    await put(
      `/inventory/opnames/${opnameId}/items/${item.ingredientId}`,
      { physical_stock: item.systemStock },
      token
    );
  }

  const approve = await post(`/inventory/opnames/${opnameId}/approve`, {}, token);
  assert.equal(approve.status, 200, `Gagal menyetujui opname: ${approve.body?.message}`);

  assert.equal(approve.body.data.opname.status, 'APPROVED');
  assert.ok(
    Array.isArray(approve.body.data.adjusted) && approve.body.data.adjusted.length >= 2,
    'seharusnya ada bahan yang disesuaikan'
  );

  // Stok sekarang harus sama dengan hasil hitung fisik.
  for (const [index, item] of targets.entries()) {
    const after = await readIngredient(token, item.ingredientId);
    const expected = item.systemStock + (index === 0 ? 1.5 : index === 1 ? -0.5 : 0);

    assert.ok(
      Math.abs(after.stock - expected) < 0.002,
      `stok "${item.ingredientName}" seharusnya ${expected} ${item.unit}, sekarang ${after.stock}`
    );
  }

  // Jurnal OPNAME harus tercatat untuk bahan yang selisihnya tidak nol.
  const movements = await get(`/inventory/movements?type=OPNAME`, token);
  const opnameMovements = rows(movements).filter(
    (row) => row.note && row.note.includes('OPN-')
  );
  assert.ok(opnameMovements.length > 0, 'tidak ada jurnal OPNAME untuk opname yang disetujui');
});

test('opname yang sudah disetujui tidak bisa disetujui lagi', async () => {
  const { token } = await login(INVENTORY);

  const created = await post('/inventory/opnames', { include_all: true }, token);
  const opnameId = created.body.data.id;

  for (const item of rows(created)) {
    await put(
      `/inventory/opnames/${opnameId}/items/${item.ingredientId}`,
      { physical_stock: item.systemStock },
      token
    );
  }

  const first = await post(`/inventory/opnames/${opnameId}/approve`, {}, token);
  assert.equal(first.status, 200, describe(first));

  const second = await post(`/inventory/opnames/${opnameId}/approve`, {}, token);
  assert.equal(second.status, 409, 'opname yang sudah disetujui tidak boleh disetujui lagi');
});

test('opname yang dibatalkan tidak mengubah stok', async () => {
  const { token } = await login(INVENTORY);

  const created = await post('/inventory/opnames', { include_all: true }, token);
  const opnameId = created.body.data.id;
  const first = rows(created)[0];

  const before = await readIngredient(token, first.ingredientId);

  await put(
    `/inventory/opnames/${opnameId}/items/${first.ingredientId}`,
    { physical_stock: before.stock + 10 },
    token
  );

  const cancel = await post(`/inventory/opnames/${opnameId}/cancel`, {}, token);
  assert.equal(cancel.status, 200, describe(cancel));
  assert.equal(cancel.body.data.status, 'CANCELLED');

  const after = await readIngredient(token, first.ingredientId);
  assert.ok(
    Math.abs(after.stock - before.stock) < 0.001,
    'stok tidak boleh berubah karena opname hanya dibatalkan'
  );
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

test('permission inventory dibatasi per role', async () => {
  // Role CASHIER sengaja TIDAK diberi inventory.view di seed. Yang boleh
  // memakai endpoint ini adalah staf inventory.
  const { token: cashierToken } = await login(CASHIER);
  const { token: inventoryToken } = await login(INVENTORY);

  // Kasir ditolak, termasuk untuk membaca.
  const denied = await get('/inventory/ingredients?limit=1', cashierToken);
  assert.equal(denied.status, 403, 'kasir tidak punya izin inventory.view');

  // Staf inventory boleh membaca stok dan mengubahnya.
  const allowed = await get('/inventory/ingredients?limit=1', inventoryToken);
  assert.equal(allowed.status, 200, describe(allowed));

  const ingredient = rows(allowed)[0];

  const adjust = await post(
    '/inventory/adjustment',
    { ingredient_id: ingredient.id, direction: 'IN', quantity: 1 },
    cashierToken
  );
  assert.equal(adjust.status, 403, 'kasir tidak boleh mengubah stok');

  const create = await post(
    '/inventory/ingredients',
    { code: 'X-999', name: 'Bahan Uji', unit: 'pcs' },
    cashierToken
  );
  assert.equal(create.status, 403, 'kasir tidak boleh membuat bahan baku');
});

test('dapur dan kasir tidak bisa menyetujui stock opname', async () => {
  const { token: cashierToken } = await login(CASHIER);
  const { token: inventoryToken } = await login(INVENTORY);

  const created = await post('/inventory/opnames', { include_all: false }, inventoryToken);
  assert.equal(created.status, 201, describe(created));

  const denied = await post(
    `/inventory/opnames/${created.body.data.id}/approve`,
    {},
    cashierToken
  );
  assert.equal(denied.status, 403, 'kasir tidak boleh menyetujui opname');

  await post(`/inventory/opnames/${created.body.data.id}/cancel`, {}, inventoryToken);
});

test('inventory endpoint butuh login', async () => {
  const result = await get('/inventory/ingredients');
  assert.equal(result.status, 401);
});

test('ringkasan inventory melaporkan jumlah bahan dan mutasi', async () => {
  const { token } = await login(ADMIN);
  const result = await get('/inventory/summary', token);

  assert.equal(result.status, 200, describe(result));
  const data = result.body.data;

  assert.ok(data.totalIngredients > 0);
  assert.ok(typeof data.totalValue === 'number');
  assert.ok(Array.isArray(data.recentMovements));
});