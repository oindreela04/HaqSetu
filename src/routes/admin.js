'use strict';
const express = require('express');
const db = require('../db');
const sec = require('../security');
const F = require('../profileFields');
const { SCHEME_COLUMNS, schemeValues } = require('../seed');

const router = express.Router();
const staff = sec.requireRole('admin', 'reviewer');
const adminOnly = sec.requireRole('admin');
router.use(staff);

const OPS = ['gte', 'gt', 'lte', 'lt', 'between', 'eq', 'neq', 'in', 'nin', 'level_gte', 'level_lte', 'is', 'manual'];
const LEVELS = ['central', 'state', 'ut', 'district'];
const VSTATUS = ['draft', 'pending_review', 'verified', 'needs_update'];
const STATUS = ['active', 'closed', 'suspended', 'archived'];

/** Validate a rules tree. Returns an error string or null. */
function validateRules(node, depth = 0) {
  if (depth > 6) return 'Rules are nested too deeply.';
  if (!node || typeof node !== 'object' || Array.isArray(node)) return 'Each rule must be an object.';
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    for (const c of node.all || node.any) { const e = validateRules(c, depth + 1); if (e) return e; }
    return null;
  }
  if (!OPS.includes(node.op)) return `Unknown operator "${node.op}".`;
  if (node.op === 'manual') return typeof node.label === 'string' && node.label.trim() ? null : 'Manual conditions need a label.';
  if (!F.FIELDS[node.field]) return `Unknown field "${node.field}".`;
  if (node.op === 'between' && !(Array.isArray(node.value) && node.value.length === 2)) return `"between" needs [min, max] for ${node.field}.`;
  if (['in', 'nin'].includes(node.op) && !Array.isArray(node.value)) return `"${node.op}" needs a list for ${node.field}.`;
  return null;
}

const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const isUrl = (v) => !v || /^https?:\/\/[^\s]+$/i.test(v);
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** Build and validate a scheme object from the admin form. */
async function schemeFromForm(body) {
  const errors = [];
  const s = {
    slug: slugify(body.slug || body.name || ''),
    name: String(body.name || '').trim(),
    short_description: String(body.short_description || '').trim(),
    description: String(body.description || '').trim(),
    ministry: String(body.ministry || '').trim(),
    department: String(body.department || '').trim(),
    level: String(body.level || ''),
    state_codes: csv(String(body.state_codes || '').toUpperCase()),
    district_ids: [],
    beneficiary_categories: [].concat(body.beneficiary_categories || []).filter((c) => F.CATEGORY_TAGS.some(([k]) => k === c)),
    tags: csv(body.tags),
    eligibility_text: String(body.eligibility_text || '').trim(),
    benefits: String(body.benefits || '').trim(),
    benefit_amount: String(body.benefit_amount || '').trim(),
    documents: lines(body.documents),
    application_process: String(body.application_process || '').trim(),
    application_mode: String(body.application_mode || '').trim(),
    deadline: body.deadline || null,
    deadline_note: String(body.deadline_note || '').trim(),
    official_url: String(body.official_url || '').trim(),
    apply_url: String(body.apply_url || '').trim(),
    contact: String(body.contact || '').trim(),
    source_reference: String(body.source_reference || '').trim(),
    source_url: String(body.source_url || '').trim(),
    status: STATUS.includes(body.status) ? body.status : 'active',
  };
  if (s.name.length < 3) errors.push('Scheme name is required.');
  if (!s.slug) errors.push('A URL slug is required.');
  if (!LEVELS.includes(s.level)) errors.push('Choose a government level.');
  if (s.level !== 'central' && s.state_codes.length === 0) errors.push('State / UT / district schemes must list at least one state code.');
  if (s.state_codes.length) {
    const known = (await db.many('SELECT code FROM states WHERE code = ANY($1)', [s.state_codes])).map((r) => r.code);
    const bad = s.state_codes.filter((c) => !known.includes(c));
    if (bad.length) errors.push(`Unknown state codes: ${bad.join(', ')}`);
  }
  const districtNames = lines(body.districts);
  if (districtNames.length) {
    const rows = await db.many(
      `SELECT d.id, d.name FROM districts d JOIN states st ON st.id = d.state_id WHERE st.code = ANY($1) AND d.name = ANY($2)`,
      [s.state_codes, districtNames]
    );
    const missing = districtNames.filter((n) => !rows.some((r) => r.name === n));
    if (missing.length) errors.push(`Districts not found in the selected state(s): ${missing.join(', ')}`);
    s.district_ids = rows.map((r) => r.id);
  }
  if (s.level === 'district' && s.district_ids.length === 0) errors.push('District-level schemes must list at least one district.');
  for (const k of ['official_url', 'apply_url', 'source_url']) if (!isUrl(s[k])) errors.push(`${k.replace('_', ' ')} must start with http:// or https://`);
  if (s.deadline && Number.isNaN(new Date(s.deadline).getTime())) errors.push('Deadline is not a valid date.');
  try {
    s.rules = body.rules && String(body.rules).trim() ? JSON.parse(body.rules) : { all: [] };
    const e = validateRules(s.rules);
    if (e) errors.push('Eligibility rules: ' + e);
  } catch (e) {
    errors.push('Eligibility rules are not valid JSON.');
    s.rules = { all: [] };
    s.rulesRaw = body.rules;
  }
  return { s, errors };
}

