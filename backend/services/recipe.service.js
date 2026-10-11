'use strict';

/**
 * Service Recipe / Bill of Materials (BOM).
 *
 * Recipe menjawab pertanyaan: "untuk membuat 1 porsi Nasi Goreng, bahan apa saja
 * yang dibutuhkan dan berapa banyak?"
 *
 * Setiap produk punya paling banyak satu recipe aktif. Recipe berisi baris
 * recipe_items yang menunjuk bahan baku.
 *
 * PERHITUNGAN KEBUTUHAN
 *   kebutuhan per porsi = quantity / yield_quantity
 *   kebutuhan efektif   = kebutuhan per porsi x (1 + waste_percent / 100)
 *
 * Contoh:
 *   yield_quantity = 1, quantity = 150 gram, waste = 5%
 *   -> 1 porsi butuh 150 x 1.05 = 157.5 gram
 *
 *   yield_quantity = 10 (satu batch = 10 porsi), quantity = 1500 gram
 *   -> 1 porsi butuh 1500/10 = 150 gram, x 1.05 = 157.5 gram
 */

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const { round } = require('../utils/money');
const ingredientService = require('./ingredient.service');

const QTY_DECIMALS = 3;

/**
 * Recipe sebuah produk beserta seluruh baris bahannya.
 *
 * @param {number} productId
 * @returns {Promise<object|null>}
 */
async function findByProduct(productId) {
  const [recipeRows] = await query(
    `SELECT id, product_id, name, yield_quantity, note, is_active,
            created_at, updated_at
       FROM recipes
      WHERE product_id = ?
        AND is_active = 1
      LIMIT 1`,
    [productId]
  );
  if (recipeRows.length === 0) return null;

  const recipe = recipeRows[0];
  const items = await loadItems(recipe.id);

  return decorateRecipe(recipe, items);
}

/**
 * Semua recipe beserta produknya. Berguna untuk halaman daftar komposisi.
 * @param {object} [filters]
 */
async function list(filters = {}) {
  const conditions = ['r.is_active = 1'];
  const params = [];

  if (filters.productId) {
    conditions.push('r.product_id = ?');
    params.push(Number(filters.productId));
  }
  if (filters.search) {
    conditions.push('(r.name LIKE ? OR p.name LIKE ?)');
    const keyword = `%${filters.search}%`;
    params.push(keyword, keyword);
  }

  const [recipes] = await query(
    `SELECT r.id, r.product_id, r.name, r.yield_quantity, r.note, r.is_active,
            r.created_at, r.updated_at,
            p.name AS product_name, p.code AS product_code, p.is_active AS product_active
       FROM recipes r
       JOIN products p ON p.id = r.product_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.name ASC`,
    params
  );

  // Baris bahan diambil sekaligus supaya tidak ada query per recipe.
  if (recipes.length === 0) return [];

  const ids = recipes.map((recipe) => recipe.id);
  const itemsByRecipe = await loadItemsForMany(ids);

  return recipes.map((recipe) =>
    decorateRecipe(recipe, itemsByRecipe.get(recipe.id) || [])
  );
}

/**
 * Buat atau perbarui recipe beserta baris bahannya.
 * Baris lama yang tidak lagi ada akan dihapus, jadi pemanggil cukup mengirim
 * daftar lengkap.
 *
 * @param {number} productId
 * @param {object} data
 * @param {string} [data.name]
 * @param {number} [data.yield_quantity]
 * @param {string} [data.note]
 * @param {boolean} [data.is_active]
 * @param {Array<{ingredient_id:number, quantity:number, waste_percent?:number, note?:string}>} data.items
 * @returns {Promise<object>}
 */
