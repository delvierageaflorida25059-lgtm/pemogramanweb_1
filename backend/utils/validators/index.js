'use strict';

/**
 * Validator ringan tanpa dependency tambahan.
 *
 * Tujuannya menjaga kode tetap mudah dibaca untuk pelajar Informatika:
 * setiap validator mengembalikan daftar error dalam bentuk
 *   { namaField: "pesan untuk user" }
 *
 * `validate(schema)` dipakai sebagai middleware. Hasil validasi yang sudah
 * bersih + sudah dikonversi disimpan di `req.validated`.
 */

// ApiError.js mengekspor class secara langsung (module.exports = ApiError),
// jadi harus di-require tanpa destructuring.
const ApiError = require('../ApiError');

// ---------------------------------------------------------------------------
// Validator dasar
// ---------------------------------------------------------------------------

const isNil = (value) => value === undefined || value === null;

/**
 * @param {any} value
 * @param {object} [rules]
 * @param {{required?:boolean, min?:number, max?:number, label?:string, numeric?:boolean}} [rules]
 * @param {object} errors  akumulator error
 * @param {string} field
 */
function checkString(value, rules = {}, errors, field) {
  const label = rules.label || field;

  if (isNil(value) || value === '') {
    if (rules.required) errors[field] = `${label} wajib diisi.`;
    return;
  }
  if (typeof value !== 'string') {
    errors[field] = `${label} harus berupa teks.`;
    return;
  }
  const trimmed = value.trim();
  if (rules.min && trimmed.length < rules.min) {
    errors[field] = `${label} minimal ${rules.min} karakter.`;
  }
  if (rules.max && trimmed.length > rules.max) {
    errors[field] = `${label} maksimal ${rules.max} karakter.`;
  }
}

/**
 * @param {any} value
 * @param {object} [rules]
 * @param {{required?:boolean, min?:number, max?:number, integer?:boolean,
 *          label?:string}} [rules]
 */
function checkNumber(value, rules = {}, errors, field) {
  const label = rules.label || field;

  if (isNil(value) || value === '') {
    if (rules.required) errors[field] = `${label} wajib diisi.`;
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors[field] = `${label} harus berupa angka.`;
    return;
  }
  if (rules.integer && !Number.isInteger(number)) {
    errors[field] = `${label} harus berupa bilangan bulat.`;
  }
  if (rules.min !== undefined && number < rules.min) {
    errors[field] = `${label} minimal ${rules.min}.`;
  }
  if (rules.max !== undefined && number > rules.max) {
    errors[field] = `${label} maksimal ${rules.max}.`;
  }
}

/**
 * @param {any} value
 * @param {object} [rules]
 * @param {{required?:boolean, values?:string[], label?:string}} [rules]
 */
function checkEnum(value, rules = {}, errors, field) {
  const label = rules.label || field;

  if (isNil(value) || value === '') {
    if (rules.required) errors[field] = `${label} wajib diisi.`;
    return;
  }
  if (!Array.isArray(rules.values) || !rules.values.includes(value)) {
    errors[field] = `${label} harus salah satu dari: ${(rules.values || []).join(', ')}.`;
  }
}

function checkEmail(value, rules = {}, errors, field) {
  const label = rules.label || 'Email';
  if (isNil(value) || value === '') {
    if (rules.required) errors[field] = `${label} wajib diisi.`;
    return;
  }
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) {
    errors[field] = `${label} tidak valid.`;
  }
}

/** Password minimal 8 karakter dan tidak hanya spasi. */
function checkPassword(value, rules = {}, errors, field) {
  const label = rules.label || 'Password';
  if (isNil(value) || value === '') {
    errors[field] = `${label} wajib diisi.`;
    return;
  }
  if (typeof value !== 'string' || value.length < 8) {
    errors[field] = `${label} minimal 8 karakter.`;
  }
}

function checkBoolean(value, rules = {}, errors, field) {
  if (isNil(value)) {
    if (rules.required) errors[field] = `${rules.label || field} wajib diisi.`;
    return;
  }
  if (typeof value !== 'boolean') {
    errors[field] = `${rules.label || field} harus berupa true atau false.`;
  }
}

function checkArray(value, rules = {}, errors, field) {
  const label = rules.label || field;
  if (!Array.isArray(value)) {
    if (rules.required) errors[field] = `${label} wajib diisi.`;
    return;
  }
  if (rules.minItems && value.length < rules.minItems) {
    errors[field] = `${label} minimal berisi ${rules.minItems} item.`;
  }
  if (rules.maxItems && value.length > rules.maxItems) {
    errors[field] = `${label} maksimal berisi ${rules.maxItems} item.`;
  }
  if (rules.of) value.forEach((item, index) => rules.of(item, `${field}[${index}]`, errors));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Bangun middleware validasi dari skema per-field.
 *
 * @example
 *   router.post('/', validate({
 *     name: { type: 'string', required: true, max: 100 },
 *     price: { type: 'number', required: true, min: 0 },
 *   }), controller.create)
 *
 * Setiap field bisa punya `source` untuk membaca dari `req.params`,
 * `req.query`, atau `req.body`. Field bertanda `type: 'any'` dilewati.
 *
 * @param {Record<string, object>} schema
 * @returns {import('express').RequestHandler}
 */
function validate(schema) {
  return function validationMiddleware(req, _res, next) {
    const errors = {};
    const validated = {};

    for (const [field, rules] of Object.entries(schema)) {
      const sourceName = rules.source || (req.method === 'GET' || req.method === 'DELETE' ? 'query' : 'body');
      const source = req[sourceName] || {};
      const raw = source[field];

      if (rules.type === 'any') {
        validated[field] = raw;
        continue;
      }

      switch (rules.type) {
        case 'string': checkString(raw, rules, errors, field); break;
        case 'email': checkEmail(raw, rules, errors, field); break;
        case 'password': checkPassword(raw, rules, errors, field); break;
        case 'number': checkNumber(raw, rules, errors, field); break;
        case 'integer': checkNumber(raw, { ...rules, integer: true }, errors, field); break;
        case 'boolean': checkBoolean(raw, rules, errors, field); break;
        case 'enum': checkEnum(raw, rules, errors, field); break;
        case 'array': checkArray(raw, rules, errors, field); break;
        default:
          throw new ApiError(500, `Tipe validator "${rules.type}" tidak dikenal.`);
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(
        ApiError.badRequest('Data yang dikirim tidak valid.', {
          code: 'VALIDATION_ERROR',
          details: errors,
        })
      );
    }

    // Normalisasi: potong spasi di tepi teks dan ubah angka jadi number.
    for (const [field, rules] of Object.entries(schema)) {
      if (rules.type === 'any') continue;
      const value = req[rules.source || (req.method === 'GET' || req.method === 'DELETE' ? 'query' : 'body')][field];
      if (typeof value === 'string') {
        validated[field] = value.trim();
      } else if (rules.type === 'number' || rules.type === 'integer') {
        validated[field] = value === '' || isNil(value) ? undefined : Number(value);
      } else {
        validated[field] = value;
      }
    }

    req.validated = { ...(req.validated || {}), ...validated };
    return next();
  };
}

module.exports = {
  validate,
  checkString,
  checkNumber,
  checkEnum,
  checkEmail,
  checkArray,
};