async function snapshot(id, userId, action, note) {
  const row = await db.one('SELECT * FROM schemes WHERE id = $1', [id]);
  if (row) {
    delete row.search;
    await db.query('INSERT INTO scheme_revisions (scheme_id, changed_by, action, note, snapshot) VALUES ($1,$2,$3,$4,$5)', [id, userId, action, note || '', JSON.stringify(row)]);
  }
}

// ───────────── Dashboard ─────────────
router.get('/', async (req, res, next) => {
  try {
    const stats = await db.one(`SELECT
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM profiles WHERE onboarding_complete)::int AS profiles,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::int AS new_users,
      (SELECT count(*) FROM scheme_reports WHERE NOT resolved)::int AS open_reports`);
    const byStatus = await db.many(`SELECT verification_status AS k, count(*)::int AS n FROM schemes WHERE status <> 'archived' GROUP BY 1`);
    const stale = await db.many(`SELECT id, name, last_verified_at FROM schemes WHERE status = 'active' AND verification_status = 'verified' AND (last_verified_at IS NULL OR last_verified_at < now() - interval '180 days') ORDER BY last_verified_at NULLS FIRST LIMIT 10`);
    const coverage = await db.many(`SELECT s.code, s.name, count(sc.id)::int AS n FROM states s LEFT JOIN schemes sc ON s.code = ANY(sc.state_codes) AND sc.level <> 'central' AND sc.status = 'active' GROUP BY s.id ORDER BY n, s.name`);
    res.render('admin/index', { title: 'Admin', stats, byStatus: Object.fromEntries(byStatus.map((r) => [r.k, r.n])), stale, coverage });
  } catch (e) { next(e); }
});

// ───────────── Schemes ─────────────
router.get('/schemes', async (req, res, next) => {
  try {
    const where = ['TRUE'];
    const p = [];
    if (VSTATUS.includes(req.query.vs)) { p.push(req.query.vs); where.push(`verification_status = $${p.length}`); }
    if (LEVELS.includes(req.query.level)) { p.push(req.query.level); where.push(`level = $${p.length}`); }
    if (/^[A-Z]{2,4}$/.test(req.query.state || '')) { p.push(req.query.state); where.push(`$${p.length} = ANY(state_codes)`); }
    if (req.query.q) { p.push(String(req.query.q).slice(0, 100)); where.push(`name ILIKE '%' || $${p.length} || '%'`); }
    const rows = await db.many(`SELECT id, slug, name, level, state_codes, verification_status, status, last_verified_at, updated_at FROM schemes WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`, p);
    res.render('admin/schemes', { title: 'Manage schemes', rows, q: req.query });
  } catch (e) { next(e); }
});

const blank = { level: 'central', state_codes: [], beneficiary_categories: [], tags: [], documents: [], rules: { all: [] }, status: 'active', verification_status: 'draft' };

router.get('/schemes/new', (req, res) => res.render('admin/scheme-form', { title: 'New scheme', s: blank, districts: '', errors: [] }));

router.post('/schemes', async (req, res, next) => {
  try {
    const { s, errors } = await schemeFromForm(req.body);
    if (!errors.length && await db.one('SELECT 1 FROM schemes WHERE slug = $1', [s.slug])) errors.push('Another scheme already uses this slug.');
    if (errors.length) return res.status(422).render('admin/scheme-form', { title: 'New scheme', s: { ...blank, ...s }, districts: req.body.districts || '', errors });
    s.verification_status = req.body.submit_for_review ? 'pending_review' : 'draft';
    s.verification_notes = '';
    const cols = SCHEME_COLUMNS;
    const row = await db.one(`INSERT INTO schemes (${cols.join(',')}, created_by, updated_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 1}) RETURNING id`, [...schemeValues(s), req.user.id]);
    await snapshot(row.id, req.user.id, 'create');
    await sec.audit(req.user.id, 'scheme.create', 'scheme', row.id, { name: s.name });
    req.flash('success', 'Scheme saved.');
    res.redirect(`/admin/schemes/${row.id}/edit`);
  } catch (e) { next(e); }
});

