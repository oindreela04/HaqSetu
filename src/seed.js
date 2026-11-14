'use strict';
const path = require('path');
const db = require('./db');
const { migrate } = require('./migrate');

const SCHEME_COLUMNS = [
  'slug', 'name', 'short_description', 'description', 'department', 'ministry', 'level', 'state_codes', 'district_ids',
  'beneficiary_categories', 'tags', 'eligibility_text', 'rules', 'benefits', 'benefit_amount', 'documents',
  'application_process', 'application_mode', 'deadline', 'deadline_note', 'official_url', 'apply_url', 'contact',
  'source_reference', 'source_url', 'last_verified_at', 'verification_status', 'verification_notes', 'status',
];

/** Insert or update locations. Never deletes; admins manage changes in the UI. */
async function seedLocations() {
  const data = require(path.join(__dirname, '..', 'data', 'locations.json'));
  for (const s of data) {
    const st = await db.one(
      `INSERT INTO states (code, name, type) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [s.code, s.name, s.type]
    );
    for (const d of s.districts) {
      await db.query('INSERT INTO districts (state_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [st.id, d]);
    }
  }
}

function schemeValues(s) {
  return SCHEME_COLUMNS.map((c) => {
    const v = s[c];
    if (c === 'rules') return JSON.stringify(v || { all: [] });
    if (['state_codes', 'district_ids', 'beneficiary_categories', 'tags', 'documents'].includes(c)) return v || [];
    if (['deadline', 'last_verified_at'].includes(c)) return v || null;
    if (c === 'verification_notes') return v !== undefined && v !== null ? v : 'Seeded 2026-11-14 from official portals and recent public reporting. Awaiting reviewer verification against the official notification.';
    return v === undefined || v === null ? (c === 'status' ? 'active' : c === 'verification_status' ? 'pending_review' : '') : v;
  });
}

/** Insert seed schemes that don't exist yet (by slug). Never overwrites admin edits. */
async function seedSchemes() {
  const schemes = require(path.join(__dirname, '..', 'data', 'schemes.js'));
  let added = 0;
  for (const s of schemes) {
    const placeholders = SCHEME_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
    const r = await db.query(
      `INSERT INTO schemes (${SCHEME_COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      schemeValues(s)
    );
    if (r.rowCount) {
      added++;
      await db.query(
        `INSERT INTO scheme_revisions (scheme_id, action, note, snapshot) VALUES ($1,'seed','Initial seed',$2)`,
        [r.rows[0].id, JSON.stringify(s)]
      );
    }
  }
  return added;
}

/** Promote configured admin emails (comma-separated ADMIN_EMAILS). */
async function promoteAdmins() {
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  await db.query(`UPDATE users SET role = 'admin' WHERE lower(email::text) = ANY($1) AND role <> 'admin'`, [emails]);
}

async function seedAll() {
  await migrate();
  await seedLocations();
  const added = await seedSchemes();
  await promoteAdmins();
  return { added };
}

module.exports = { seedAll, seedLocations, seedSchemes, promoteAdmins, SCHEME_COLUMNS, schemeValues };

if (require.main === module) {
  seedAll()
    .then((r) => { console.log('Seed complete', r); return db.pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
