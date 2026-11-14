'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://haq:haq@localhost:5432/haqsetu_test';
process.env.BCRYPT_ROUNDS = '4';
process.env.AUTH_RATE_MAX = '1000';
process.env.ADMIN_EMAILS = 'admin@example.com';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const db = require('../src/db');
const { seedAll } = require('../src/seed');
const { createApp } = require('../src/app');
const mail = require('../src/mail');

let app;
const csrfOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/) || [])[1];

async function agentWithCsrf(path = '/register') {
  const agent = request.agent(app);
  const r = await agent.get(path);
  return { agent, csrf: csrfOf(r.text) };
}

async function register(email, extra = {}) {
  const { agent, csrf } = await agentWithCsrf('/register');
  const r = await agent.post('/register').type('form').send({ _csrf: csrf, name: 'Test User', email, mobile: '9876543210', password: 'secret123', password_confirm: 'secret123', consent: 'on', ...extra });
  return { agent, r };
}

async function freshCsrf(agent, path = '/profile') {
  return csrfOf((await agent.get(path)).text);
}

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await seedAll();
  app = createApp();
});
test.after(async () => { await db.pool.end(); });

test('public pages render', async () => {
  for (const p of ['/', '/schemes', '/schemes/pm-kisan', '/check', '/about', '/privacy', '/terms', '/disclaimer', '/login', '/register']) {
    const r = await request(app).get(p);
    assert.equal(r.status, 200, p);
  }
  const r = await request(app).get('/api/states');
  assert.equal(r.body.length, 36);
});

test('state filter on browse page shows only that state + central', async () => {
  const r = await request(app).get('/schemes?state=MH');
  assert.match(r.text, /Ladki Bahin/);
  assert.doesNotMatch(r.text, /Annapurna Bhandar|Kanyashree/);
  assert.equal((await request(app).get('/api/schemes')).status, 404);
});

test('POST without CSRF token is rejected', async () => {
  const r = await request(app).post('/login').type('form').send({ email: 'x@y.z', password: 'whatever1' });
  assert.equal(r.status, 403);
});

test('registration validates input and never stores plaintext passwords', async () => {
  const { agent, csrf } = await agentWithCsrf('/register');
  const bad = await agent.post('/register').type('form').send({ _csrf: csrf, name: 'A', email: 'bad', password: 'short', password_confirm: 'nope' });
  assert.equal(bad.status, 422);
  const { r } = await register('citizen@example.com');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/onboarding');
  const u = await db.one('SELECT password_hash FROM users WHERE email = $1', ['citizen@example.com']);
  assert.ok(u.password_hash.startsWith('$2'));
  assert.ok(!u.password_hash.includes('secret123'));
  const dup = await register('citizen@example.com');
  assert.equal(dup.r.status, 422);
});

test('full citizen journey: onboarding → dashboard → location change refreshes results', async () => {
  const { agent } = await register('wb.student@example.com');
  const dash0 = await agent.get('/dashboard');
  assert.equal(dash0.headers.location, '/onboarding');

  const wb = await db.one(`SELECT s.id AS sid, d.id AS did FROM states s JOIN districts d ON d.state_id = s.id WHERE s.code = 'WB' AND d.name = 'North 24 Parganas'`);
  let csrf = await freshCsrf(agent, '/onboarding');
  const save = await agent.post('/onboarding').type('form').send({
    _csrf: csrf, state_id: wb.sid, district_id: wb.did, age: '21', gender: 'female', education: 'undergraduate', employment: 'student',
    annual_income: '180000', marital_status: 'unmarried', flag_is_enrolled_in_education: 'yes', flag_has_bank_account: 'yes',
  });
  assert.equal(save.status, 302);
  const dash = await agent.get('/dashboard');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /North 24 Parganas/);
  assert.match(dash.text, /Benefits you may be missing/);
  assert.match(dash.text, /Annapurna Bhandar|Kanyashree/);
  assert.doesNotMatch(dash.text, /Ladki Bahin/);

  const mh = await db.one(`SELECT id FROM states WHERE code = 'MH'`);
  csrf = await freshCsrf(agent);
  await agent.post('/profile').type('form').send({ _csrf: csrf, state_id: mh.id, age: '30', gender: 'female', annual_income: '200000', flag_is_income_tax_payer: 'no', flag_is_govt_employee_family: 'no' });
  const dash2 = await agent.get('/dashboard');
  assert.match(dash2.text, /Ladki Bahin/);
  assert.doesNotMatch(dash2.text, /Annapurna Bhandar|Kanyashree/);
});

