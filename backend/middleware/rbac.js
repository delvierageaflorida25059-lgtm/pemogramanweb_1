'use strict';

const ApiError = require('../utils/ApiError');

/**
 * RBAC server-side.
 *
 * Prinsip: frontend boleh menyembunyikan tombol, tapi PENEGAKANNYA wajib di
 * backend. Setiap route sensitif dilindungi requirePermission().
 *
 * ADMIN adalah bypass karena dia pengguna yang mengelola role itu sendiri.
 */

/** Permission yang selalu dimiliki oleh ADMIN. */
const SUPER_ROLE = 'ADMIN';

/**
 * @param {object} user  hasil requireAuth (req.user)
 * @param {string} permission  contoh "order.create"
 * @returns {boolean}
 */
function hasPermission(user, permission) {
  if (!user) return false;
  if (Array.isArray(user.roles) && user.roles.includes(SUPER_ROLE)) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

/**
 * @param {object} user
 * @param {string[]} permissions
 * @returns {boolean} true bila user punya salah satu permission
 */
function hasAnyPermission(user, permissions) {
  return permissions.some((permission) => hasPermission(user, permission));
}

/**
 * Middleware: wajib punya permission tertentu.
 *
 * @example
 *   router.delete('/:id', requirePermission('product.delete'), controller.remove)
 *
 * @param {...string} permissions  satu atau lebih permission; cukup salah satu
 * @returns {import('express').RequestHandler}
 */
function requirePermission(...permissions) {
  const required = permissions.flat();

  return function permissionMiddleware(req, _res, next) {
    if (!req.user) {
      return next(ApiError.unauthorized('Anda harus masuk terlebih dahulu.'));
    }
    if (hasAnyPermission(req.user, required)) {
      return next();
    }
    return next(
      ApiError.forbidden(
        `Aksi ini memerlukan izin: ${required.join(' atau ')}.`,
        { details: { requiredPermissions: required } }
      )
    );
  };
}

/**
 * Middleware: wajib punya salah satu dari role yang diberikan.
 *
 * @example
 *   router.get('/kitchen-board', requireRole('KITCHEN', 'ADMIN'), controller.board)
 *
 * @param {...string} roles
 * @returns {import('express').RequestHandler}
 */
function requireRole(...roles) {
  const required = roles.flat();

  return function roleMiddleware(req, _res, next) {
    if (!req.user) {
      return next(ApiError.unauthorized('Anda harus masuk terlebih dahulu.'));
    }
    const owned = req.user.roles || [];
    if (required.some((role) => owned.includes(role))) {
      return next();
    }
    return next(
      ApiError.forbidden(`Aksi ini hanya untuk role: ${required.join(', ')}.`, {
        details: { requiredRoles: required },
      })
    );
  };
}

module.exports = {
  SUPER_ROLE,
  hasPermission,
  hasAnyPermission,
  requirePermission,
  requireRole,
};