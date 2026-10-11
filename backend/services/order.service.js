'use strict';

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const money = require('../utils/money');
const productService = require('./product.service');
const tableService = require('./table.service');
const inventoryService = require('./inventory.service');
const socket = require('../config/socket');
const notificationService = require('./notification.service');

/**
 * Service order: pembuatan, pembacaan, perpindahan status, pembatalan.
 *
 * ATURAN PENTING
 * 1. Harga dihitung ulang dari database. Nilai price yang dikirim frontend
 *    hanya dipakai sebagai pembanding dan tidak pernah dipercaya.
 * 2. Pembuatan order berjalan di dalam satu transaksi DB. Kalau salah satu
 *    item gagal, seluruh order dibatalkan (tidak ada order setengah jadi).
 * 3. Nilai total disimpan frozen di tabel orders. Struk lama tidak ikut berubah
 *    walaupun harga produk atau pengaturan pajak diubah setelah itu.
 */

/** Status berikutnya yang sah untuk setiap status saat ini. */
const TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Status yang masih actively diproses dapur. */
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];

// ---------------------------------------------------------------------------
// Pembuatan order
// ---------------------------------------------------------------------------

/**
 * @param {object} payload
 * @param {string} [payload.tableToken]   token dari QR scan
 * @param {number} [payload.table_id]      dipakai POS
 * @param {string} [payload.source]        'QR' | 'POS'
 * @param {object} [payload.customer]      { name, phone }
 * @param {Array} payload.items
 * @param {number} [payload.discount_percent]
 * @param {string} [payload.note]
 * @param {object|null} user               req.user, null untuk tamu QR
 * @returns {Promise<object>} order lengkap
 */
async function create(payload, user = null) {
  const source = payload.source === 'POS' ? 'POS' : 'QR';

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw ApiError.badRequest('Keranjang masih kosong. Tambahkan minimal satu produk.');
  }
  if (payload.items.length > 50) {
    throw ApiError.badRequest('Maksimal 50 baris item per order.');
  }

  const table = await resolveTable(payload, source);
  const customerId = await resolveCustomer(payload.customer);

  // Harga produk diambil ulang dari database sekaligus, bukan per item.
  const productIds = [...new Set(payload.items.map((item) => Number(item.product_id)))];
  const products = await productService.findByIds(productIds);

  const preparedItems = await prepareItems(payload.items, products);

  const totals = money.calculateOrderTotals(preparedItems, {
    discountPercent: resolveDiscount(payload.discount_percent, user),
    taxPercent: config.restaurant.taxPercent,
    serviceChargePercent: config.restaurant.serviceChargePercent,
  });

  if (totals.total <= 0) {
    throw ApiError.badRequest('Total order harus lebih besar dari nol.');
  }

  const orderId = await withTransaction(async (conn) => {
    // order_number diisi sementara dengan token acak supaya tidak bentrok,
    // lalu diganti menjadi format permanen berdasarkan id yang baru didapat.
    const temporaryNumber = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const [insertResult] = await conn.execute(
      `INSERT INTO orders
         (order_number, source, table_id, customer_id, created_by, status,
          subtotal, discount_percent, discount_amount,
          tax_percent, tax_amount,
          service_charge_percent, service_charge_amount,
          total, paid_amount, note)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        temporaryNumber,
        source,
        table ? table.id : null,
        customerId,
        user ? user.id : null,
        totals.subtotal,
        totals.discountPercent,
        totals.discountAmount,
        totals.taxPercent,
        totals.taxAmount,
        totals.serviceChargePercent,
        totals.serviceChargeAmount,
        totals.total,
        payload.note ?? null,
      ]
    );

    const newOrderId = insertResult.insertId;
    const orderNumber = buildOrderNumber(newOrderId);
    await conn.execute(`UPDATE orders SET order_number = ? WHERE id = ?`, [
      orderNumber,
      newOrderId,
    ]);

    for (const item of preparedItems) {
      const [itemResult] = await conn.execute(
        `INSERT INTO order_items
           (order_id, product_id, product_name, product_code,
            variant_id, variant_name, unit_price, quantity, line_total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newOrderId,
          item.productId,
          item.productName,
          item.productCode,
          item.variantId,
          item.variantName,
          item.unitPrice,
          item.quantity,
          item.lineTotal,
          item.note ?? null,
        ]
      );

      for (const addon of item.addons) {
        await conn.execute(
          `INSERT INTO order_item_addons
             (order_item_id, product_addon_id, addon_name, price, quantity, line_total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [itemResult.insertId, addon.id, addon.name, addon.price, addon.quantity, addon.lineTotal]
        );
      }
    }

    await conn.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES (?, NULL, 'PENDING', ?, ?)`,
      [newOrderId, user ? user.id : null, 'Order dibuat']
    );

    // Meja yang dipakai pesan lewat QR langsung ditandai terisi.
    if (table && source === 'QR') {
      await conn.execute(
        `UPDATE restaurant_tables SET status = 'OCCUPIED' WHERE id = ?`,
        [table.id]
      );
    }

    return newOrderId;
  });

  const order = await findById(orderId);

  await notificationService.notifyOrderCreated(order);
  socket.emitTo(socket.ROOMS.kitchen, 'order:new', order);
  socket.emitTo(socket.ROOMS.table(table ? table.code : 'umum'), 'order:new', order);

  return order;
}

