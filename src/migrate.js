'use strict';
const { pool } = require('./db');

const SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  code VARCHAR(4) UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('state','ut')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS districts (
  id SERIAL PRIMARY KEY,
  state_id INT NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state_id, name)
);

CREATE TABLE IF NOT EXISTS subdivisions (
  id SERIAL PRIMARY KEY,
  district_id INT NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'block',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (district_id, name, kind)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  mobile VARCHAR(15),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','reviewer','admin')),
  email_verified_at TIMESTAMPTZ,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  state_id INT REFERENCES states(id) ON DELETE SET NULL,
  district_id INT REFERENCES districts(id) ON DELETE SET NULL,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consents (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  use_profile_for_matching BOOLEAN NOT NULL DEFAULT TRUE,
  email_updates BOOLEAN NOT NULL DEFAULT FALSE,
  deadline_reminders BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version TEXT NOT NULL DEFAULT '2026-11',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email','reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schemes (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  ministry TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL CHECK (level IN ('central','state','ut','district')),
  state_codes TEXT[] NOT NULL DEFAULT '{}',
  district_ids INT[] NOT NULL DEFAULT '{}',
  beneficiary_categories TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  eligibility_text TEXT NOT NULL DEFAULT '',
  rules JSONB NOT NULL DEFAULT '{"all":[]}'::jsonb,
  benefits TEXT NOT NULL DEFAULT '',
  benefit_amount TEXT NOT NULL DEFAULT '',
  documents TEXT[] NOT NULL DEFAULT '{}',
  application_process TEXT NOT NULL DEFAULT '',
  application_mode TEXT NOT NULL DEFAULT '',
  deadline DATE,
  deadline_note TEXT NOT NULL DEFAULT '',
  official_url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  source_reference TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  last_verified_at DATE,
  verification_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft','pending_review','verified','needs_update')),
  verification_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','suspended','archived')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  search TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION schemes_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('simple', coalesce(NEW.name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.short_description,'') || ' ' || array_to_string(NEW.tags,' ') || ' ' || array_to_string(NEW.beneficiary_categories,' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description,'') || ' ' || coalesce(NEW.ministry,'') || ' ' || coalesce(NEW.department,'') || ' ' || coalesce(NEW.eligibility_text,'')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS schemes_search_trg ON schemes;
CREATE TRIGGER schemes_search_trg BEFORE INSERT OR UPDATE ON schemes FOR EACH ROW EXECUTE FUNCTION schemes_search_update();
CREATE INDEX IF NOT EXISTS schemes_search_idx ON schemes USING GIN (search);
CREATE INDEX IF NOT EXISTS schemes_states_idx ON schemes USING GIN (state_codes);
CREATE INDEX IF NOT EXISTS schemes_level_idx ON schemes (level, status);

CREATE TABLE IF NOT EXISTS scheme_revisions (
  id SERIAL PRIMARY KEY,
  scheme_id INT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_schemes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheme_id INT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('saved','applied','dismissed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scheme_id)
);

CREATE TABLE IF NOT EXISTS scheme_reports (
  id SERIAL PRIMARY KEY,
  scheme_id INT NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`;

async function migrate() {
  await pool.query(SQL);
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migrations complete'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
