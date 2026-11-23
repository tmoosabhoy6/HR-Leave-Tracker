import ASSETS from './assets.gen.js';
import { mergePolicy, validateSubmission, isISODate, LEAVE_TYPES, countDays, todayIraq } from '../public/js/logic.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const bad = (msg, status = 400) => json({ error: msg }, status);

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}
async function putSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value))
    .run();
}
const getPolicy = async (env) => mergePolicy(await getSetting(env, 'policy'));

// ---------- auth ----------
async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
async function sessionKey(env) {
  let secret = await getSetting(env, 'session_secret');
  if (!secret) {
    secret = randomHex(32);
    await putSetting(env, 'session_secret', secret);
  }
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeToken(env) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: Date.now() + 30 * 86400000 })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(payload)));
  return `${payload}.${sig}`;
}
async function isAuthed(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ld_session=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  const expect = b64u(await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(payload)));
  if (expect !== sig) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return exp > Date.now();
  } catch {
    return false;
  }
}
const cookieHeader = (value, maxAge) => `ld_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- helpers ----------
function newRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
const clean = (s, max = 500) => (s == null ? null : String(s).trim().slice(0, max) || null);

async function insertRequest(env, { employeeId, type, start, end, reason, contact, status, source }) {
  for (let i = 0; i < 5; i++) {
    const ref = newRef();
    try {
      const decided = status === 'pending' ? null : new Date().toISOString();
      const row = await env.DB.prepare(
        `INSERT INTO requests (ref, employee_id, type, start_date, end_date, reason, contact, status, source, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
        .bind(ref, employeeId, type, start, end, clean(reason, 1000), clean(contact, 60), status, source, decided)
        .first();
      return row;
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  throw new Error('Could not create a reference');
}