/**
 * @param {string} orderId
 * @returns {string} contoh "ORD-20261008-00042"
 */
function buildOrderNumber(orderId) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `ORD-${yyyy}${mm}${dd}-${String(orderId).padStart(5, '0')}`;
}

/**
 * Tentukan meja dari token QR atau id meja.
 * @returns {Promise<object|null>}
 */
async function resolveTable(payload, source) {
  if (payload.tableToken) {
    const table = await tableService.resolveToken(payload.tableToken);
    if (!table) {
      throw ApiError.badRequest('QR meja tidak valid atau sudah dicabut. Silakan panggil kasir.');
    }
    if (table.status === 'DISABLED') {
      throw ApiError.badRequest('Meja ini sedang tidak dipakai untuk memesan.');
    }
    return table;
  }

  if (payload.table_id) {
    const table = await tableService.findById(Number(payload.table_id));
    if (!table) throw ApiError.badRequest('Meja yang dipilih tidak ditemukan.');
    if (!table.is_active) throw ApiError.badRequest('Meja yang dipilih sedang dinonaktifkan.');
    return table;
  }

  if (source === 'POS') {
    throw ApiError.badRequest('Order POS wajib menyertakan meja atau pelanggan tetap.');
  }
  return null;
}

/**
 * Pesanan tamu tidak wajib punya profil. Kalau nomor HP diberikan, profil
 * dibuat/dipakai ulang supaya riwayat pesanan bisa ditelusuri.
 * @returns {Promise<number|null>}
 */
async function resolveCustomer(customer) {
  if (!customer || !customer.phone) return null;

  const phone = String(customer.phone).trim();
  const [rows] = await query(`SELECT id FROM customers WHERE phone = ? LIMIT 1`, [phone]);
  if (rows.length > 0) return rows[0].id;

  const [result] = await query(
    `INSERT INTO customers (name, phone) VALUES (?, ?)`,
    [String(customer.name || 'Pelanggan').trim() || 'Pelanggan', phone]
  );
  return result.insertId;
}

/**
 * Diskon hanya boleh diberikan oleh staff. Tamu yang memesan lewat QR tidak
 * boleh menentukan diskon sendiri.
 */
function resolveDiscount(requested, user) {
  const value = money.toNumber(requested, 0);
  if (value === 0) return 0;

  const isStaff = user && user.roles && user.roles.some((role) =>
    ['CASHIER', 'MANAGER', 'ADMIN', 'OWNER'].includes(role)
  );
  if (!isStaff) return 0;

  return money.clampPercent(value);
}

