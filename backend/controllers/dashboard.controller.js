'use strict';

const dashboardService = require('../services/dashboard.service');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');

/** Controller dashboard & laporan. */

/** GET /api/dashboard/summary */
async function summary(_req, res) {
  const data = await dashboardService.summary();
  return ok(res, { data, message: 'Ringkasan dashboard.' });
}

/**
 * GET /api/dashboard/daily?date=YYYY-MM-DD
 * Tanggal default hari ini.
 */
async function daily(req, res) {
  const date = req.query.date || dashboardService.todayRange().date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw ApiError.badRequest('Format tanggal harus YYYY-MM-DD.');
  }

  const data = await dashboardService.dailyFinance(String(date));
  return ok(res, { data, message: 'Ringkasan keuangan harian.' });
}

module.exports = { summary, daily };