router.get('/schemes/:id/edit', async (req, res, next) => {
  try {
    const s = await db.one('SELECT * FROM schemes WHERE id = $1', [Number(req.params.id) || 0]);
    if (!s) return res.redirect('/admin/schemes');
    const districts = s.district_ids.length ? (await db.many('SELECT name FROM districts WHERE id = ANY($1) ORDER BY name', [s.district_ids])).map((r) => r.name).join('\n') : '';
    const revisions = await db.many('SELECT r.id, r.action, r.note, r.created_at, u.name AS by FROM scheme_revisions r LEFT JOIN users u ON u.id = r.changed_by WHERE scheme_id = $1 ORDER BY r.created_at DESC LIMIT 20', [s.id]);
    const reports = await db.many('SELECT id, message, resolved, created_at FROM scheme_reports WHERE scheme_id = $1 ORDER BY created_at DESC LIMIT 20', [s.id]);
    res.render('admin/scheme-form', { title: `Edit: ${s.name}`, s, districts, errors: [], revisions, reports });
  } catch (e) { next(e); }
});

router.post('/schemes/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    const current = await db.one('SELECT * FROM schemes WHERE id = $1', [id]);
    if (!current) return res.redirect('/admin/schemes');
    const { s, errors } = await schemeFromForm(req.body);
    if (!errors.length && await db.one('SELECT 1 FROM schemes WHERE slug = $1 AND id <> $2', [s.slug, id])) errors.push('Another scheme already uses this slug.');
    if (errors.length) return res.status(422).render('admin/scheme-form', { title: `Edit: ${current.name}`, s: { ...current, ...s, id }, districts: req.body.districts || '', errors, revisions: [], reports: [] });
    // Any content edit to a verified record sends it back for review.
    s.verification_status = current.verification_status === 'verified' ? 'pending_review' : (req.body.submit_for_review ? 'pending_review' : current.verification_status);
    s.verification_notes = current.verification_notes;
    s.last_verified_at = current.last_verified_at;
    const cols = SCHEME_COLUMNS;
    await db.query(`UPDATE schemes SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_by = $${cols.length + 1}, updated_at = now() WHERE id = $${cols.length + 2}`, [...schemeValues(s), req.user.id, id]);
    await snapshot(id, req.user.id, 'update', req.body.change_note);
    await sec.audit(req.user.id, 'scheme.update', 'scheme', id);
    req.flash('success', current.verification_status === 'verified' ? 'Saved. Because the record changed, it has returned to the review queue.' : 'Saved.');
    res.redirect(`/admin/schemes/${id}/edit`);
  } catch (e) { next(e); }
});

router.post('/schemes/:id/verify', async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    const s = await db.one('SELECT id, source_url, official_url FROM schemes WHERE id = $1', [id]);
    if (!s) return res.redirect('/admin/schemes');
    const action = req.body.action;
    const note = String(req.body.note || '').trim().slice(0, 2000);
    if (action === 'verify') {
      if (!s.source_url && !s.official_url) { req.flash('error', 'Add an official source URL before verifying.'); return res.redirect(`/admin/schemes/${id}/edit`); }
      if (note.length < 5) { req.flash('error', 'Add a verification note (which official document/page you checked).'); return res.redirect(`/admin/schemes/${id}/edit`); }
      await db.query(`UPDATE schemes SET verification_status = 'verified', last_verified_at = CURRENT_DATE, verified_by = $2, verification_notes = $3, updated_at = now() WHERE id = $1`, [id, req.user.id, note]);
    } else if (['needs_update', 'pending_review', 'draft'].includes(action)) {
      await db.query('UPDATE schemes SET verification_status = $2, verification_notes = $3, updated_at = now() WHERE id = $1', [id, action, note]);
    } else if (STATUS.includes(action)) {
      await db.query('UPDATE schemes SET status = $2, updated_at = now() WHERE id = $1', [id, action]);
    }
    await snapshot(id, req.user.id, `verification:${action}`, note);
    await sec.audit(req.user.id, `scheme.${action}`, 'scheme', id, { note });
    req.flash('success', 'Updated.');
    res.redirect(`/admin/schemes/${id}/edit`);
  } catch (e) { next(e); }
});

