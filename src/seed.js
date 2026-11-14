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

/**
 * Sync seed schemes from data/schemes.js:
 *  - new slugs are inserted;
 *  - existing rows that have never been edited by a person (updated_by IS NULL) are refreshed
 *    when the seed record changes, so catalogue updates shipped in code reach every deployment;
 *  - rows edited by admins/reviewers are never overwritten.
 */
async function seedSchemes() {
  const crypto = require('crypto');
  const schemes = require(path.join(__dirname, '..', 'data', 'schemes.js'));
  let added = 0;
  let updated = 0;
  for (const s of schemes) {
    const hash = crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 32);
    const vals = schemeValues(s);
    const existing = await db.one('SELECT id, updated_by, seed_hash FROM schemes WHERE slug = $1', [s.slug]);
    if (!existing) {
      const placeholders = SCHEME_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
      const r = await db.one(`INSERT INTO schemes (${SCHEME_COLUMNS.join(',')}, seed_hash) VALUES (${placeholders}, $${SCHEME_COLUMNS.length + 1}) RETURNING id`, [...vals, hash]);
      added++;
      await db.query(`INSERT INTO scheme_revisions (scheme_id, action, note, snapshot) VALUES ($1,'seed','Initial seed',$2)`, [r.id, JSON.stringify(s)]);
    } else if (!existing.updated_by && existing.seed_hash !== hash) {
      await db.query(`UPDATE schemes SET ${SCHEME_COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, seed_hash = $${SCHEME_COLUMNS.length + 1}, updated_at = now() WHERE id = $${SCHEME_COLUMNS.length + 2}`, [...vals, hash, existing.id]);
      updated++;
      await db.query(`INSERT INTO scheme_revisions (scheme_id, action, note, snapshot) VALUES ($1,'seed-update','Catalogue update shipped in code',$2)`, [existing.id, JSON.stringify(s)]);
    }
  }
  return { added, updated };
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
  const { added, updated } = await seedSchemes();
  await promoteAdmins();
  return { added, updated };
}

module.exports = { seedAll, seedLocations, seedSchemes, promoteAdmins, SCHEME_COLUMNS, schemeValues };

if (require.main === module) {
  seedAll()
    .then((r) => { console.log('Seed complete', r); return db.pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
