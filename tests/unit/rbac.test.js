'use strict';

/**
 * Unit test untuk logika otorisasi.
 *
 * Bagian ini diuji tanpa database karena yang diperiksa murni fungsi
 * hasPermission / .hasAnyPermission, bukan query-nya.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { hasPermission, hasAnyPermission } = require('../../backend/middleware/rbac');

// User dengan satu role dan daftar permission.
const admin = {
  id: 1,
  roles: ['ADMIN'],
  permissions: [],
};

const cashier = {
  id: 2,
  roles: ['CASHIER'],
  permissions: ['order.create', 'payment.create', 'order.view'],
};

const kitchen = {
  id: 3,
  roles: ['KITCHEN'],
  permissions: ['kitchen.view', 'kitchen.process'],
};

test('permission dimiliki bila ada di daftar', () => {
  assert.equal(hasPermission(cashier, 'order.create'), true);
  assert.equal(hasPermission(kitchen, 'kitchen.process'), true);
});

test('permission ditolak bila tidak ada di daftar', () => {
  assert.equal(hasPermission(cashier, 'product.delete'), false);
  assert.equal(hasPermission(kitchen, 'order.create'), false);
});

test('ADMIN adalah bypass dan memiliki semua permission', () => {
  // Admin tidak punya daftar permission, tapi tetap boleh melakukan apa pun.
  assert.equal(hasPermission(admin, 'product.delete'), true);
  assert.equal(hasPermission(admin, 'payment.refund'), true);
  assert.equal(hasPermission(admin, 'user.manage'), true);
});

test('user tanpa login tidak memiliki permission apa pun', () => {
  assert.equal(hasPermission(null, 'order.create'), false);
  assert.equal(hasPermission(undefined, 'order.create'), false);
});

test('user dengan daftar permission kosong ditolak', () => {
  const kosong = { id: 9, roles: [], permissions: [] };
  assert.equal(hasPermission(kosong, 'order.create'), false);
});

test('role selain ADMIN tidak mendapat bypass', () => {
  const owner = { id: 4, roles: ['OWNER'], permissions: [] };
  assert.equal(hasPermission(owner, 'user.manage'), false);
});

test('hasAnyPermission benar bila salah satu cocok', () => {
  assert.equal(hasAnyPermission(cashier, ['user.manage', 'payment.create']), true);
  assert.equal(hasAnyPermission(cashier, ['user.manage', 'product.delete']), false);
});

test('permission matching bersifat spesifik, tidak ada wildcard', () => {
  // "order" tidak boleh otomatis memberi "order.create"
  assert.equal(hasPermission(cashier, 'order'), false);
  // dan permission yang lebih panjang juga tidak cocok
  assert.equal(hasPermission(cashier, 'order.create.extra'), false);
});