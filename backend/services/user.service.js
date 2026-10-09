'use strict';

const { query, withTransaction } = require('../config/database');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');

/**
 * Service user & role.
 * Semua query database untuk modul user ada di file ini.
 */

const USER_LIST_COLUMNS = `
  u.id, u.name, u.email, u.phone, u.status,
  u.must_change_password, u.last_login_at, u.created_at, u.updated_at
`;

// ---------------------------------------------------------------------------
// Pembacaan
// ---------------------------------------------------------------------------

/**
 * Ambil user lengkap dengan role dan permission-nya.
 * Dipakai oleh middleware requireAuth.
 *
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findAuthUserById(userId) {
  const [rows] = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.status
       FROM users u
      WHERE u.id = ?
      LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;

  const [roleRows] = await query(
    `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.name`,
    [userId]
  );

  const [permissionRows] = await query(
    `SELECT DISTINCT p.code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = ?
      ORDER BY p.code`,
    [userId]
  );

  return {
    ...rows[0],
    roles: roleRows.map((row) => row.name),
    permissions: permissionRows.map((row) => row.code),
  };
}

/**
 * Cari user berdasarkan email (untuk proses login).
 * Password tidak dikembalikan di sini; cukup kolom untuk membandingkan hash.
 *
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function findByEmailWithPassword(email) {
  const [rows] = await query(
    `SELECT id, name, email, phone, password_hash, status
       FROM users
      WHERE email = ?
      LIMIT 1`,
    [email]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Daftar user dengan filter dan paginasi.
 *
 * @param {object} filters
 * @param {string} [filters.search]
 * @param {string} [filters.status] ACTIVE | INACTIVE
 * @param {string} [filters.role]
 * @param {number} filters.limit
 * @param {number} filters.offset
 * @returns {Promise<{rows:object[], total:number}>}
 */
async function list(filters) {
  const conditions = [];
  const params = [];

  if (filters.search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ?)');
    const keyword = `%${filters.search}%`;
    params.push(keyword, keyword);
  }
  if (filters.status) {
    conditions.push('u.status = ?');
    params.push(filters.status);
  }
  if (filters.role) {
    // EXISTS lebih rapi daripada JOIN lalu risk-nya duplikasi baris user.
    conditions.push(`EXISTS (
      SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = u.id AND r.name = ?
    )`);
    params.push(filters.role);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await query(
    `SELECT COUNT(*) AS total FROM users u ${where}`,
    params
  );

  const [rows] = await query(
    `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       ${where}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit, filters.offset]
  );

  const users = await attachRoles(rows);
  return { rows: users, total: countRows[0].total };
}

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  const [rows] = await query(
    `SELECT ${USER_LIST_COLUMNS} FROM users u WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return null;
  const [withRoles] = await attachRoles(rows);
  return withRoles;
}

/**
 * Tambahkan daftar role ke setiap user sekaligus.
 * @param {object[]} users
 */
async function attachRoles(users) {
  if (users.length === 0) return users;

  const ids = users.map((user) => user.id);
  const [roleRows] = await query(
    `SELECT ur.user_id, r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id IN (${ids.map(() => '?').join(',')})
      ORDER BY r.name`,
    ids
  );

  const grouped = new Map();
  for (const row of roleRows) {
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
    grouped.get(row.user_id).push(row.name);
  }

  return users.map((user) => ({ ...user, roles: grouped.get(user.id) || [] }));
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** @returns {Promise<object[]>} seluruh role beserta jumlah permission */
async function listRoles() {
  const [roles] = await query(
    `SELECT r.id, r.name, r.description, r.is_system,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
            (SELECT COUNT(*) FROM user_roles ur      WHERE ur.role_id = r.id) AS user_count
       FROM roles r
      ORDER BY r.name`
  );
  return roles;
}

/**
 * @param {number} roleId
 * @returns {Promise<object|null>} role beserta daftar permission code
 */
async function findRoleById(roleId) {
  const [roles] = await query(
    `SELECT id, name, description, is_system FROM roles WHERE id = ? LIMIT 1`,
    [roleId]
  );
  if (roles.length === 0) return null;

  const [permissions] = await query(
    `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.code`,
    [roleId]
  );

  return { ...roles[0], permissions: permissions.map((row) => row.code) };
}

/** @returns {Promise<object[]>} seluruh permission, dikelompokkan per modul */
async function listPermissions() {
  const [rows] = await query(
    `SELECT code, module, action, description
       FROM permissions
      ORDER BY module, action`
  );

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.module]) grouped[row.module] = [];
    grouped[row.module].push(row);
  }

  return Object.entries(grouped).map(([module, permissions]) => ({
    module,
    permissions: permissions.map((item) => item.code),
    descriptions: Object.fromEntries(permissions.map((item) => [item.code, item.description])),
  }));
}

/**
 * Ganti daftar permission sebuah role.
 * @param {number} roleId
 * @param {string[]} permissionCodes
 */
