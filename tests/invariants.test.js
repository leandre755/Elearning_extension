'use strict';
// Safe Exm — project invariant tests (node:test, zero dependency).
// PROTECTED FILE: weakening it requires explicit maintainer approval (AGENTS.md §4).
// The hooks run it against an export of the git index / HEAD (GATE_ROOT).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.GATE_ROOT ? path.resolve(process.env.GATE_ROOT) : path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['lib', 'graphify-out', 'node_modules', '.git', 'tests', 'Docs', 'icons']);

// Known debt, frozen: number of `.innerHTML = \`...${...}\`` assignments per file. May only go DOWN.
const INNERHTML_INTERPOLATION_BASELINE = Object.freeze({ 'popup.js': 1, 'settings.js': 4 });

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name), exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const jsFiles = () => walk(ROOT, ['.js']);

/** Strip JS // and /* *\/ comments while keeping string and template literals intact. */
function stripJsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < src.length) {
        const c = src[i];
        out += c;
        if (c === '\\') {
          i++;
          if (i < src.length) out += src[i];
        } else if (c === q) {
          i++;
          break;
        }
        i++;
      }
    } else if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Extract top-level function definitions from background.js into a sandboxed VM context. */
function loadBgHelpers() {
  const src = read(path.join(ROOT, 'background.js'));
  const start = src.indexOf('function sanitizeUrlForLog');
  const end = src.indexOf('async function handleFetchLLM');
  assert.ok(start >= 0 && end > start, 'helpers sanitizeUrlForLog..sniffRasterImageMime introuvables');
  const ctx = vm.createContext({ URL });
  vm.runInContext(
    `${src.slice(start, end)}\nthis.exports = { sanitizeUrlForLog, isBlockedImageHost, sniffRasterImageMime };`,
    ctx
  );
  return ctx.exports;
}

