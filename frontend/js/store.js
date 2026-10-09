/**
 * State keranjang di sisi klien.
 *
 * Keranjang disimpan di localStorage dengan kunci per-meja supaya dua meja
 * yang kebetulan memakai browser sama tidak saling menimpa.
 *
 * PENTING: keranjang hanya menyimpan kuantitas dan pilihan varian. Harga
 * TIDAK disimpan sebagai sumber kebenaran - saat checkout, server menghitung
 * ulang harga dari database. Data harga yang tersimpan di sini hanya dipakai
 * untuk menampilkan perkiraan di layar.
 */

const STORAGE_PREFIX = 'sr_cart_';

/**
 * @typedef {object} CartItem
 * @property {number} productId
 * @property {number|null} variantId
 * @property {string} variantName
 * @property {string} productName
 * @property {number} unitPrice    harga SATUAN (display only)
 * @property {number} quantity
 * @property {string} note
 * @property {Array<{id:number,name:string,price:number,quantity:number}>} addons
 */

/**
 * @param {string} scope  biasanya kode meja, atau "pos" untuk kasir
 * @returns {{items: CartItem[], tableCode: string|null}}
 */
export function readCart(scope) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return { items: [], tableCode: null };
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      tableCode: parsed.tableCode ?? null,
    };
  } catch {
    return { items: [], tableCode: null };
  }
}

/**
 * @param {string} scope
 * @param {{items: CartItem[], tableCode?: string}} cart
 */
export function writeCart(scope, cart) {
  localStorage.setItem(
    STORAGE_PREFIX + scope,
    JSON.stringify({ items: cart.items, tableCode: cart.tableCode ?? null })
  );
}

/** @param {string} scope */
export function clearCart(scope) {
  localStorage.removeItem(STORAGE_PREFIX + scope);
}

/**
 * Kunci unik sebuah baris keranjang.
 * Produk + varian + pilihan addon menentukan identitas baris.
 */
function itemKey(item) {
  const addonKey = (item.addons || [])
    .map((addon) => `${addon.id}x${addon.quantity}`)
    .sort()
    .join(',');
  return `${item.productId}:${item.variantId ?? 0}:${addonKey}`;
}

/**
 * Tambah produk ke keranjang.
 * Bila baris dengan kombinasi yang sama sudah ada, quantity-nya dijumlahkan.
 *
 * @param {string} scope
 * @param {object} product
 * @param {object} [options]
 * @param {number} [options.quantity=1]
 * @param {object} [options.variant]
 * @param {Array} [options.addons]
 * @param {string} [options.note]
 * @returns {{items: CartItem[], added: boolean, item: CartItem}}
 */
export function addItem(scope, product, options = {}) {
  const { quantity = 1, variant = null, addons = [], note = '' } = options;
  const cart = readCart(scope);

  const unitPrice = variant?.price ?? product.price;
  let line = {
    productId: product.id,
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? '',
    productName: product.name,
    unitPrice,
    quantity,
    note,
    addons: addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      price: addon.price,
      quantity: addon.quantity,
    })),
  };

  const key = itemKey(line);
  const existingIndex = cart.items.findIndex((item) => itemKey(item) === key);

  let added = false;
  if (existingIndex >= 0) {
    cart.items[existingIndex].quantity += quantity;
    line = cart.items[existingIndex];
    added = true;
  } else {
    cart.items.push(line);
    added = false;
  }

  writeCart(scope, cart);
  return { items: cart.items, added, item: line };
}

/**
 * Ubah quantity sebuah baris.
 * @param {string} scope
 * @param {number} index
 * @param {number} quantity  0 atau kurang berarti hapus baris
 */
export function updateQuantity(scope, index, quantity) {
  const cart = readCart(scope);
  if (index < 0 || index >= cart.items.length) return cart.items;

  const next = Number(quantity);
  if (!Number.isFinite(next) || next <= 0) {
    cart.items.splice(index, 1);
  } else {
    cart.items[index].quantity = Math.min(99, Math.trunc(next));
  }

  writeCart(scope, cart);
  return cart.items;
}

/**
 * Ubah quantity sebuah addon di dalam satu baris.
 * @param {string} scope
 * @param {number} itemIndex
 * @param {number} addonId
 * @param {number} quantity
 */
export function updateAddonQuantity(scope, itemIndex, addonId, quantity) {
  const cart = readCart(scope);
  const item = cart.items[itemIndex];
  if (!item) return cart.items;

  const addon = item.addons.find((entry) => entry.id === addonId);
  if (!addon) return cart.items;

  const next = Number(quantity);
  if (!Number.isFinite(next) || next <= 0) {
    item.addons = item.addons.filter((entry) => entry.id !== addonId);
  } else {
    addon.quantity = Math.min(20, Math.trunc(next));
  }

  writeCart(scope, cart);
  return cart.items;
}

/** @param {string} scope @param {number} index */
export function removeItem(scope, index) {
  const cart = readCart(scope);
  cart.items.splice(index, 1);
  writeCart(scope, cart);
  return cart.items;
}

/**
 * Total item (bukan nilai uang).
 * @param {string} scope
 */
export function totalQuantity(scope) {
  return readCart(scope).items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Hitung perkiraan total untuk ditampilkan di layar.
 *
 * PERINGATAN: ini hanya estimasi tampilan. Total resmi dihitung ulang oleh
 * server, termasuk pajak dan service charge yang dikonfigurasi di backend.
 *
 * @param {string} scope
 * @param {{taxPercent?:number, serviceChargePercent?:number}} [options]
 */
export function estimateTotals(scope, options = {}) {
  const { taxPercent = 0, serviceChargePercent = 0 } = options;
  const cart = readCart(scope);

  const round2 = (value) => Math.round(value * 100) / 100;

  const subtotal = round2(
    cart.items.reduce((sum, item) => {
      const addonTotal = item.addons.reduce(
        (inner, addon) => inner + addon.price * addon.quantity,
        0
      );
      return sum + (item.unitPrice + addonTotal) * item.quantity;
    }, 0)
  );

  const tax = round2((subtotal * taxPercent) / 100);
  const serviceCharge = round2((subtotal * serviceChargePercent) / 100);

  return {
    subtotal,
    taxPercent,
    tax,
    serviceChargePercent,
    serviceCharge,
    total: round2(subtotal + tax + serviceCharge),
    itemCount: cart.items.length,
    quantity: cart.items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * Ubah keranjang menjadi payload POST /api/orders.
 * Harga sengaja TIDAK disertakan karena server mengabaikannya.
 *
 * @param {string} scope
 * @param {object} [extra]
 */
export function toOrderPayload(scope, extra = {}) {
  const cart = readCart(scope);

  return {
    ...extra,
    items: cart.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
      note: item.note || null,
      addons: (item.addons || []).map((addon) => ({
        id: addon.id,
        quantity: addon.quantity,
      })),
    })),
  };
}