router.get('/revisions/:id', async (req, res, next) => {
  try {
    const r = await db.one('SELECT * FROM scheme_revisions WHERE id = $1', [Number(req.params.id) || 0]);
    if (!r) return res.redirect('/admin/schemes');
    res.type('application/json').send(JSON.stringify(r, null, 2));
  } catch (e) { next(e); }
});

// ───────────── Import / export ─────────────
router.get('/import', (req, res) => res.render('admin/import', { title: 'Import schemes', result: null, errors: [] }));

router.post('/import', adminOnly, async (req, res, next) => {
  try {
    let items;
    try {
      items = JSON.parse(String(req.body.payload || ''));
      if (!Array.isArray(items)) items = [items];
    } catch (e) {
      return res.status(422).render('admin/import', { title: 'Import schemes', result: null, errors: ['Payload must be a JSON array of scheme objects.'] });
    }
    const mode = req.body.mode === 'update' ? 'update' : 'insert';
    const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    for (const [i, raw] of items.slice(0, 1000).entries()) {
      const body = {
        ...raw,
        state_codes: (raw.state_codes || []).join(','), tags: (raw.tags || []).join(','), documents: (raw.documents || []).join('\n'),
        districts: (raw.districts || []).join('\n'), beneficiary_categories: raw.beneficiary_categories || [],
        rules: JSON.stringify(raw.rules || { all: [] }),
      };
      const { s, errors } = await schemeFromForm(body);
      if (errors.length) { result.errors.push(`#${i + 1} ${raw.name || ''}: ${errors.join('; ')}`); continue; }
      // Imports can never arrive as verified — a reviewer must check them.
      s.verification_status = raw.verification_status === 'draft' ? 'draft' : 'pending_review';
      s.verification_notes = `Imported ${new Date().toISOString().slice(0, 10)}`;
      const existing = await db.one('SELECT id FROM schemes WHERE slug = $1', [s.slug]);
      if (existing && mode === 'insert') { result.skipped++; continue; }
      const cols = SCHEME_COLUMNS;
      if (existing) {
        await db.query(`UPDATE schemes SET ${cols.map((c, j) => `${c} = $${j + 1}`).join(', ')}, updated_by = $${cols.length + 1}, updated_at = now() WHERE id = $${cols.length + 2}`, [...schemeValues(s), req.user.id, existing.id]);
        await snapshot(existing.id, req.user.id, 'import-update');
        result.updated++;
      } else {
        const row = await db.one(`INSERT INTO schemes (${cols.join(',')}, created_by, updated_by) VALUES (${cols.map((_, j) => `$${j + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 1}) RETURNING id`, [...schemeValues(s), req.user.id]);
        await snapshot(row.id, req.user.id, 'import');
        result.inserted++;
      }
    }
    await sec.audit(req.user.id, 'scheme.import', 'scheme', '', { inserted: result.inserted, updated: result.updated, skipped: result.skipped, errors: result.errors.length });
    res.render('admin/import', { title: 'Import schemes', result, errors: [] });
  } catch (e) { next(e); }
});

router.get('/export.json', async (req, res, next) => {
  try {
    const rows = await db.many(`SELECT s.*, coalesce((SELECT array_agg(d.name ORDER BY d.name) FROM districts d WHERE d.id = ANY(s.district_ids)), '{}') AS districts FROM schemes s ORDER BY s.level, s.name`);
    for (const r of rows) { delete r.search; delete r.district_ids; }
    res.setHeader('Content-Disposition', `attachment; filename="haqsetu-schemes-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type('application/json').send(JSON.stringify(rows, null, 2));
  } catch (e) { next(e); }
});

// ───────────── Locations ─────────────
router.get('/locations', async (req, res, next) => {
  try {
    const states = await db.many(`SELECT s.*, count(d.id)::int AS districts FROM states s LEFT JOIN districts d ON d.state_id = s.id GROUP BY s.id ORDER BY s.type, s.name`);
    res.render('admin/locations', { title: 'Locations', states });
  } catch (e) { next(e); }
});

router.post('/locations/states', adminOnly, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const type = req.body.type === 'ut' ? 'ut' : 'state';
    if (!/^[A-Z]{2,4}$/.test(code) || name.length < 2) { req.flash('error', 'Enter a 2–4 letter code and a name.'); return res.redirect('/admin/locations'); }
    await db.query('INSERT INTO states (code, name, type) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET name = $2, type = $3, updated_at = now()', [code, name, type]);
    await sec.audit(req.user.id, 'location.state_upsert', 'state', code, { name, type });
    req.flash('success', `Saved ${name}.`);
    res.redirect('/admin/locations');
  } catch (e) { next(e); }
});

