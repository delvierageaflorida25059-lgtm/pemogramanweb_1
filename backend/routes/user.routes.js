'use strict';

const express = require('express');
const userController = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../utils/validators');

const router = express.Router();

// Seluruh modul user hanya bisa diakses setelah login.
router.use(requireAuth);

/**
 * Route role & permission harus didaftarkan SEBELUM /:id supaya path
 * "/roles/list" tidak tertangkap sebagai id = "roles".
 */

// GET /api/users/roles/list
router.get('/roles/list', requirePermission('role.view'), userController.listRoles);

// GET /api/users/roles/permissions
router.get('/roles/permissions', requirePermission('role.view'), userController.listPermissions);

// GET /api/users/roles/:id
router.get('/roles/:id', requirePermission('role.view'), userController.detailRole);

// PUT /api/users/roles/:id/permissions
router.put(
  '/roles/:id/permissions',
  requirePermission('role.manage'),
  validate({
    permissions: { type: 'array', required: true, label: 'Daftar permission' },
  }),
  userController.updateRolePermissions
);

// GET /api/users
router.get(
  '/',
  requirePermission('user.view'),
  validate({
    search: { type: 'string', max: 100 },
    status: { type: 'enum', values: ['ACTIVE', 'INACTIVE'] },
    role: { type: 'string', max: 50 },
  }),
  userController.list
);

// GET /api/users/:id
router.get('/:id', requirePermission('user.view'), userController.detail);

// POST /api/users
router.post(
  '/',
  requirePermission('user.manage'),
  validate({
    name: { type: 'string', required: true, min: 2, max: 100, label: 'Nama' },
    email: { type: 'email', required: true, label: 'Email' },
    phone: { type: 'string', max: 30, label: 'Nomor HP' },
    password: { type: 'password', required: true, label: 'Password' },
    roles: { type: 'array', required: true, minItems: 1, label: 'Role' },
  }),
  userController.create
);

// PUT /api/users/:id
router.put(
  '/:id',
  requirePermission('user.manage'),
  validate({
    name: { type: 'string', min: 2, max: 100 },
    email: { type: 'email' },
    phone: { type: 'string', max: 30 },
    status: { type: 'enum', values: ['ACTIVE', 'INACTIVE'] },
    roles: { type: 'array', minItems: 1 },
  }),
  userController.update
);

// DELETE /api/users/:id
router.delete('/:id', requirePermission('user.manage'), userController.remove);

module.exports = router;