/**
 * Validasi dan hitung setiap baris item memakai harga dari database.
 *
 * @param {Array} rawItems
 * @param {Map<number, object>} products
 */
async function prepareItems(rawItems, products) {
  const prepared = [];

  for (const raw of rawItems) {
    const productId = Number(raw.product_id);
    const product = products.get(productId);

    if (!product) {
      throw ApiError.badRequest(`Produk #${raw.product_id} tidak ditemukan.`);
    }
    if (!product.is_active) {
      throw ApiError.badRequest(`Produk "${product.name}" sudah tidak tersedia.`);
    }
    if (product.stock_status !== 'AVAILABLE') {
      throw ApiError.badRequest(`Produk "${product.name}" sedang kosong.`);
    }

    const quantity = Math.max(1, Math.trunc(money.toNumber(raw.quantity, 1)));
    if (quantity > 99) {
      throw ApiError.badRequest(`Quantity "${product.name}" maksimal 99 per baris.`);
    }

    const variant = await resolveVariant(productId, raw.variant_id);
    const unitPrice = money.round(variant ? variant.price : product.price);
    const addons = await resolveAddons(product, raw.addons);

    const line = money.calculateLineTotal({ unitPrice, quantity, addons });

    prepared.push({
      productId,
      productName: product.name,
      productCode: product.code,
      variantId: variant ? variant.id : null,
      variantName: variant ? variant.name : null,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      note: raw.note ? String(raw.note).slice(0, 255) : null,
      addons,
    });
  }

  return prepared;
}

/** @returns {Promise<object|null>} */
async function resolveVariant(productId, variantId) {
  if (!variantId) return null;

  const [rows] = await query(
    `SELECT id, name, price FROM product_variants
      WHERE id = ? AND product_id = ? AND is_active = 1
      LIMIT 1`,
    [Number(variantId), productId]
  );
  if (rows.length === 0) {
    throw ApiError.badRequest('Varian yang dipilih tidak tersedia untuk produk ini.');
  }

  // Varian tanpa harga memakai harga dasar produk. Price produk diambil dari
  // sini karena query varian tidak menyertakannya.
  if (rows[0].price === null) {
    const [productRows] = await query(`SELECT price FROM products WHERE id = ? LIMIT 1`, [productId]);
    return { id: rows[0].id, name: rows[0].name, price: money.round(productRows[0].price) };
  }

  return { id: rows[0].id, name: rows[0].name, price: money.round(rows[0].price) };
}

/**
 * Addon hanya boleh milik produk itu sendiri atau kategori produk tersebut.
 * @returns {Promise<Array<{id:number,name:string,price:number,quantity:number,lineTotal:number}>>}
 */
