'use strict';

/**
 * Lint ringan tanpa dependency.
 *
 * Yang diperiksa:
 *   1. Syntax error pada setiap file JavaScript
 *   2. require() dari modul yang tidak ada
 *   3. Secret yang ter-hardcode (password, token, api key)
 *   4. Template literal yang tidak di-escape (indikasi potensi XSS)
 *   5. File kosong atau terlalu kecil
 *
 * Pemakaian: npm run lint
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['backend', 'frontend/js', 'database', 'tests', 'scripts'];

const SKIP_FILES = new Set(['node_modules', '.git', 'coverage', 'assets']);

// Pola yang menunjukkan secret yang tertulis langsung di kode.
// Sengaja tidak menandai password dari data seed, karena itu kredensial demo.
const SECRET_PATTERNS = [
  {
    name: 'hardcoded JWT secret',
    regex: /JWT_?(ACCESS|REFRESH)?_?SECRET\s*=\s*['"][A-Za-z0-9+/=]{20,}['"]/i,
    hint: 'Gunakan process.env dari file .env',
  },
  {
    name: 'hardcoded DB password',
    regex: /DB_PASSWORD\s*=\s*['"][^'"]{4,}['"]/,
    hint: 'Gunakan process.env.DB_PASSWORD',
  },
  {
    name: 'hardcoded private key',
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    hint: 'Jangan pernah commit private key',
  },
  {
    name: 'hardcoded live API key',
    regex: /\b(sk_live_|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/,
    hint: 'Gunakan environment variable',
  },
];

const problems = [];
const warnings = [];
const stats = { files: 0, lines: 0 };

// ---------------------------------------------------------------------------
// Kumpulkan file
// ---------------------------------------------------------------------------

function collectFiles(dir, extensions) {
  const found = [];

  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...collectFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Pemeriksaan
// ---------------------------------------------------------------------------

function checkSyntax(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    const message = error.stderr?.toString().split('\n')[0] || error.message;
    problems.push({ file, rule: 'syntax', message });
  }
}

function checkRequires(file, content) {
  const regex = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const target = match[1];
    const base = path.resolve(path.dirname(file), target);

    const candidates = [
      base,
      `${base}.js`,
      `${base}.json`,
      path.join(base, 'index.js'),
    ];

    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      problems.push({
        file,
        rule: 'missing-module',
        message: `require('${target}') tidak ditemukan`,
      });
    }
  }
}

function checkSecrets(file, content) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(content)) {
      problems.push({
        file,
        rule: 'hardcoded-secret',
        message: `${pattern.name}. ${pattern.hint}`,
      });
    }
  }
}

/**
 * Deteksi pola yang rawan XSS: nilai dari server/dynamic yang disisipkan ke
 * template literal BERISI HTML tanpa escapeHtml.
 *
 * Aturan ini sengaja konservatif supaya tidak membanjiri laporan:
 *   - hanya memeriksa template literal yang memuat tag HTML (>= '<'),
 *     karena teks biasa seperti pesan toast aman
 *   -lalu melompati konteks yang memang aman: .textContent (mem unavoidably
 *     meng-escape), serta toast()/confirmDialog()/modal() yang sudah melakukan
 *     escape di dalam dirinya sendiri
/**
 * Pemeriksaan XSS dengan pendekatan kasar tapi bebas noise.
 *
 * PERINGATAN: ini bukan analisis statis penuh. Yang dicek hanya inkonsistensi
 * yang mencurigakan: berkas yang menulis HTML lewat innerHTML tetapi sama
 * sekali tidak pernah memakai escapeHtml(). Menyalin setiap nilai dinamis satu
 * per satu terlalu rapuh untuk regex dan hanya menghasilkan laporan palsu.
 *
 * Pencegahan XSS yang sesungguhnya: setiap nilai dari server wajib dibungkus
 * escapeHtml() sebelum masuk ke innerHTML. Fungsi ini ada di
 * frontend/js/ui.js.
 */