// ---------- routes ----------
async function publicApi(request, env, path) {
  if (path === '/api/public/staff' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name, department FROM employees WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
    const policy = await getPolicy(env);
    return json({ staff: results.map((r) => ({ ...r, name: r.name.trim() })), countFridays: policy.countFridays });
  }
  if (path === '/api/public/requests' && request.method === 'POST') {
    const b = await body(request);
    if (b.website) return json({ ref: 'THANKS' }); // honeypot
    const policy = await getPolicy(env);
    const data = { employeeId: Number(b.employeeId), type: b.type, start: b.start, end: b.end, reason: b.reason, contact: b.contact };
    const errors = validateSubmission(data, policy);
    if (errors.length) return json({ error: errors[0], errors }, 400);
    const emp = await env.DB.prepare('SELECT id FROM employees WHERE id = ? AND active = 1').bind(data.employeeId).first();
    if (!emp) return bad('We could not find that name. Please choose it from the list.');
    const row = await insertRequest(env, { ...data, status: 'pending', source: 'form' });
    return json({ ref: row.ref, days: countDays(row.start_date, row.end_date, policy) }, 201);
  }
  const m = path.match(/^\/api\/public\/requests\/([A-Z0-9]{6})$/);
  if (m && request.method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT r.ref, r.type, r.start_date, r.end_date, r.status, r.decision_note, r.submitted_at, e.name
       FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.ref = ?`
    )
      .bind(m[1])
      .first();
    if (!r) return bad('No request has that reference. Check the code and try again.', 404);
    return json({ request: { ...r, name: r.name.trim().split(/\s+/)[0] } });
  }
  return bad('Not found', 404);
}

async function adminApi(request, env, path) {
  const method = request.method;

  if (path === '/api/login' && method === 'POST') {
    const { password } = await body(request);
    const stored = await getSetting(env, 'admin_password');
    if (!stored) return bad('No admin password is set yet.', 500);
    const ok = typeof password === 'string' && (await hashPassword(password, stored.salt)) === stored.hash;
    if (!ok) {
      await new Promise((r) => setTimeout(r, 600));
      return bad('That password is not right.', 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(await makeToken(env), 30 * 86400) });
  }
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });

  if (!(await isAuthed(request, env))) return bad('Sign in to continue.', 401);

  if (path === '/api/data' && method === 'GET') {
    const [emps, reqs, policy] = await Promise.all([
      env.DB.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all(),
      env.DB.prepare('SELECT * FROM requests ORDER BY submitted_at DESC, id DESC').all(),
      getPolicy(env),
    ]);
    return json({ employees: emps.results, requests: reqs.results, policy, today: todayIraq() });
  }

  if (path === '/api/settings' && method === 'PUT') {
    const b = await body(request);
    const p = mergePolicy(b.policy);
    for (const g of ['iraqi', 'foreign']) {
      for (const k of ['monthly', 'annual']) {
        const n = Number(p[g][k]);
        if (!Number.isFinite(n) || n < 0 || n > 366) return bad('Allowances must be between 0 and 366 days.');
        p[g][k] = n;
      }
      p[g].sick = p[g].sick === null || p[g].sick === '' ? null : Math.max(0, Math.min(366, Number(p[g].sick) || 0));
    }
    p.annualMode = p.annualMode === 'accrual' ? 'accrual' : 'upfront';
    p.countFridays = !!p.countFridays;
    p.confirmed = true;
    await putSetting(env, 'policy', p);
    return json({ policy: p });
  }

  if (path === '/api/password' && method === 'POST') {
    const { current, next } = await body(request);
    const stored = await getSetting(env, 'admin_password');
    if (!stored || (await hashPassword(String(current || ''), stored.salt)) !== stored.hash) return bad('The current password is not right.', 400);
    if (typeof next !== 'string' || next.length < 8) return bad('Use at least 8 characters for the new password.');
    const salt = randomHex(16);
    await putSetting(env, 'admin_password', { salt, hash: await hashPassword(next, salt) });
    await putSetting(env, 'session_secret', randomHex(32)); // sign everyone else out
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(await makeToken(env), 30 * 86400) });
  }

  if (path === '/api/requests' && method === 'POST') {
    const b = await body(request);
    const policy = await getPolicy(env);
    const data = { employeeId: Number(b.employeeId), type: b.type, start: b.start, end: b.end, reason: b.reason };
    const errors = validateSubmission(data, policy);
    if (errors.length) return bad(errors[0]);
    const status = ['approved', 'pending'].includes(b.status) ? b.status : 'approved';
    const row = await insertRequest(env, { ...data, contact: null, status, source: 'admin' });
    return json({ request: row }, 201);
  }

  let m = path.match(/^\/api\/requests\/(\d+)$/);
  if (m && method === 'PATCH') {
    const b = await body(request);
    const id = Number(m[1]);
    const cur = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first();
    if (!cur) return bad('That request no longer exists.', 404);
    const next = { ...cur };
    if (b.status !== undefined) {
      if (!['pending', 'approved', 'declined', 'cancelled'].includes(b.status)) return bad('Unknown status.');
      next.status = b.status;
      next.decided_at = b.status === 'pending' ? null : new Date().toISOString();
    }
    if (b.decision_note !== undefined) next.decision_note = clean(b.decision_note, 500);
    if (b.start_date !== undefined || b.end_date !== undefined || b.type !== undefined) {
      next.start_date = b.start_date ?? cur.start_date;
      next.end_date = b.end_date ?? cur.end_date;
      next.type = b.type ?? cur.type;
      if (!isISODate(next.start_date) || !isISODate(next.end_date) || next.end_date < next.start_date) return bad('Check the dates.');
      if (!LEAVE_TYPES[next.type]) return bad('Unknown leave type.');
    }
    const row = await env.DB.prepare(
      'UPDATE requests SET status = ?, decided_at = ?, decision_note = ?, start_date = ?, end_date = ?, type = ? WHERE id = ? RETURNING *'
    )
      .bind(next.status, next.decided_at, next.decision_note, next.start_date, next.end_date, next.type, id)
      .first();
    return json({ request: row });
  }
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  if (path === '/api/employees' && method === 'POST') {
    const b = await body(request);
    const name = clean(b.name, 120);
    if (!name) return bad('Enter a name.');
    const row = await env.DB.prepare('INSERT INTO employees (name, its_id, department, currency, group_override) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .bind(name, clean(b.its_id, 40), clean(b.department, 80), clean(b.currency, 10)?.toUpperCase() ?? null, ['iraqi', 'foreign'].includes(b.group_override) ? b.group_override : null)
      .first();
    return json({ employee: row }, 201);
  }
  m = path.match(/^\/api\/employees\/(\d+)$/);
  if (m && method === 'PATCH') {
    const b = await body(request);
    const id = Number(m[1]);
    const cur = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
    if (!cur) return bad('That person no longer exists.', 404);
    const next = { ...cur };
    if ('name' in b) next.name = clean(b.name, 120) || cur.name;
    if ('its_id' in b) next.its_id = clean(b.its_id, 40);
    if ('department' in b) next.department = clean(b.department, 80);
    if ('currency' in b) next.currency = clean(b.currency, 10)?.toUpperCase() ?? null;
    if ('group_override' in b) next.group_override = ['iraqi', 'foreign'].includes(b.group_override) ? b.group_override : null;
    if ('active' in b) next.active = b.active ? 1 : 0;
    const row = await env.DB.prepare('UPDATE employees SET name = ?, its_id = ?, department = ?, currency = ?, group_override = ?, active = ? WHERE id = ? RETURNING *')
      .bind(next.name, next.its_id, next.department, next.currency, next.group_override, next.active, id)
      .first();
    return json({ employee: row });
  }

  if (path === '/api/export.csv' && method === 'GET') {
    const policy = await getPolicy(env);
    const { results } = await env.DB.prepare(
      `SELECT r.ref, e.name, e.its_id, e.department, e.currency, e.group_override, r.type, r.start_date, r.end_date, r.status, r.source, r.submitted_at, r.decided_at, r.reason, r.decision_note
       FROM requests r JOIN employees e ON e.id = r.employee_id ORDER BY r.start_date`
    ).all();
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ['Reference', 'Name', 'ITS ID', 'Department', 'Group', 'Leave type', 'From', 'To', 'Days', 'Status', 'Entered by', 'Submitted', 'Decided', 'Reason', 'Note'];
    const lines = results.map((r) =>
      [r.ref, r.name.trim(), r.its_id, r.department, r.group_override || (String(r.currency).toUpperCase() === 'IQD' ? 'iraqi' : 'foreign'), LEAVE_TYPES[r.type].label, r.start_date, r.end_date, countDays(r.start_date, r.end_date, policy), r.status, r.source === 'admin' ? 'Admin' : 'Form', r.submitted_at, r.decided_at, r.reason, r.decision_note]
        .map(esc)
        .join(',')
    );
    return new Response('﻿' + [head.join(','), ...lines].join('\n'), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leave-records-${todayIraq()}.csv"` },
    });
  }

  return bad('Not found', 404);
}

const PAGE_ALIASES = { '/': '/index.html', '/apply': '/apply.html', '/apply/': '/apply.html' };
function serveAsset(path) {
  const file = ASSETS[PAGE_ALIASES[path] || path];
  if (!file) {
    const nf = ASSETS['/404.html'];
    return new Response(nf.body, { status: 404, headers: { 'content-type': nf.type } });
  }
  const isHtml = file.type.startsWith('text/html');
  return new Response(file.body, {
    headers: {
      'content-type': file.type,
      'cache-control': isHtml ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      ...(isHtml ? { 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' } : {}),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/public/')) return await publicApi(request, env, path);
      if (path.startsWith('/api/')) return await adminApi(request, env, path);
    } catch (e) {
      console.error(e);
      return bad('Something went wrong on the server. Try again in a moment.', 500);
    }
    return serveAsset(path);
  },
};
