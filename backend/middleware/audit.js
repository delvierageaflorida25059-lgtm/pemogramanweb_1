'use strict';

const { query } = require('../config/database');
const config = require('../config/env');

/**
 * Audit log.
 *
 * Fungsi ini ditulis sebagai best-effort: kalau pencatatan audit gagal, aksi
 * utama TIDAK boleh dibatalkan. Error ditulis ke console agar tidak hilang,
 * tapi request tetap diteruskan.
 *
 * Cara pakai di controller:
 *   res.locals.audit = { action: 'UPDATE', entity: 'product', entityId: id };
 *   -> middleware di bawah menyalin res.locals.audit ke database.
 */

/**
 * @param {object} entry
 * @param {number|null} [entry.userId]
 * @param {string} entry.action      mis. "CREATE", "UPDATE", "DELETE", "LOGIN"
 * @param {string} entry.entityType  mis. "product", "order", "payment"
 * @param {number|null} [entry.entityId]
 * @param {string} [entry.description]
 * @param {object} [entry.metadata]   akan disimpan sebagai JSON
 * @param {import('express').Request} [entry.req]
 */
async function writeAudit(entry) {
  try {
    const req = entry.req || {};
    await query(
      `INSERT INTO audit_logs
         (user_id, action, entity_type, entity_id, description, metadata, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? req.user?.id ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.description ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        req.ip || null,
        req.get?.('user-agent')?.slice(0, 255) ?? null,
      ]
    );
  } catch (error) {
    // Audit gagal tidak boleh menggagalkan aksi bisnis.
    console.error('[audit] gagal menulis audit log:', error.message);
  }
}

/**
 * Middleware: res.headersSent sudah berarti controller selesai, jadi audit
 * baru ditulis di sini setelah response terkirim.
 */
function auditMiddleware(req, res, next) {
  // Simpan nilai awal supaya bisa dibandingkan di hook 'finish'.
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (!res.locals.audit) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    writeAudit({
      ...res.locals.audit,
      userId: res.locals.audit.userId ?? req.user?.id ?? null,
      req,
      metadata: {
        ...(res.locals.audit.metadata || {}),
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        environment: config.nodeEnv,
      },
    });
  });

  next();
}

/**
 * Siapkan entri audit dari controller.
 * @param {import('express').Response} res
 * @param {object} entry
 */
function setAudit(res, entry) {
  res.locals.audit = entry;
}

module.exports = { writeAudit, auditMiddleware, setAudit };