async function save(productId, data) {
  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) {
    throw ApiError.badRequest('Recipe harus memiliki minimal satu bahan baku.');
  }

  // Cek ingredient sekaligus, sekaligus memastikan tidak ada bahan yang sama
  // disebut dua kali (bakal bentrok dengan unique key).
  const ingredientIds = items.map((item) => Number(item.ingredient_id));
  const ingredients = await ingredientService.findByIds(ingredientIds);

  const duplicates = ingredientIds.filter(
    (id, index) => ingredientIds.indexOf(id) !== index
  );
  if (duplicates.length > 0) {
    throw ApiError.badRequest(
      `Bahan dengan id ${[...new Set(duplicates)].join(', ')} disebut lebih dari sekali.`
    );
  }

  const preparedItems = [];
  for (const item of items) {
    const ingredient = ingredients.get(Number(item.ingredient_id));
    if (!ingredient) {
      throw ApiError.badRequest(`Bahan baku #${item.ingredient_id} tidak ditemukan.`);
    }
    if (!ingredient.isActive) {
      throw ApiError.badRequest(
        `Bahan "${ingredient.name}" sedang nonaktif dan tidak bisa dipakai di recipe.`
      );
    }

    const quantity = round(Number(item.quantity), QTY_DECIMALS);
    if (!(quantity > 0)) {
      throw ApiError.badRequest(`Takaran untuk "${ingredient.name}" harus lebih besar dari nol.`);
    }
    if (quantity > 1_000_000) {
      throw ApiError.badRequest(`Takaran untuk "${ingredient.name}" tidak wajar.`);
    }

    const waste = round(Number(item.waste_percent ?? 0), 2);
    if (waste < 0 || waste > 100) {
      throw ApiError.badRequest('Susuan (waste) harus antara 0 dan 100 persen.');
    }

    preparedItems.push({
      ingredientId: ingredient.id,
      quantity,
      wastePercent: waste,
      note: item.note ? String(item.note).slice(0, 255) : null,
    });
  }

  const yieldQuantity = round(Number(data.yield_quantity ?? 1), QTY_DECIMALS);
  if (!(yieldQuantity > 0)) {
    throw ApiError.badRequest('Jumlah hasil recipe harus lebih besar dari nol.');
  }

  const [productRows] = await query(
    `SELECT id, name FROM products WHERE id = ? LIMIT 1`,
    [productId]
  );
  if (productRows.length === 0) throw ApiError.notFound('Produk tidak ditemukan.');

  const recipeName = (data.name && String(data.name).trim())
    || `Recipe ${productRows[0].name}`;

  const recipeId = await withTransaction(async (conn) => {
    // Recipe aktif produk ini, kalau ada.
    const [existing] = await conn.execute(
      `SELECT id FROM recipes WHERE product_id = ? AND is_active = 1 LIMIT 1`,
      [productId]
    );

    let id;

    if (existing.length > 0) {
      id = existing[0].id;
      await conn.execute(
        `UPDATE recipes
            SET name = ?, yield_quantity = ?, note = ?, is_active = ?
          WHERE id = ?`,
        [
          recipeName,
          yieldQuantity,
          data.note ? String(data.note).slice(0, 500) : null,
          data.is_active === false ? 0 : 1,
          id,
        ]
      );

      // Hapus semua baris lama lalu tulis ulang. Recipe jarang diubah dan
      // jumlahnya kecil, jadi cara sederhana ini paling mudah dijaga benar.
      await conn.execute(`DELETE FROM recipe_items WHERE recipe_id = ?`, [id]);
    } else {
      const [result] = await conn.execute(
        `INSERT INTO recipes (product_id, name, yield_quantity, note, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        [
          productId,
          recipeName,
          yieldQuantity,
          data.note ? String(data.note).slice(0, 500) : null,
          data.is_active === false ? 0 : 1,
        ]
      );
      id = result.insertId;
    }

    for (const item of preparedItems) {
      await conn.execute(
        `INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, waste_percent, note)
         VALUES (?, ?, ?, ?, ?)`,
        [id, item.ingredientId, item.quantity, item.wastePercent, item.note]
      );
    }

    return id;
  });

  const recipe = await findRecipeById(recipeId);
  return recipe;
}

/**
 * @param {number} recipeId
 */
async function findRecipeById(recipeId) {
  const [rows] = await query(
    `SELECT r.id, r.product_id, r.name, r.yield_quantity, r.note, r.is_active,
            r.created_at, r.updated_at,
            p.name AS product_name, p.code AS product_code
       FROM recipes r
       JOIN products p ON p.id = r.product_id
      WHERE r.id = ?
      LIMIT 1`,
    [recipeId]
  );
  if (rows.length === 0) return null;

  return decorateRecipe(rows[0], await loadItems(rows[0].id));
}

/**
 * Nonaktifkan recipe. Stok bahan yang sudah terpakai tidak dikembalikan;
 * pembatalan order lewat modul order yang seharusnya mengembalikannya.
 *
 * @param {number} productId
 */
async function deactivate(productId) {
  const [result] = await query(
    `UPDATE recipes SET is_active = 0 WHERE product_id = ? AND is_active = 1`,
    [productId]
  );
  if (result.affectedRows === 0) {
    throw ApiError.notFound('Recipe aktif untuk produk ini tidak ditemukan.');
  }
  return { productId: Number(productId), isActive: false };
}

/**
 * Kebutuhan bahan untuk sejumlah porsi produk.
 *
 * Mengembalikan Map<ingredientId, { ingredient, quantity, components }> dengan
 * quantity dalam satuan dasar bahan, sehingga bahan berbeda bisa dijumlahkan.
 *
 * @param {number} productId
 * @param {number} portions
 * @returns {Promise<Map<number, object>>}
 */
async function requiredFor(productId, portions) {
  const recipe = await findByProduct(productId);
  if (!recipe) return new Map();

  return aggregate(recipe, portions);
}

/**
 * Kebutuhan bahan untuk BANYAK produk sekaligus dalam satu query.
 * Dipakai saat memproses satu order yang berisi banyak baris.
 *
 * @param {Array<{productId:number, quantity:number}>} lines
 * @returns {Promise<Map<number, object>>}
 */
async function requiredForMany(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return new Map();

  const productIds = [...new Set(lines.map((line) => Number(line.productId)))];

  const [recipes] = await query(
    `SELECT r.id, r.product_id, r.name, r.yield_quantity, r.note, r.is_active
       FROM recipes r
      WHERE r.product_id IN (${productIds.map(() => '?').join(',')})
        AND r.is_active = 1`,
    productIds
  );

  if (recipes.length === 0) return new Map();

  const itemsByRecipe = await loadItemsForMany(recipes.map((recipe) => recipe.id));
  const recipeMap = new Map(
    recipes.map((recipe) => [Number(recipe.product_id), {
      ...recipe,
      items: itemsByRecipe.get(recipe.id) || [],
    }])
  );

  const combined = new Map();

  for (const line of lines) {
    const recipe = recipeMap.get(Number(line.productId));
    if (!recipe) continue;

    for (const [ingredientId, need] of aggregate(recipe, Number(line.quantity))) {
      const current = combined.get(ingredientId);

      if (!current) {
        combined.set(ingredientId, { ...need });
        continue;
      }

            // Bahan yang sama dipakai dua baris dalam satu order digabung.
      current.quantity = round(current.quantity + need.quantity, QTY_DECIMALS);
      current.quantityInBaseUnit = round(
        current.quantityInBaseUnit + need.quantityInBaseUnit,
        QTY_DECIMALS
      );
      current.portions += need.portions;
      if (!current.components.some((c) => c.orderItemId === need.components[0].orderItemId)) {
        current.components.push(...need.components);
      }
    }
  }

  return combined;
}

/**
 * Jumlahkan kebutuhan bahan dari satu recipe untuk sejumlah porsi.
 *
 * @param {object} recipe  hasil decorateRecipe
 * @param {number} portions
 * @returns {Map<number, object>}
 */
function aggregate(recipe, portions) {
  const result = new Map();
  const yieldQuantity = Number(recipe.yieldQuantity) || 1;

  for (const item of recipe.items) {
    const perPortion = item.quantity / yieldQuantity;
    const withWaste = perPortion * (1 + item.wastePercent / 100);
    const needed = round(withWaste * portions, QTY_DECIMALS);

    if (!(needed > 0)) continue;

    const current = result.get(item.ingredientId);
    if (current) {
      current.quantity = round(current.quantity + needed, QTY_DECIMALS);
      current.quantityInBaseUnit = round(
        current.quantityInBaseUnit + item.quantityInBaseUnit * portions,
        QTY_DECIMALS
      );
      current.portions += portions;
    } else {
      result.set(item.ingredientId, {
        ingredientId: item.ingredientId,
        ingredient: item.ingredient,
        unit: item.unit,
        quantity: needed,
        quantityInBaseUnit: round(item.quantityInBaseUnit * portions, QTY_DECIMALS),
        portions,
        components: [
          {
            ingredientName: item.ingredient.name,
            unit: item.unit,
            perPortion: round(perPortion, QTY_DECIMALS),
            wastePercent: item.wastePercent,
            portions,
          },
        ],
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** @param {number} recipeId */
async function loadItems(recipeId) {
  const grouped = await loadItemsForMany([recipeId]);
  return grouped.get(recipeId) || [];
}

/**
 * Ambil baris recipe untuk banyak recipe sekaligus.
 * @param {number[]} recipeIds
 * @returns {Promise<Map<number, object[]>>}
 */
async function loadItemsForMany(recipeIds) {
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) return new Map();

  const [rows] = await query(
    `SELECT ri.recipe_id, ri.id, ri.ingredient_id, ri.quantity, ri.waste_percent, ri.note,
            i.code AS ingredient_code, i.name AS ingredient_name,
            i.unit, i.stock, i.minimum_stock, i.is_active
       FROM recipe_items ri
       JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_id IN (${recipeIds.map(() => '?').join(',')})
      ORDER BY i.name ASC`,
    recipeIds
  );

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.recipe_id) || [];

    list.push({
      id: Number(row.id),
      ingredientId: Number(row.ingredient_id),
      ingredient: {
        id: Number(row.ingredient_id),
        code: row.ingredient_code,
        name: row.ingredient_name,
        unit: row.unit,
        stock: round(Number(row.stock), QTY_DECIMALS),
        minimumStock: round(Number(row.minimum_stock), QTY_DECIMALS),
        isActive: Boolean(row.is_active),
      },
      unit: row.unit,
      quantity: round(Number(row.quantity), QTY_DECIMALS),
      quantityInBaseUnit: ingredientService.toBaseUnit(row.quantity, row.unit),
      wastePercent: round(Number(row.waste_percent), 2),
      note: row.note,
    });

    grouped.set(row.recipe_id, list);
  }

  return grouped;
}

function decorateRecipe(row, items) {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    productCode: row.product_code,
    name: row.name,
    yieldQuantity: round(Number(row.yield_quantity), QTY_DECIMALS),
    note: row.note,
    isActive: Boolean(row.is_active),
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  QTY_DECIMALS,
  findByProduct,
  findRecipeById,
  list,
  save,
  deactivate,
  requiredFor,
  requiredForMany,
};