test('saving a scheme removes it from Missed Benefits', async () => {
  const { agent } = await register('saver@example.com');
  const ga = await db.one(`SELECT id FROM states WHERE code = 'GA'`);
  let csrf = await freshCsrf(agent, '/onboarding');
  await agent.post('/onboarding').type('form').send({ _csrf: csrf, state_id: ga.id, age: '30', flag_has_bank_account: 'yes', flag_is_income_tax_payer: 'no' });
  const s = await db.one(`SELECT id FROM schemes WHERE slug = 'pmsby'`);
  const before = await agent.get('/dashboard');
  const missedBefore = before.text.split('All results')[0];
  assert.match(missedBefore, /Suraksha Bima/);
  csrf = await freshCsrf(agent, '/dashboard');
  await agent.post(`/my-schemes/${s.id}`).type('form').send({ _csrf: csrf, status: 'applied', back: '/dashboard' });
  const after = await agent.get('/dashboard');
  assert.doesNotMatch(after.text.split('All results')[0], /Suraksha Bima Yojana \(PMSBY\)<\/a><\/h3>/);
  assert.match(after.text, /Tracked schemes/);
});

test('login, lockout-safe errors, logout', async () => {
  await register('login@example.com');
  const { agent, csrf } = await agentWithCsrf('/login');
  const wrong = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'login@example.com', password: 'wrongpass1' });
  assert.equal(wrong.status, 401);
  const csrf2 = csrfOf(wrong.text);
  const ok = await agent.post('/login').type('form').send({ _csrf: csrf2, email: 'login@example.com', password: 'secret123' });
  assert.equal(ok.status, 302);
  assert.equal((await agent.get('/account')).status, 200);
  const c = await freshCsrf(agent, '/account');
  await agent.post('/logout').type('form').send({ _csrf: c });
  assert.equal((await agent.get('/account')).status, 302);
});

test('password reset via emailed token; token is single-use', async () => {
  await register('reset@example.com');
  const { agent, csrf } = await agentWithCsrf('/forgot-password');
  mail.devOutbox.length = 0;
  await agent.post('/forgot-password').type('form').send({ _csrf: csrf, email: 'reset@example.com' });
  const msg = mail.devOutbox.find((m) => m.to === 'reset@example.com');
  const token = msg.text.match(/reset-password\/([A-Za-z0-9_-]+)/)[1];
  const page = await agent.get(`/reset-password/${token}`);
  assert.equal(page.status, 200);
  const r = await agent.post(`/reset-password/${token}`).type('form').send({ _csrf: csrfOf(page.text), password: 'newpass123', password_confirm: 'newpass123' });
  assert.equal(r.headers.location, '/login');
  assert.equal((await agent.get(`/reset-password/${token}`)).status, 400);
  const l = await agentWithCsrf('/login');
  const ok = await l.agent.post('/login').type('form').send({ _csrf: l.csrf, email: 'reset@example.com', password: 'newpass123' });
  assert.equal(ok.status, 302);
});

test('email verification link marks account verified', async () => {
  mail.devOutbox.length = 0;
  await register('verify@example.com');
  const token = mail.devOutbox.find((m) => m.to === 'verify@example.com').text.match(/verify-email\/([A-Za-z0-9_-]+)/)[1];
  await request(app).get(`/verify-email/${token}`);
  const u = await db.one('SELECT email_verified_at FROM users WHERE email = $1', ['verify@example.com']);
  assert.ok(u.email_verified_at);
});

test('citizens cannot access admin; admin can verify a scheme', async () => {
  const { agent: citizen } = await register('nosy@example.com');
  assert.equal((await citizen.get('/admin')).status, 403);

  const { agent: admin } = await register('admin@example.com');
  assert.equal((await admin.get('/admin')).status, 200);
  const s = await db.one(`SELECT id FROM schemes WHERE slug = 'pm-kisan'`);
  const edit = await admin.get(`/admin/schemes/${s.id}/edit`);
  assert.equal(edit.status, 200);
  const noNote = await admin.post(`/admin/schemes/${s.id}/verify`).type('form').send({ _csrf: csrfOf(edit.text), action: 'verify', note: '' });
  assert.equal(noNote.status, 302);
  assert.equal((await db.one('SELECT verification_status FROM schemes WHERE id = $1', [s.id])).verification_status, 'pending_review');
  await admin.post(`/admin/schemes/${s.id}/verify`).type('form').send({ _csrf: csrfOf(edit.text), action: 'verify', note: 'Checked pmkisan.gov.in guidelines' });
  const v = await db.one('SELECT verification_status, last_verified_at FROM schemes WHERE id = $1', [s.id]);
  assert.equal(v.verification_status, 'verified');
  assert.ok(v.last_verified_at);
});

