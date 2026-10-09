'use strict';

const userService = require('../services/user.service');
const { ok, paginated, getPagination } = require('../utils/response');
const { setAudit } = require('../middleware/audit');

/**
 * Controller user & RBAC.
 */

/**
 * GET /api/users
 */
async function list(req, res) {
  const { page, limit, offset } = getPagination(req);

  const result = await userService.list({
    search: req.query.search?.trim() || null,
    status: req.query.status || null,
    role: req.query.role || null,
    limit,
    offset,
  });

  return paginated(res, req, { items: result.rows, total: result.total, page, limit });
}

/**
 * GET /api/users/:id
 */
async function detail(req, res) {
  const user = await userService.findById(Number(req.params.id));
  return ok(res, { data: user, message: 'Detail user.' });
}

/**
 * POST /api/users
 */
async function create(req, res) {
  const user = await userService.create(req.body);

  setAudit(res, {
    action: 'CREATE',
    entityType: 'user',
    entityId: user.id,
    description: `Membuat user ${user.email}`,
    metadata: { roles: user.roles },
  });

  return ok(res, { data: user, message: 'User berhasil dibuat.', status: 201 });
}

/**
 * PUT /api/users/:id
 */
async function update(req, res) {
  const id = Number(req.params.id);
  const user = await userService.update(id, req.body);

  setAudit(res, {
    action: 'UPDATE',
    entityType: 'user',
    entityId: id,
    description: `Memperbarui user ${user.email}`,
    metadata: { fields: Object.keys(req.body) },
  });

  return ok(res, { data: user, message: 'User berhasil diperbarui.' });
}

/**
 * DELETE /api/users/:id
 * Menghapus berarti menonaktifkan supaya audit log tetap utuh.
 */
async function remove(req, res) {
  const id = Number(req.params.id);
  const result = await userService.remove(id, req.user.id);

  setAudit(res, {
    action: 'DELETE',
    entityType: 'user',
    entityId: id,
    description: `Menonaktifkan user #${id}`,
  });

  return ok(res, { data: result, message: 'User berhasil dinonaktifkan.' });
}

// ---------------------------------------------------------------------------
// Role & permission
// ---------------------------------------------------------------------------

/** GET /api/users/roles/list */
async function listRoles(_req, res) {
  const roles = await userService.listRoles();
  return ok(res, { data: roles, message: 'Daftar role.' });
}

/** GET /api/users/roles/permissions */
async function listPermissions(_req, res) {
  const grouped = await userService.listPermissions();
  return ok(res, { data: grouped, message: 'Daftar permission per modul.' });
}

/** GET /api/users/roles/:id */
async function detailRole(req, res) {
  const role = await userService.findRoleById(Number(req.params.id));
  if (!role) {
    return res.status(404).json({ success: false, message: 'Role tidak ditemukan.' });
  }
  return ok(res, { data: role, message: 'Detail role.' });
}

/** PUT /api/users/roles/:id/permissions */
async function updateRolePermissions(req, res) {
  const id = Number(req.params.id);
  await userService.replaceRolePermissions(id, req.body.permissions || []);

  setAudit(res, {
    action: 'UPDATE_PERMISSIONS',
    entityType: 'role',
    entityId: id,
    description: `Mengganti daftar permission role #${id}`,
    metadata: { permissionCount: (req.body.permissions || []).length },
  });

  const role = await userService.findRoleById(id);
  return ok(res, { data: role, message: 'Permission role berhasil diperbarui.' });
}

module.exports = {
  list,
  detail,
  create,
  update,
  remove,
  listRoles,
  listPermissions,
  detailRole,
  updateRolePermissions,
};