async function resolveAddons(product, rawAddons) {
  if (!Array.isArray(rawAddons) || rawAddons.length === 0) return [];

  const addonIds = [...new Set(rawAddons.map((addon) => Number(addon.id)))];
  if (addonIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw ApiError.badRequest('Addon yang dipilih tidak valid.');
  }

  const [rows] = await query(
    `SELECT id, product_id, category_id, name, price
       FROM product_addons
      WHERE id IN (${addonIds.map(() => '?').join(',')}) AND is_active = 1`,
    addonIds
  );

  const addonMap = new Map(rows.map((row) => [Number(row.id), row]));
  const resolved = [];

  for (const raw of rawAddons) {
    const id = Number(raw.id);
    const addon = addonMap.get(id);
    if (!addon) {
      throw ApiError.badRequest('Addon yang dipilih tidak tersedia.');
    }

    const belongsToProduct = Number(addon.product_id) === Number(product.id);
    const belongsToCategory = Number(addon.category_id) === Number(product.category_id);
    if (!belongsToProduct && !belongsToCategory) {
      throw ApiError.badRequest(
        `Addon "${addon.name}" tidak bisa dipilih untuk produk "${product.name}".`
      );
    }

    const quantity = Math.max(1, Math.trunc(money.toNumber(raw.quantity, 1)));
    if (quantity > 20) {
      throw ApiError.badRequest(`Quantity addon "${addon.name}" maksimal 20.`);
    }

    const price = money.round(addon.price);
    resolved.push({
      id,
      name: addon.name,
      price,
      quantity,
      lineTotal: money.round(price * quantity),
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Pembacaan
// ---------------------------------------------------------------------------

/**
 * @param {number} id
 * @param {object} [options]
 * @param {boolean} [options.withItems=true]
 */
async function findById(id, options = {}) {
  const [rows] = await query(
    `SELECT o.id, o.order_number, o.source, o.table_id, o.customer_id, o.created_by,
            o.status, o.subtotal, o.discount_percent, o.discount_amount,
            o.tax_percent, o.tax_amount, o.service_charge_percent,
            o.service_charge_amount, o.total, o.paid_amount, o.note,
            o.cancel_reason, o.cancelled_at, o.completed_at,
            o.created_at, o.updated_at,
            t.code AS table_code, t.name AS table_name,
            c.name AS customer_name, c.phone AS customer_phone,
            u.name AS created_by_name
       FROM orders o
       LEFT JOIN restaurant_tables t ON t.id = o.table_id
       LEFT JOIN customers c          ON c.id = o.customer_id
       LEFT JOIN users u              ON u.id = o.created_by
      WHERE o.id = ?
      LIMIT 1`,
    [Number(id)]
  );

  if (rows.length === 0) return null;

  const order = decorate(rows[0]);
  if (options.withItems === false) return order;

  order.items = await loadItems(order.id);
  order.payments = await loadPayments(order.id);
  order.history = await loadHistory(order.id);
  return order;
}

/** @param {number} orderId */
async function loadItems(orderId) {
  const [itemRows] = await query(
    `SELECT id, product_id, product_name, product_code, variant_id, variant_name,
            unit_price, quantity, line_total, note
       FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC`,
    [orderId]
  );
  if (itemRows.length === 0) return [];

  const itemIds = itemRows.map((row) => row.id);
  const [addonRows] = await query(
    `SELECT id, order_item_id, product_addon_id, addon_name, price, quantity, line_total
       FROM order_item_addons
      WHERE order_item_id IN (${itemIds.map(() => '?').join(',')})
      ORDER BY id ASC`,
    itemIds
  );

  const addonsByItem = new Map();
  for (const row of addonRows) {
    if (!addonsByItem.has(row.order_item_id)) addonsByItem.set(row.order_item_id, []);
    addonsByItem.get(row.order_item_id).push({
      id: Number(row.id),
      addonId: Number(row.product_addon_id),
      name: row.addon_name,
      price: money.round(row.price),
      quantity: Number(row.quantity),
      lineTotal: money.round(row.line_total),
    });
  }

  return itemRows.map((row) => ({
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    productCode: row.product_code,
    variantId: row.variant_id ? Number(row.variant_id) : null,
    variantName: row.variant_name,
    unitPrice: money.round(row.unit_price),
    quantity: Number(row.quantity),
    lineTotal: money.round(row.line_total),
    note: row.note,
    addons: addonsByItem.get(row.id) || [],
  }));
}

/** @param {number} orderId */
async function loadPayments(orderId) {
  const [rows] = await query(
    `SELECT id, order_id, method, amount, change_amount, status, refunded_amount,
            reference, note, paid_at
       FROM payments
      WHERE order_id = ?
      ORDER BY id ASC`,
    [orderId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    method: row.method,
    amount: money.round(row.amount),
    changeAmount: money.round(row.change_amount),
    status: row.status,
    refundedAmount: money.round(row.refunded_amount),
    reference: row.reference,
    note: row.note,
    paidAt: row.paid_at,
  }));
}

/** @param {number} orderId */
async function loadHistory(orderId) {
  const [rows] = await query(
    `SELECT h.id, h.from_status, h.to_status, h.note, h.created_at, u.name AS changed_by_name
       FROM order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = ?
      ORDER BY h.created_at ASC, h.id ASC`,
    [orderId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    from: row.from_status,
    to: row.to_status,
    note: row.note,
    at: row.created_at,
    by: row.changed_by_name,
  }));
}

/**
 * Daftar order dengan filter.
 *
 * @param {object} filters
 * @returns {Promise<{rows:object[], total:number}>}
 */
async function list(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (filters.source) { conditions.push('o.source = ?'); params.push(filters.source); }
  if (filters.tableId) { conditions.push('o.table_id = ?'); params.push(filters.tableId); }
  if (filters.customerId) { conditions.push('o.customer_id = ?'); params.push(filters.customerId); }
  if (filters.from) { conditions.push('o.created_at >= ?'); params.push(filters.from); }
  if (filters.to) { conditions.push('o.created_at <= ?'); params.push(filters.to); }
  if (filters.search) {
    conditions.push('(o.order_number LIKE ? OR t.code LIKE ? OR c.name LIKE ?)');
    const keyword = `%${filters.search}%`;
    params.push(keyword, keyword, keyword);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await query(
    `SELECT COUNT(*) AS total
       FROM orders o
       LEFT JOIN restaurant_tables t ON t.id = o.table_id
       LEFT JOIN customers c          ON c.id = o.customer_id
       ${where}`,
    params
  );

  const [rows] = await query(
    `SELECT o.id, o.order_number, o.source, o.table_id, o.customer_id, o.created_by,
            o.status, o.subtotal, o.discount_percent, o.discount_amount,
            o.tax_percent, o.tax_amount, o.service_charge_percent,
            o.service_charge_amount, o.total, o.paid_amount, o.note,
            o.cancel_reason, o.cancelled_at, o.completed_at,
            o.created_at, o.updated_at,
            t.code AS table_code, t.name AS table_name,
            c.name AS customer_name, c.phone AS customer_phone,
            u.name AS created_by_name
       FROM orders o
       LEFT JOIN restaurant_tables t ON t.id = o.table_id
       LEFT JOIN customers c          ON c.id = o.customer_id
       LEFT JOIN users u              ON u.id = o.created_by
       ${where}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 20, filters.offset ?? 0]
  );

  const orders = rows.map(decorate);

  // Ringkasan jumlah item per order tanpa query N+1.
  if (orders.length > 0) {
    const ids = orders.map((order) => order.id);
    const [countRows] = await query(
      `SELECT order_id, COUNT(*) AS item_count, SUM(quantity) AS total_quantity
         FROM order_items
        WHERE order_id IN (${ids.map(() => '?').join(',')})
        GROUP BY order_id`,
      ids
    );
    const countMap = new Map(countRows.map((row) => [Number(row.order_id), row]));
    for (const order of orders) {
      const summary = countMap.get(order.id);
      order.itemCount = summary ? Number(summary.item_count) : 0;
      order.totalQuantity = summary ? Number(summary.total_quantity) : 0;
    }
  }

  return { rows: orders, total: countRows[0].total };
}

/**
 * Order aktif untuk sebuah meja. Dipakai POS dan halaman lacak pesanan.
 * @param {number} tableId
 */
async function findActiveByTable(tableId) {
  const { rows } = await list({
    tableId: Number(tableId),
    status: ACTIVE_STATUSES,
    limit: 1,
  });
  if (rows.length === 0) return null;
  return findById(rows[0].id);
}

/**
 * Cari order milik seorang customer untuk halaman lacak pesanan.
 * @param {number} customerId
 */
async function findByCustomerAndNumber(customerId, orderNumber) {
  const [rows] = await query(
    `SELECT id FROM orders
      WHERE customer_id = ? AND order_number = ?
      LIMIT 1`,
    [customerId, orderNumber]
  );
  if (rows.length === 0) return null;
  return findById(rows[0].id);
}

// ---------------------------------------------------------------------------
// Perpindahan status
// ---------------------------------------------------------------------------

/**
 * @param {number} orderId
 * @param {string} nextStatus
 * @param {object|null} user
 * @param {string} [note]
 */
async function changeStatus(orderId, nextStatus, user = null, note = null) {
  const current = await findById(orderId, { withItems: false });
  if (!current) throw ApiError.notFound('Order tidak ditemukan.');

  const allowed = TRANSITIONS[current.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.conflict(
      `Status order tidak bisa diubah dari ${current.status} menjadi ${nextStatus}.`,
      { details: { currentStatus: current.status, requestedStatus: nextStatus, allowed } }
    );
  }

  // Hasil sinkronisasi stok, diisi di dalam transaksi lalu dibaca setelah COMMIT.
  let stockResult = null;

  await withTransaction(async (conn) => {
    const extraSql = nextStatus === 'COMPLETED' ? ', completed_at = NOW()' : '';
    await conn.execute(
      `UPDATE orders SET status = ?${extraSql} WHERE id = ? AND status = ?`,
      [nextStatus, orderId, current.status]
    );

    await conn.execute(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES (?, ?, ?, ?, ?)`,
      [orderId, current.status, nextStatus, user ? user.id : null, note]
    );

    // Meja kembali tersedia setelah order selesai atau batal.
    if (nextStatus === 'COMPLETED' && current.table_id) {
      const [remaining] = await conn.execute(
        `SELECT COUNT(*) AS total FROM orders
          WHERE table_id = ? AND status IN ('PENDING','CONFIRMED','PREPARING','READY')`,
        [current.table_id]
      );
      if (remaining[0].total === 0) {
        await conn.execute(
          `UPDATE restaurant_tables SET status = 'AVAILABLE' WHERE id = ?`,
          [current.table_id]
        );
      }
    }

    // ---- Fase 4: sinkronkan stok bahan baku ----
    // Pengurangan stok dilakukan saat order DITERIMA (CONFIRMED), bukan saat
    // order dibuat, supaya order yang dibatalkan sebelum dibayar tidak pernah
    // memakai bahan baku.
    //
    // Operasi ini berada di dalam transaksi yang sama dengan perubahan status,
    // sehingga status order dan stok tidak mungkin tidak sinkron.
    if (nextStatus === 'CONFIRMED') {
      stockResult = await inventoryService.deductForOrder(conn, orderId, user);
    }
  });

  const updated = await findById(orderId);

  // Notifikasi stok dikirim setelah COMMIT supaya client tidak pernah
  // menerima notifikasi untuk perubahan yang ternyata di-rollback.
  if (stockResult && stockResult.deducted?.length > 0) {
    socket.emitTo('inventory', 'stock:changed', {
      orderId: Number(orderId),
      orderNumber: updated.orderNumber,
      movements: stockResult.deducted,
    });

    for (const movement of stockResult.deducted) {
      await inventoryService.afterStockChange({
        ingredientId: movement.ingredientId,
        stockAfter: movement.stockAfter,
      });
    }
  }

  // Kabari semua pihak yang saat status berubah.
  socket.emitTo(socket.ROOMS.kitchen, 'order:updated', updated);
  socket.emitTo(socket.ROOMS.order(orderId), 'order:status', {
    orderId: Number(orderId),
    orderNumber: updated.orderNumber,
    status: updated.status,
    updatedAt: updated.updatedAt,
  });
  socket.emitTo(socket.ROOMS.dashboard, 'order:updated', updated);

  return updated;
}

/**
 * Batalkan / void order.
 *
 * Pembatalan hanya bisa dilakukan kalau order belum masuk status COMPLETED.
 * Order yang sudah selesai harus lewat jalur refund, bukan void.
 *
 * @param {number} orderId
 * @param {string} reason
 * @param {object|null} user
 */
async function cancel(orderId, reason, user = null) {
  const current = await findById(orderId, { withItems: false });
  if (!current) throw ApiError.notFound('Order tidak ditemukan.');

  if (current.status === 'COMPLETED') {
    throw ApiError.conflict(
      'Order yang sudah selesai tidak bisa dibatalkan. Gunakan fitur refund.'
    );
  }
  if (current.status === 'CANCELLED') {
    throw ApiError.conflict('Order ini sudah dibatalkan sebelumnya.');
  }

  // Order yang sudah dibayar harus direfund lebih dulu supaya uang pelanggan
  // tidak hilang tanpa jejak.
  if (money.round(current.paidAmount) > 0) {
    throw ApiError.conflict(
      'Order ini sudah ada pembayarannya. Lakukan refund terlebih dahulu sebelum membatalkan.',
      { code: 'PAID_ORDER' }
    );
  }

  // Stok bahan baku yang sempat terpakai dikembalikan, karena order
  // ini pernah menyentuh status CONFIRMED.
  let stockResult = null;

  await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE orders
            SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?
          WHERE id = ?`,
        [user ? user.id : null, reason || null, orderId]
      );

      await conn.execute(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
         VALUES (?, ?, 'CANCELLED', ?, ?)`,
        [orderId, current.status, user ? user.id : null, reason]
      );

      if (current.tableId) {
        await conn.execute(
          `UPDATE restaurant_tables SET status = 'AVAILABLE' WHERE id = ?`,
          [current.tableId]
        );
      }

      // ---- Fase 4: kembalikan stok bahan baku ----
      // Fungsi ini idempoten, jadi order yang batal dua kali tidak akan
      // mengembalikan bahan dua kali.
      stockResult = await inventoryService.restoreForOrder(conn, orderId, user);
    });

  const updated = await findById(orderId);

  if (stockResult && stockResult.restored?.length > 0) {
    socket.emitTo('inventory', 'stock:changed', {
      orderId: Number(orderId),
      orderNumber: updated.orderNumber,
      restored: stockResult.restored,
    });

    for (const movement of stockResult.restored) {
      await inventoryService.afterStockChange({
        ingredientId: movement.ingredientId,
        stockAfter: movement.stockAfter,
      });
    }
  }

  socket.emitTo(socket.ROOMS.kitchen, 'order:updated', updated);
  socket.emitTo(socket.ROOMS.order(orderId), 'order:status', {
    orderId: Number(orderId),
    orderNumber: updated.orderNumber,
    status: updated.status,
    updatedAt: updated.updatedAt,
  });

  return updated;
}