test('admin can create a district-level scheme that only that district sees', async () => {
  const { agent: admin } = await agentWithCsrf('/login');
  const page = await admin.get('/login');
  await admin.post('/login').type('form').send({ _csrf: csrfOf(page.text), email: 'admin@example.com', password: 'secret123' });
  const form = await admin.get('/admin/schemes/new');
  const r = await admin.post('/admin/schemes').type('form').send({
    _csrf: csrfOf(form.text), name: 'Test District Scheme', level: 'district', state_codes: 'GA', districts: 'North Goa',
    official_url: 'https://goa.gov.in', rules: JSON.stringify({ all: [{ field: 'age', op: 'gte', value: 18 }] }), submit_for_review: '1',
  });
  assert.equal(r.status, 302, r.text);
  const goa = await db.many(`SELECT d.id, d.name, s.id AS sid FROM districts d JOIN states s ON s.id = d.state_id WHERE s.code = 'GA' ORDER BY d.name`);
  const north = goa.find((d) => d.name === 'North Goa');
  const south = goa.find((d) => d.name === 'South Goa');
  const run = async (did) => {
    const c = await agentWithCsrf('/check');
    const res = await c.agent.post('/check').type('form').send({ _csrf: c.csrf, state_id: north.sid, district_id: did, age: '30' });
    return res.text;
  };
  assert.match(await run(north.id), /Test District Scheme/);
  assert.doesNotMatch(await run(south.id), /Test District Scheme/);
});

test('admin can add a district without code changes', async () => {
  const { agent: admin } = await agentWithCsrf('/login');
  const page = await admin.get('/login');
  await admin.post('/login').type('form').send({ _csrf: csrfOf(page.text), email: 'admin@example.com', password: 'secret123' });
  const p = await admin.get('/admin/locations/LA');
  await admin.post('/admin/locations/LA/districts').type('form').send({ _csrf: csrfOf(p.text), names: 'Zanskar' });
  const r = await request(app).get('/api/districts?state=LA');
  assert.ok(r.body.some((d) => d.name === 'Zanskar'));
});

test('data export and account deletion', async () => {
  const { agent } = await register('leaver@example.com');
  const exp = await agent.get('/account/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.user.email, 'leaver@example.com');
  const csrf = await freshCsrf(agent, '/account');
  const bad = await agent.post('/account/delete').type('form').send({ _csrf: csrf, confirm: 'DELETE', password: 'wrong' });
  assert.equal(bad.status, 302);
  assert.ok(await db.one('SELECT 1 FROM users WHERE email = $1', ['leaver@example.com']));
  await agent.post('/account/delete').type('form').send({ _csrf: csrf, confirm: 'DELETE', password: 'secret123' });
  assert.equal(await db.one('SELECT 1 FROM users WHERE email = $1', ['leaver@example.com']), null);
});

test('anonymous quick check returns three groups', async () => {
  const { agent, csrf } = await agentWithCsrf('/check');
  const tn = await db.one(`SELECT id FROM states WHERE code = 'TN'`);
  const r = await agent.post('/check').type('form').send({ _csrf: csrf, state_id: tn.id, age: '67', annual_income: '50000', flag_is_bpl: 'yes' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Old Age Pension/);
  assert.match(r.text, /myScheme listing for Tamil Nadu/);
});

test('voice API fails gracefully when the voice service is down, and saves need server-side confirmation', async () => {
  const caps = await request(app).get('/voice-api/capabilities');
  assert.equal(caps.status, 503);
  assert.equal(caps.body.fallback, 'text');
  assert.equal((await request(app).get('/voice')).status, 200);
  const { agent } = await register('voicer@example.com');
  const csrf = csrfOf((await agent.get('/voice')).text);
  const r = await agent.post('/voice-api/save-profile').set('x-csrf-token', csrf).send({ updates: { age: 99 } });
  assert.equal(r.status, 409, 'browser cannot push profile changes without a confirmed voice save');
});

test('catalogue updates shipped in code refresh untouched rows but never admin-edited ones', async () => {
  const { seedSchemes } = require('../src/seed');
  await db.query(`UPDATE schemes SET seed_hash = 'stale', benefit_amount = 'old' WHERE slug = 'pmjdy'`);
  await db.query(`UPDATE schemes SET seed_hash = 'stale', benefit_amount = 'admin text', updated_by = (SELECT id FROM users WHERE email = 'admin@example.com') WHERE slug = 'pmsby'`);
  const r = await seedSchemes();
  assert.ok(r.updated >= 1);
  assert.notEqual((await db.one(`SELECT benefit_amount FROM schemes WHERE slug = 'pmjdy'`)).benefit_amount, 'old');
  assert.equal((await db.one(`SELECT benefit_amount FROM schemes WHERE slug = 'pmsby'`)).benefit_amount, 'admin text');
});
