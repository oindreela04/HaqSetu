'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFacts, evaluateScheme, matchAll, unlockSuggestions } = require('../src/eligibility');
const schemes = require('../data/schemes');

const byslug = (s) => schemes.find((x) => x.slug === s);

test('central scheme applies everywhere; state scheme only in its state', () => {
  const wb = buildFacts({ age: 30, gender: 'female', flags: { is_income_tax_payer: false, is_govt_employee_family: false } }, { state_code: 'WB' });
  const mh = buildFacts({ age: 30, gender: 'female', flags: { is_income_tax_payer: false, is_govt_employee_family: false } }, { state_code: 'MH' });
  assert.equal(evaluateScheme(byslug('wb-annapurna-bhandar'), wb).status, 'eligible');
  assert.equal(evaluateScheme(byslug('wb-annapurna-bhandar'), mh).status, 'out_of_area');
  assert.notEqual(evaluateScheme(byslug('pmjjby'), mh).status, 'out_of_area');
});

test('matchAll never returns another state\'s exclusive schemes', () => {
  const facts = buildFacts({ age: 25 }, { state_code: 'TN' });
  const g = matchAll(schemes, facts);
  const all = [...g.eligible, ...g.more_info, ...g.not_eligible];
  assert.ok(all.length > 0);
  for (const ev of all) assert.ok(ev.scheme.level === 'central', `${ev.scheme.slug} leaked into TN`);
});

test('three-state outcome with explanations', () => {
  const s = byslug('atal-pension-yojana');
  const yes = evaluateScheme(s, buildFacts({ age: 30, flags: { has_bank_account: true, is_income_tax_payer: false } }, { state_code: 'GA' }));
  assert.equal(yes.status, 'eligible');
  assert.ok(yes.met.length >= 3);
  const unknown = evaluateScheme(s, buildFacts({ age: 30 }, { state_code: 'GA' }));
  assert.equal(unknown.status, 'more_info');
  assert.deepEqual(unknown.missingFields.sort(), ['has_bank_account', 'is_income_tax_payer']);
  const no = evaluateScheme(s, buildFacts({ age: 55, flags: { has_bank_account: true } }, { state_code: 'GA' }));
  assert.equal(no.status, 'not_eligible');
  assert.ok(no.unmet.some((l) => /Age/.test(l)));
});

test('the brief example: WB student, 21, ₹1.8 lakh', () => {
  const facts = buildFacts({ age: 21, education: 'undergraduate', employment: 'student', annual_income: 180000, flags: { is_enrolled_in_education: true } }, { state_code: 'WB', district_id: 1 });
  const g = matchAll(schemes, facts);
  const slugs = (arr) => arr.map((e) => e.scheme.slug);
  assert.ok(slugs(g.more_info).includes('central-sector-scholarship-college'), 'merit scholarship needs percentile confirmation');
  assert.ok(!slugs([...g.eligible, ...g.more_info, ...g.not_eligible]).includes('mh-ladki-bahin'));
  assert.ok(slugs(g.not_eligible).includes('ignoaps'), 'old age pension is not for a 21-year-old');
});

test('OR groups: PMJAY eligible at 70+ regardless of BPL; BPL "no" is not a rejection', () => {
  const s = byslug('ab-pmjay');
  assert.equal(evaluateScheme(s, buildFacts({ age: 72, flags: { is_bpl: false } }, {})).status, 'eligible');
  assert.equal(evaluateScheme(s, buildFacts({ age: 40, flags: { is_bpl: false } }, {})).status, 'more_info');
  assert.equal(evaluateScheme(s, buildFacts({ age: 40, flags: { is_bpl: true } }, {})).status, 'eligible');
});

test('manual conditions always require confirmation and are not "missing profile fields"', () => {
  const s = byslug('central-sector-scholarship-college');
  const ev = evaluateScheme(s, buildFacts({ education: 'undergraduate', annual_income: 100000, flags: { is_enrolled_in_education: true } }, {}));
  assert.equal(ev.status, 'more_info');
  assert.deepEqual(ev.missingFields, []);
});

test('date of birth drives age', () => {
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - 65); dob.setDate(dob.getDate() - 1);
  assert.equal(buildFacts({ dob: dob.toISOString().slice(0, 10) }).age, 65);
});

test('unlock suggestions rank the most impactful missing answer first', () => {
  const g = matchAll(schemes, buildFacts({}, { state_code: 'UP' }));
  const u = unlockSuggestions(g.more_info);
  assert.ok(u.length > 0);
  assert.ok(u[0].count >= u[u.length - 1].count);
});

test('every seed scheme has an official https link and valid rules', () => {
  const { validateRules } = require('../src/routes/admin');
  for (const s of schemes) {
    assert.ok(/^https:\/\//.test(s.official_url), `${s.slug} official_url`);
    assert.equal(validateRules(s.rules), null, `${s.slug} rules`);
    if (s.level !== 'central') assert.ok(s.state_codes.length, `${s.slug} state codes`);
  }
});