test('manifest.json: valid MV3, system.md not web-accessible, no unsafe CSP', () => {
  const manifest = JSON.parse(read(path.join(ROOT, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  const war = JSON.stringify(manifest.web_accessible_resources || []);
  assert.ok(!/system\.md/.test(war), 'system.md ne doit jamais être dans web_accessible_resources');
  const csp = JSON.stringify(manifest.content_security_policy || {});
  assert.ok(!/unsafe-eval|unsafe-inline/.test(csp), "la CSP ne doit pas autoriser 'unsafe-eval' / 'unsafe-inline'");
});

test('stealth: no static data-qh-* DOM signature anywhere in shipped code', () => {
  const offenders = walk(ROOT, ['.js', '.html', '.css']).filter((f) => /data-qh-/.test(read(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('no dynamic code execution (eval / new Function / document.write)', () => {
  const re = /(^|[^\w$.])(eval\s*\(|new\s+Function\s*\(|document\.write(ln)?\s*\()/;
  const offenders = [];
  for (const f of jsFiles()) {
    const clean = stripJsComments(read(f));
    clean.split('\n').forEach((line, i) => {
      if (re.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('no remote code: importScripts only loads bundled files, no remote <script src>', () => {
  const offenders = [];
  for (const f of jsFiles()) {
    if (/importScripts\s*\([^)]*['"`]https?:/.test(stripJsComments(read(f)))) offenders.push(rel(f));
  }
  for (const f of walk(ROOT, ['.html'])) {
    if (/<script[^>]+src\s*=\s*["']?https?:/i.test(read(f))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, []);
});

test('background.js: handleFetchImage enforces Anti-SSRF (redirect: error + isBlockedImageHost)', () => {
  const src = stripJsComments(read(path.join(ROOT, 'background.js')));
  const start = src.indexOf('async function handleFetchImage');
  assert.ok(start >= 0, 'handleFetchImage introuvable');
  const body = src.slice(start, start + 3500);
  assert.match(body, /isBlockedImageHost\(/, 'handleFetchImage doit appeler isBlockedImageHost()');
  assert.match(body, /redirect\s*:\s*['"]error['"]/, "fetch() dans handleFetchImage doit bloquer les redirections (redirect: 'error')");
  assert.match(body, /sniffRasterImageMime\(/, 'les blobs sans MIME image doivent être vérifiés par magic bytes');
});

test('Anti-SSRF behavioral: isBlockedImageHost blocks loopback/IPv6/CGNAT/metadata and allows public hosts', () => {
  const { isBlockedImageHost } = loadBgHelpers();
  const blockedUrls = [
    'http://localhost/x',
    'http://localhost./x',
    'http://a.localhost/x',
    'http://127.0.0.1/x',
    'http://127.0.0.2/x',
    'http://0.0.0.0/x',
    'http://0.1.2.3/x',
    'http://10.0.0.1/x',
    'http://172.16.0.1/x',
    'http://172.31.255.254/x',
    'http://192.168.1.1/x',
    'http://100.64.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.170.2/x',
    'http://[::1]/x',
    'http://[::]/x',
    'http://[fe80::1]/x',
    'http://[febf::1]/x',
    'http://[fd00::1]/x',
    'http://[fc00::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:169.254.169.254]/x',
    'http://metadata/x',
    'http://service.internal/x',
    'http://printer.local/x'
  ];
  for (const u of blockedUrls) {
    const h = new URL(u).hostname;
    assert.equal(isBlockedImageHost(h), true, `devait bloquer ${u} (hostname=${h})`);
  }
  const allowedUrls = [
    'https://cdn.example.com/q.png',
    'https://1.1.1.1/img.png',
    'https://172.32.0.1/img.png',
    'https://[2606:4700:4700::1111]/img.png'
  ];
  for (const u of allowedUrls) {
    const h = new URL(u).hostname;
    assert.equal(isBlockedImageHost(h), false, `ne devait PAS bloquer ${u} (hostname=${h})`);
  }
});

test('sniffRasterImageMime behavioral: accepts real PNG/JPEG magic bytes and rejects HTML/text', () => {
  const { sniffRasterImageMime } = loadBgHelpers();
  assert.equal(sniffRasterImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(sniffRasterImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffRasterImageMime(new TextEncoder().encode('<html>secret</html>')), null);
  assert.equal(sniffRasterImageMime(new Uint8Array([])), null);
});

test('no raw *url* variable passed to console.* across shipped JS files (multiline safe)', () => {
  const offenders = [];
  const consoleCallRe = /console\.\w+\s*\(([\s\S]*?)\)\s*;/g;
  const urlVarRe = /\b(url|targetUrl|fetchUrl|requestUrl|endpointUrl)\b/;
  for (const f of jsFiles()) {
    const clean = stripJsComments(read(f));
    let m;
    while ((m = consoleCallRe.exec(clean)) !== null) {
      const args = m[1];
      if (urlVarRe.test(args) && !/sanitizeUrlForLog|_sanitizeUrl|new URL\([^)]+\)\.(origin|hostname)/.test(args)) {
        const line = clean.slice(0, m.index).split('\n').length;
        offenders.push(`${rel(f)}:${line}: ${args.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('innerHTML interpolation ratchet: no new `.innerHTML = `...${}`` (existing debt may only shrink)', () => {
  const re = /\.innerHTML\s*\+?=\s*`[^`]*\$\{/g;
  const actual = {};
  for (const f of jsFiles()) {
    const n = (read(f).match(re) || []).length;
    if (n > 0) actual[rel(f)] = n;
  }
  for (const [file, n] of Object.entries(actual)) {
    const allowed = INNERHTML_INTERPOLATION_BASELINE[file] || 0;
    assert.ok(n <= allowed, `${file}: ${n} innerHTML avec interpolation (max autorisé ${allowed}). Utilisez textContent / createElement.`);
  }
});

test('sanitizeUrlForLog(): masks query secrets, userinfo, and hash fragments (behavioral)', () => {
  const { sanitizeUrlForLog } = loadBgHelpers();
  for (const name of ['key', 'api_key', 'token', 'X-Amz-Signature', 'access_token', 'auth']) {
    const out = sanitizeUrlForLog(`https://example.com/p?${name}=SECRETVALUE&a=1`);
    assert.ok(!out.includes('SECRETVALUE'), `${name} non masqué : ${out}`);
    assert.ok(out.includes('a=1'), 'les paramètres non sensibles doivent rester');
  }
  const withCredsAndHash = sanitizeUrlForLog('https://alice:topsecret@api.example.com/img.png#access_token=tok123');
  assert.ok(!withCredsAndHash.includes('topsecret'), `password non masqué : ${withCredsAndHash}`);
  assert.ok(!withCredsAndHash.includes('alice'), `username non masqué : ${withCredsAndHash}`);
  assert.ok(!withCredsAndHash.includes('tok123'), `fragment non masqué : ${withCredsAndHash}`);
  assert.equal(sanitizeUrlForLog('pas une url'), '[invalid url]');
  assert.equal(typeof sanitizeUrlForLog(undefined), 'string');
});
