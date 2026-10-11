'use strict';

const recipeService = require('../services/recipe.service');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/** Controller Recipe / BOM. */

/** GET /api/inventory/recipes */
async function list(req, res) {
  const recipes = await recipeService.list({
    productId: req.query.product_id ? Number(req.query.product_id) : null,
    search: req.query.search?.trim() || null,
  });
  return ok(res, { data: recipes, message: 'Daftar recipe.' });
}

/** GET /api/inventory/recipes/products/:productId */
async function detail(req, res) {
  const recipe = await recipeService.findByProduct(Number(req.params.productId));
  if (!recipe) {
    throw ApiError.notFound('Produk ini belum punya recipe.');
  }
  return ok(res, { data: recipe, message: 'Detail recipe.' });
}

/**
 * PUT /api/inventory/recipes/products/:productId
 * Membuat atau memperbarui recipe beserta seluruh baris bahannya.
 */
async function save(req, res) {
  const productId = Number(req.params.productId);
  const recipe = await recipeService.save(productId, req.body);

  setAudit(res, {
    action: 'SAVE_RECIPE',
    entityType: 'recipe',
    entityId: recipe.id,
    description: `Menyimpan recipe untuk produk "${recipe.productName}"`,
    metadata: { itemCount: recipe.items.length, yieldQuantity: recipe.yieldQuantity },
  });

  return ok(res, {
    data: recipe,
    message: `Recipe untuk "${recipe.productName}" tersimpan dengan ${recipe.items.length} bahan.`,
  });
}

/** DELETE /api/inventory/recipes/products/:productId */
async function deactivate(req, res) {
  const productId = Number(req.params.productId);
  const result = await recipeService.deactivate(productId);

  setAudit(res, {
    action: 'DELETE_RECIPE',
    entityType: 'recipe',
    entityId: recipe.id ?? productId,
    description: `Menonaktifkan recipe produk #${productId}`,
  });

  return ok(res, { data: result, message: 'Recipe dinonaktifkan.' });
}

module.exports = { list, detail, save, deactivate };