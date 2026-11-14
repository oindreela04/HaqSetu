'use strict';
const db = require('./db');
const F = require('./profileFields');
const { buildFacts, matchAll, evaluateScheme, unlockSuggestions } = require('./eligibility');

// Which verification states are shown to the public. Drafts are never shown.
const PUBLIC_VERIFICATION = process.env.SHOW_UNVERIFIED === 'false' ? ['verified'] : ['verified', 'pending_review', 'needs_update'];

// ───────────── Locations ─────────────
async function states() {
  return db.many('SELECT id, code, name, type FROM states WHERE active ORDER BY type, name');
}
async function districtsByState(stateIdOrCode) {
  const byCode = typeof stateIdOrCode === 'string' && /^[A-Z]{2,4}$/.test(stateIdOrCode);
  return db.many(
    `SELECT d.id, d.name FROM districts d JOIN states s ON s.id = d.state_id
      WHERE d.active AND ${byCode ? 's.code = $1' : 's.id = $1'} ORDER BY d.name`,
    [stateIdOrCode]
  );
}
async function stateByCode(code) {
  return db.one('SELECT * FROM states WHERE code = $1', [code]);
}

// ───────────── Schemes ─────────────
async function searchSchemes({ q, state, level, category, page = 1, perPage = 24 } = {}) {
  const where = [`status = 'active'`, `verification_status = ANY($1)`];
  const params = [PUBLIC_VERIFICATION];
  if (q) {
    params.push(q);
    where.push(`(search @@ plainto_tsquery('simple', $${params.length}) OR name ILIKE '%' || $${params.length} || '%' OR short_description ILIKE '%' || $${params.length} || '%')`);
  }
  if (state) {
    params.push(state);
    where.push(`((level = 'central' AND (cardinality(state_codes) = 0 OR $${params.length} = ANY(state_codes))) OR $${params.length} = ANY(state_codes))`);
  }
  if (level && ['central', 'state', 'ut', 'district'].includes(level)) {
    params.push(level);
    where.push(`level = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`$${params.length} = ANY(beneficiary_categories)`);
  }
  const w = where.join(' AND ');
  const total = (await db.one(`SELECT count(*)::int AS n FROM schemes WHERE ${w}`, params)).n;
  params.push(perPage, (Math.max(1, page) - 1) * perPage);
  const rows = await db.many(
    `SELECT id, slug, name, short_description, level, state_codes, beneficiary_categories, benefit_amount, verification_status, last_verified_at, deadline, deadline_note
       FROM schemes WHERE ${w}
      ORDER BY ${q ? `ts_rank(search, plainto_tsquery('simple', $2)) DESC,` : ''} CASE level WHEN 'district' THEN 0 WHEN 'state' THEN 1 WHEN 'ut' THEN 1 ELSE 2 END, name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

async function schemeBySlug(slug, { includeHidden = false } = {}) {
  const s = await db.one('SELECT * FROM schemes WHERE slug = $1', [slug]);
  if (!s) return null;
  if (!includeHidden && (!PUBLIC_VERIFICATION.includes(s.verification_status) || s.status === 'archived')) return null;
  return s;
}

/** Every active, publicly visible scheme that could apply to a location. */
async function candidateSchemes(stateCode) {
  return db.many(
    `SELECT * FROM schemes
      WHERE status = 'active' AND verification_status = ANY($1)
        AND ( (level = 'central' AND (cardinality(state_codes) = 0 OR $2::text = ANY(state_codes)))
              OR ($2::text IS NOT NULL AND $2::text = ANY(state_codes)) )`,
    [PUBLIC_VERIFICATION, stateCode || null]
  );
}

async function schemeCounts() {
  return db.one(
    `SELECT count(*) FILTER (WHERE level = 'central')::int AS central,
            count(*) FILTER (WHERE level <> 'central')::int AS state,
            count(*)::int AS total,
            count(*) FILTER (WHERE verification_status = 'verified')::int AS verified
       FROM schemes WHERE status = 'active' AND verification_status = ANY($1)`,
    [PUBLIC_VERIFICATION]
  );
}

async function stateSchemeCounts() {
  return db.many(
    `SELECT s.code, s.name, s.type, count(sc.id)::int AS n
       FROM states s LEFT JOIN schemes sc
         ON s.code = ANY(sc.state_codes) AND sc.level <> 'central' AND sc.status = 'active' AND sc.verification_status = ANY($1)
      WHERE s.active GROUP BY s.id ORDER BY s.type, s.name`,
    [PUBLIC_VERIFICATION]
  );
}

// ───────────── Profiles ─────────────
async function getProfile(userId) {
  const p = await db.one(
    `SELECT p.*, s.code AS state_code, s.name AS state_name, d.name AS district_name
       FROM profiles p LEFT JOIN states s ON s.id = p.state_id LEFT JOIN districts d ON d.id = p.district_id
      WHERE p.user_id = $1`,
    [userId]
  );
  return p || { data: {}, state_id: null, district_id: null, onboarding_complete: false };
}

const num = (v, min, max) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) return null; // null = invalid
  return n;
};
const pick = (v, list) => (v && list.some(([k]) => k === v) ? v : undefined);

/**
 * Parse and validate profile form input. Returns { data, state_id, district_id, errors }.
 * Only whitelisted fields are kept.
 */
async function parseProfileForm(body) {
  const errors = [];
  const data = {};
  if (body.dob) {
    const d = new Date(body.dob);
    const now = new Date();
    if (Number.isNaN(d.getTime()) || d > now || d.getFullYear() < 1900) errors.push('Please enter a valid date of birth.');
    else data.dob = body.dob;
  } else if (body.age !== undefined && body.age !== '') {
    const a = num(body.age, 0, 120);
    if (a === null) errors.push('Age must be between 0 and 120.');
    else data.age = a;
  }
  for (const [k, list] of [['gender', F.GENDERS], ['residence', F.RESIDENCE], ['education', F.EDUCATION], ['employment', F.EMPLOYMENT], ['occupation', F.OCCUPATION], ['social_category', F.SOCIAL_CATEGORY], ['marital_status', F.MARITAL]]) {
    const v = pick(body[k], list);
    if (v) data[k] = v;
  }
  for (const [k, min, max, label] of [
    ['annual_income', 0, 1e9, 'Annual household income'], ['monthly_income', 0, 1e8, 'Monthly income'], ['family_size', 1, 50, 'Family size'],
    ['disability_percent', 0, 100, 'Disability percentage'], ['class12_percent', 0, 100, 'Class 12 marks'], ['last_exam_percent', 0, 100, 'Last exam marks'],
  ]) {
    const v = num(body[k], min, max);
    if (v === null) errors.push(`${label} is not valid.`);
    else if (v !== undefined) data[k] = v;
  }
  if (body.pincode) {
    if (!/^[1-9][0-9]{5}$/.test(String(body.pincode).trim())) errors.push('PIN code must be 6 digits.');
    else data.pincode = String(body.pincode).trim();
  }
  data.flags = {};
  for (const [k] of F.FLAGS) {
    const v = body['flag_' + k];
    if (v === 'yes') data.flags[k] = true;
    else if (v === 'no') data.flags[k] = false;
  }
  let state_id = null;
  let district_id = null;
  if (body.state_id) {
    const st = await db.one('SELECT id FROM states WHERE id = $1 AND active', [Number(body.state_id) || 0]);
    if (!st) errors.push('Please choose a valid state.');
    else state_id = st.id;
  }
  if (body.district_id && state_id) {
    const d = await db.one('SELECT id FROM districts WHERE id = $1 AND state_id = $2', [Number(body.district_id) || 0, state_id]);
    if (!d) errors.push('Please choose a district in the selected state.');
    else district_id = d.id;
  }
  return { data, state_id, district_id, errors };
}

async function saveProfile(userId, { data, state_id, district_id }, { complete } = {}) {
  await db.query(
    `INSERT INTO profiles (user_id, data, state_id, district_id, onboarding_complete, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (user_id) DO UPDATE SET data = $2, state_id = $3, district_id = $4,
       onboarding_complete = profiles.onboarding_complete OR $5, updated_at = now()`,
    [userId, JSON.stringify(data), state_id, district_id, Boolean(complete)]
  );
}

function profileCompleteness(p) {
  const d = p.data || {};
  const keys = ['gender', 'residence', 'education', 'employment', 'occupation', 'annual_income', 'family_size', 'social_category', 'marital_status'];
  let have = keys.filter((k) => d[k] !== undefined).length + (d.dob || d.age !== undefined ? 1 : 0) + (p.state_id ? 1 : 0) + (p.district_id ? 1 : 0);
  const total = keys.length + 3 + 8;
  have += Math.min(8, Object.keys(d.flags || {}).length);
  return Math.round((have / total) * 100);
}

/** Run the full engine for a profile → grouped results + unlock suggestions. */
async function matchProfile(profile, userId) {
  const facts = buildFacts(profile.data, { state_code: profile.state_code, district_id: profile.district_id });
  const schemes = await candidateSchemes(profile.state_code);
  const groups = matchAll(schemes, facts);
  let statuses = {};
  if (userId) {
    const rows = await db.many('SELECT scheme_id, status FROM user_schemes WHERE user_id = $1', [userId]);
    statuses = Object.fromEntries(rows.map((r) => [r.scheme_id, r.status]));
  }
  for (const g of Object.values(groups)) for (const ev of g) ev.userStatus = statuses[ev.scheme.id] || null;
  // Missed Benefits: potentially eligible schemes the citizen hasn't saved, applied for or dismissed.
  const missed = groups.eligible.filter((ev) => !ev.userStatus);
  const unlock = unlockSuggestions(groups.more_info).slice(0, 5);
  return { facts, groups, missed, unlock, total: schemes.length };
}

async function evaluateForUser(scheme, profile) {
  const facts = buildFacts(profile.data, { state_code: profile.state_code, district_id: profile.district_id });
  return evaluateScheme(scheme, facts);
}

module.exports = {
  PUBLIC_VERIFICATION, states, districtsByState, stateByCode, searchSchemes, schemeBySlug, candidateSchemes, schemeCounts, stateSchemeCounts,
  getProfile, parseProfileForm, saveProfile, profileCompleteness, matchProfile, evaluateForUser,
};