async function replaceRolePermissions(roleId, permissionCodes) {
  await withTransaction(async (conn) => {
    const [roleRows] = await conn.execute(
      `SELECT is_system FROM roles WHERE id = ? LIMIT 1`,
      [roleId]
    );
    if (roleRows.length === 0) {
      throw ApiError.notFound('Role tidak ditemukan.');
    }
    if (roleRows[0].is_system) {
      throw ApiError.forbidden('Permission role sistem tidak dapat diubah.');
    }

    if (permissionCodes.length === 0) {
      await conn.execute(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
      return;
    }

    const [permissionRows] = await conn.execute(
      `SELECT id, code FROM permissions WHERE code IN (${permissionCodes.map(() => '?').join(',')})`,
      permissionCodes
    );

    const found = new Set(permissionRows.map((row) => row.code));
    const missing = permissionCodes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw ApiError.badRequest(`Permission tidak dikenal: ${missing.join(', ')}.`, {
        details: { unknownPermissions: missing },
      });
    }

    await conn.execute(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
    const values = permissionRows.map(() => '(?, ?)').join(', ');
    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
      permissionRows.flatMap((row) => [roleId, row.id])
    );
  });
}

/**
 * @param {number} userId
 * @param {string[]} roleNames
 */
async function replaceUserRoles(userId, roleNames) {
  await withTransaction(async (conn) => {
    const [roleRows] = await conn.execute(
      `SELECT id, name FROM roles WHERE name IN (${roleNames.map(() => '?').join(',')})`,
      roleNames
    );

    const found = new Set(roleRows.map((row) => row.name));
    const missing = roleNames.filter((name) => !found.has(name));
    if (missing.length > 0) {
      throw ApiError.badRequest(`Role tidak dikenal: ${missing.join(', ')}.`, {
        details: { unknownRoles: missing },
      });
    }

    await conn.execute(`DELETE FROM user_roles WHERE user_id = ?`, [userId]);
    if (roleRows.length === 0) return;

    const values = roleRows.map(() => '(?, ?)').join(', ');
    await conn.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ${values}`,
      roleRows.flatMap((row) => [userId, row.id])
    );
  });
}

// ---------------------------------------------------------------------------
// Perubahan data
// ---------------------------------------------------------------------------

/**
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} [data.phone]
 * @param {string} data.password
 * @param {string[]} data.roles
 * @returns {Promise<object>} user yang sudah dibuat
 */
async function create(data) {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptSaltRounds);

  return withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO users (name, email, phone, password_hash, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [data.name, data.email, data.phone ?? null, passwordHash]
    );
    const userId = result.insertId;

    const [roleRows] = await conn.execute(
      `SELECT id FROM roles WHERE name IN (${data.roles.map(() => '?').join(',')})`,
      data.roles
    );
    if (roleRows.length !== data.roles.length) {
      throw ApiError.badRequest('Sebagian role tidak dikenal.');
    }
    if (roleRows.length === 0) {
      throw ApiError.badRequest('User harus memiliki minimal satu role.');
    }

    await conn.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ${roleRows.map(() => '(?, ?)').join(', ')}`,
      roleRows.flatMap((row) => [userId, row.id])
    );

    return findById(userId);
  });
}

/**
 * @param {number} id
 * @param {object} data
 */
async function update(id, data) {
  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('User tidak ditemukan.');

  const updates = [];
  const params = [];

  if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
  if (data.email !== undefined) { updates.push('email = ?'); params.push(data.email); }
  if (data.phone !== undefined) { updates.push('phone = ?'); params.push(data.phone || null); }
  if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status); }
  if (data.must_change_password !== undefined) {
    updates.push('must_change_password = ?');
    params.push(data.must_change_password ? 1 : 0);
  }

  if (updates.length > 0) {
    params.push(id);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  if (data.roles !== undefined) {
    await replaceUserRoles(id, data.roles);
  }

  return findById(id);
}

/**
 * @param {number} id
 * @param {string} currentUserId  cegah admin menghapus dirinya sendiri
 */
async function remove(id, currentUserId) {
  if (Number(id) === Number(currentUserId)) {
    throw ApiError.badRequest('Anda tidak dapat menghapus akun Anda sendiri.');
  }

  const existing = await findById(id);
  if (!existing) throw ApiError.notFound('User tidak ditemukan.');

  // User yang punya audit log tidak dihapus fisik, tapi dinonaktifkan agar
  // riwayat aktivitas tetap bisa ditelusuri.
  await query(`UPDATE users SET status = 'INACTIVE' WHERE id = ?`, [id]);
  await query(`DELETE FROM refresh_tokens WHERE user_id = ?`, [id]);

  return { id: Number(id), status: 'INACTIVE' };
}

/**
 * @param {number} id
 * @param {string} newPassword
 */
async function setPassword(id, newPassword) {
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptSaltRounds);

  const [result] = await query(
    `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
    [passwordHash, id]
  );
  if (result.affectedRows === 0) throw ApiError.notFound('User tidak ditemukan.');

  // Semua sesi lama langsung tidak berlaku setelah password diganti.
  await query(`DELETE FROM refresh_tokens WHERE user_id = ?`, [id]);
}

module.exports = {
  findAuthUserById,
  findByEmailWithPassword,
  findById,
  list,
  create,
  update,
  remove,
  setPassword,
  listRoles,
  findRoleById,
  listPermissions,
  replaceRolePermissions,
  replaceUserRoles,
};