/**
 * Validasi apakah perpindahan status diizinkan.
 * Dipakai juga oleh frontend untuk menentukan tombol mana yang aktif.
 *
 * @param {string} currentStatus
 * @param {string} nextStatus
 */
function canTransition(currentStatus, nextStatus) {
  return (TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

/** @returns {string[]} status berikutnya yang sah dari status sekarang */
function nextStatuses(currentStatus) {
  return TRANSITIONS[currentStatus] || [];
}

function decorate(row) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    source: row.source,
    tableId: row.table_id ? Number(row.table_id) : null,
    tableCode: row.table_code,
    tableName: row.table_name,
    customerId: row.customer_id ? Number(row.customer_id) : null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    createdBy: row.created_by ? Number(row.created_by) : null,
    createdByName: row.created_by_name,
    status: row.status,
    subtotal: money.round(row.subtotal),
    discountPercent: money.round(row.discount_percent),
    discountAmount: money.round(row.discount_amount),
    taxPercent: money.round(row.tax_percent),
    taxAmount: money.round(row.tax_amount),
    serviceChargePercent: money.round(row.service_charge_percent),
    serviceChargeAmount: money.round(row.service_charge_amount),
    total: money.round(row.total),
    paidAmount: money.round(row.paid_amount),
    balanceDue: money.round(row.total - row.paid_amount),
    note: row.note,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextStatuses: nextStatuses(row.status),
  };
}

module.exports = {
  create,
  findById,
  list,
  findActiveByTable,
  findByCustomerAndNumber,
  changeStatus,
  cancel,
  canTransition,
  nextStatuses,
  buildOrderNumber,
  loadItems,
  TRANSITIONS,
  ACTIVE_STATUSES,
};