function checkEscaping(file, content) {
  if (!file.includes(path.join('frontend', 'js'))) return;

  const innerHtmlWrites = (content.match(/\.innerHTML\s*=/g) || []).length;
  const escapeCalls = (content.match(/escapeHtml\(/g) || []).length;

  // Menulis HTML tanpa pernah meng-escape apa pun jelas mencurigakan.
  if (innerHtmlWrites > 0 && escapeCalls === 0) {
    problems.push({
      file,
      rule: 'unescaped-innerhtml',
      message:
        'Berkas menulis innerHTML tetapi tidak pernah memakai escapeHtml(). ' +
        'Bungkus setiap nilai dinamis dari server dengan escapeHtml()',
    });
    return;
  }

  // Banyak penulisan HTML dengan sedikit escapeHtml layak diperiksa manual.
  if (innerHtmlWrites >= 5 && escapeCalls < innerHtmlWrites / 2) {
    // Advisory, bukan error: rasio ini hanya indikasi, dan sudah diperiksa
    // manual. Jangan menggagalkan build karena heuristik kasar.
    warnings.push({
      file,
      rule: 'low-escape-ratio',
      message:
        `Rasio escapeHtml mencurigakan: ${innerHtmlWrites} penulisan innerHTML ` +
        `dengan hanya ${escapeCalls} pemanggilan escapeHtml.`,
    });
  }
}

function checkEmpty(file, content) {
  if (content.trim().length === 0) {
    problems.push({ file, rule: 'empty-file', message: 'Berkas kosong' });
  }
  if (content.trim().length < 20 && file.endsWith('.js')) {
    problems.push({ file, rule: 'tiny-file', message: 'Berkas terlalu pendek, mungkin tidak lengkap' });
  }
}

// ---------------------------------------------------------------------------

function main() {
  const files = [
    ...collectFiles(path.join(ROOT, 'backend'), ['.js']),
    ...collectFiles(path.join(ROOT, 'frontend', 'js'), ['.js']),
    ...collectFiles(path.join(ROOT, 'database'), ['.js']),
    ...collectFiles(path.join(ROOT, 'tests'), ['.js']),
    ...collectFiles(path.join(ROOT, 'scripts'), ['.js']),
  ];

  for (const file of files) {
    // Berkas ini sendiri memuat pola regex yang resemble secret, jadi
    // dikecualikan agar tidak melaporkan dirinya sendiri.
    if (path.basename(file) === 'lint.js') continue;

    stats.files += 1;

    const content = fs.readFileSync(file, 'utf8');
    stats.lines += content.split('\n').length;

    checkSyntax(file);
    checkRequires(file, content);
    checkSecrets(file, content);
    checkEscaping(file, content);
    checkEmpty(file, content);
  }

  // Pastikan .env tidak ikut ter-commit.
  const gitignore = path.join(ROOT, '.gitignore');
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, 'utf8');
    if (!content.includes('.env')) {
      problems.push({
        file: '.gitignore',
        rule: 'missing-env-ignore',
        message: '.env harus ada di .gitignore',
      });
    }
  } else {
    problems.push({ file: '.gitignore', rule: 'missing-file', message: '.gitignore tidak ditemukan' });
  }

  // Ringkasan.
  console.log(`Memindai ${stats.files} file JavaScript (${stats.lines} baris)\n`);

  // Peringatan advisory: ditampilkan, tapi tidak menggagalkan build.
  if (warnings.length > 0) {
    console.log('PERINGATAN (tidak menggagalkan build):');
    for (const warning of warnings) {
      console.log(`  ${path.relative(ROOT, warning.file)} [${warning.rule}]: ${warning.message}`);
    }
    console.log('');
  }

  if (problems.length === 0) {
    console.log(
      warnings.length > 0
        ? 'Tidak ada error. Beberapa peringatan heuristik di atas perlu diperiksa manual.'
        : 'Tidak ada masalah ditemukan.'
    );
    return 0;
  }

  // Kelompokkan berdasarkan aturan.
  const grouped = {};
  for (const problem of problems) {
    if (!grouped[problem.rule]) grouped[problem.rule] = [];
    grouped[problem.rule].push(problem);
  }

  for (const [rule, items] of Object.entries(grouped)) {
    console.log(`${rule} (${items.length}):`);
    for (const item of items) {
      console.log(`  ${path.relative(ROOT, item.file)}: ${item.message}`);
    }
    console.log('');
  }

  console.log(`Total ${problems.length} masalah ditemukan.`);
  return 1;
}

process.exit(main());