router.get('/locations/:code', async (req, res, next) => {
  try {
    const st = await db.one('SELECT * FROM states WHERE code = $1', [req.params.code]);
    if (!st) return res.redirect('/admin/locations');
    const districts = await db.many(`SELECT d.*, (SELECT count(*) FROM subdivisions sd WHERE sd.district_id = d.id)::int AS subs FROM districts d WHERE state_id = $1 ORDER BY name`, [st.id]);
    res.render('admin/districts', { title: `Districts — ${st.name}`, st, districts });
  } catch (e) { next(e); }
});

router.post('/locations/:code/state', adminOnly, async (req, res, next) => {
  try {
    await db.query('UPDATE states SET name = $2, active = $3, updated_at = now() WHERE code = $1', [req.params.code, String(req.body.name || '').trim(), req.body.active === 'on']);
    await sec.audit(req.user.id, 'location.state_update', 'state', req.params.code);
    req.flash('success', 'State updated.');
    res.redirect(`/admin/locations/${req.params.code}`);
  } catch (e) { next(e); }
});

router.post('/locations/:code/districts', adminOnly, async (req, res, next) => {
  try {
    const st = await db.one('SELECT id FROM states WHERE code = $1', [req.params.code]);
    const names = lines(req.body.names);
    let n = 0;
    for (const name of names) { const r = await db.query('INSERT INTO districts (state_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [st.id, name.slice(0, 120)]); n += r.rowCount; }
    await sec.audit(req.user.id, 'location.district_add', 'state', req.params.code, { names });
    req.flash('success', `Added ${n} district(s).`);
    res.redirect(`/admin/locations/${req.params.code}`);
  } catch (e) { next(e); }
});

router.post('/districts/:id', adminOnly, async (req, res, next) => {
  try {
    const d = await db.one('SELECT d.id, s.code FROM districts d JOIN states s ON s.id = d.state_id WHERE d.id = $1', [Number(req.params.id) || 0]);
    if (!d) return res.redirect('/admin/locations');
    const name = String(req.body.name || '').trim();
    if (name.length >= 2) await db.query('UPDATE districts SET name = $2, active = $3, updated_at = now() WHERE id = $1', [d.id, name, req.body.active === 'on']);
    if (req.body.subdivisions) {
      for (const sub of lines(req.body.subdivisions)) await db.query('INSERT INTO subdivisions (district_id, name, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [d.id, sub.slice(0, 120), ['block', 'tehsil', 'taluk', 'subdivision', 'mandal', 'ward'].includes(req.body.kind) ? req.body.kind : 'block']);
    }
    await sec.audit(req.user.id, 'location.district_update', 'district', d.id, { name });
    req.flash('success', 'District updated.');
    res.redirect(`/admin/locations/${d.code}`);
  } catch (e) { next(e); }
});

// ───────────── Reports, users, audit ─────────────
router.get('/reports', async (req, res, next) => {
  try {
    const rows = await db.many(`SELECT r.*, s.name AS scheme_name, s.id AS sid FROM scheme_reports r JOIN schemes s ON s.id = r.scheme_id ORDER BY r.resolved, r.created_at DESC LIMIT 200`);
    res.render('admin/reports', { title: 'Citizen reports', rows });
  } catch (e) { next(e); }
});
router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    await db.query('UPDATE scheme_reports SET resolved = TRUE WHERE id = $1', [Number(req.params.id) || 0]);
    res.redirect('/admin/reports');
  } catch (e) { next(e); }
});

router.get('/users', adminOnly, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 100);
    const rows = await db.many(`SELECT id, name, email, role, email_verified_at, created_at, last_login_at FROM users ${q ? `WHERE email::text ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%'` : ''} ORDER BY created_at DESC LIMIT 200`, q ? [q] : []);
    res.render('admin/users', { title: 'Users', rows, q });
  } catch (e) { next(e); }
});
router.post('/users/:id/role', adminOnly, async (req, res, next) => {
  try {
    const role = ['citizen', 'reviewer', 'admin'].includes(req.body.role) ? req.body.role : null;
    if (role && req.params.id !== req.user.id) {
      await db.query('UPDATE users SET role = $2 WHERE id = $1', [req.params.id, role]);
      await sec.audit(req.user.id, 'user.role_change', 'user', req.params.id, { role });
      req.flash('success', 'Role updated.');
    } else req.flash('error', 'You cannot change your own role.');
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});

router.get('/audit', adminOnly, async (req, res, next) => {
  try {
    const rows = await db.many(`SELECT a.*, u.email AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 300`);
    res.render('admin/audit', { title: 'Audit log', rows });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.validateRules = validateRules;
