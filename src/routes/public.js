'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const sec = require('../security');
const { describe } = require('../eligibility');

const router = express.Router();

const myschemeStateLink = (name) => `https://www.myscheme.gov.in/search/state/${encodeURIComponent(name)}`;

router.get('/', async (req, res, next) => {
  try {
    const [counts, states] = await Promise.all([svc.schemeCounts(), svc.stateSchemeCounts()]);
    res.render('home', { title: null, counts, states });
  } catch (e) { next(e); }
});

router.get('/schemes', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const state = /^[A-Z]{2,4}$/.test(req.query.state || '') ? req.query.state : '';
    const level = String(req.query.level || '');
    const category = String(req.query.category || '');
    const page = Math.max(1, Number(req.query.page) || 1);
    const [result, states] = await Promise.all([svc.searchSchemes({ q, state, level, category, page }), svc.states()]);
    const stateRow = state ? states.find((s) => s.code === state) : null;
    res.render('schemes/list', { title: 'Government schemes', result, states, filters: { q, state, level, category }, stateRow, myschemeLink: stateRow ? myschemeStateLink(stateRow.name) : null });
  } catch (e) { next(e); }
});

router.get('/states/:code', (req, res) => res.redirect(`/schemes?state=${encodeURIComponent(req.params.code.toUpperCase())}`));

router.get('/schemes/:slug', async (req, res, next) => {
  try {
    const canSeeHidden = req.user && ['admin', 'reviewer'].includes(req.user.role);
    const scheme = await svc.schemeBySlug(req.params.slug, { includeHidden: canSeeHidden });
    if (!scheme) return res.status(404).render('error', { title: 'Scheme not found', message: 'This scheme does not exist or is no longer listed.' });
    let evaluation = null;
    let userStatus = null;
    let profileIncomplete = false;
    if (req.user) {
      const profile = await svc.getProfile(req.user.id);
      evaluation = await svc.evaluateForUser(scheme, profile);
      profileIncomplete = !profile.onboarding_complete;
      const us = await db.one('SELECT status FROM user_schemes WHERE user_id = $1 AND scheme_id = $2', [req.user.id, scheme.id]);
      userStatus = us && us.status;
    }
    const stateNames = scheme.state_codes.length ? (await db.many('SELECT name FROM states WHERE code = ANY($1) ORDER BY name', [scheme.state_codes])).map((r) => r.name) : [];
    const districtNames = scheme.district_ids.length ? (await db.many('SELECT name FROM districts WHERE id = ANY($1) ORDER BY name', [scheme.district_ids])).map((r) => r.name) : [];
    // Human-readable list of rules for everyone (logged in or not)
    const ruleLines = [];
    (function walk(node, prefix) {
      if (!node) return;
      if (Array.isArray(node.all)) node.all.forEach((c) => walk(c, prefix));
      else if (Array.isArray(node.any)) {
        const parts = [];
        node.any.forEach((c) => { const sub = []; (function w2(n) { if (n.all) n.all.forEach(w2); else if (n.any) n.any.forEach(w2); else sub.push(describe(n)); })(c); parts.push(sub.join(' and ')); });
        ruleLines.push((node.label || 'Any one of') + ': ' + parts.join(' — OR — '));
      } else ruleLines.push(describe(node));
    })(scheme.rules, '');
    res.render('schemes/detail', { title: scheme.name, scheme, evaluation, userStatus, profileIncomplete, stateNames, districtNames, ruleLines, aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY) });
  } catch (e) { next(e); }
});

router.post('/schemes/:slug/report', sec.sensitiveLimiter, async (req, res, next) => {
  try {
    const scheme = await svc.schemeBySlug(req.params.slug, { includeHidden: true });
    const msg = String(req.body.message || '').trim().slice(0, 2000);
    if (scheme && msg.length >= 5) {
      await db.query('INSERT INTO scheme_reports (scheme_id, user_id, message) VALUES ($1,$2,$3)', [scheme.id, req.user ? req.user.id : null, msg]);
      req.flash('success', 'Thank you. Our reviewers will check this information against the official source.');
    } else {
      req.flash('warning', 'Please describe what looks wrong (at least a few words).');
    }
    res.redirect(`/schemes/${encodeURIComponent(req.params.slug)}#report`);
  } catch (e) { next(e); }
});

// ───────────── Quick check (no account needed, nothing stored) ─────────────
router.get('/check', async (req, res, next) => {
  try {
    const states = await svc.states();
    res.render('check', { title: 'Quick eligibility check', states, values: { flags: {} }, results: null, errors: [] });
  } catch (e) { next(e); }
});

router.post('/check', async (req, res, next) => {
  try {
    const states = await svc.states();
    const parsed = await svc.parseProfileForm(req.body);
    const values = { ...parsed.data, state_id: parsed.state_id, district_id: parsed.district_id };
    if (parsed.errors.length) return res.status(422).render('check', { title: 'Quick eligibility check', states, values, results: null, errors: parsed.errors });
    const st = parsed.state_id ? states.find((s) => s.id === parsed.state_id) : null;
    const profile = { data: parsed.data, state_id: parsed.state_id, district_id: parsed.district_id, state_code: st ? st.code : null };
    const results = await svc.matchProfile(profile, null);
    res.render('check', { title: 'Your results', states, values, results, errors: [], stateRow: st, myschemeLink: st ? myschemeStateLink(st.name) : null });
  } catch (e) { next(e); }
});

router.get('/about', (req, res) => res.render('pages/about', { title: 'About HaqSetu' }));
router.get('/privacy', (req, res) => res.render('pages/privacy', { title: 'Privacy policy' }));
router.get('/terms', (req, res) => res.render('pages/terms', { title: 'Terms of use' }));
router.get('/disclaimer', (req, res) => res.render('pages/disclaimer', { title: 'Disclaimer' }));
router.get('/lang/:code', (req, res) => {
  if (['en', 'hi', 'bn'].includes(req.params.code)) req.session.lang = req.params.code;
  const back = req.get('referer');
  let dest = '/';
  try { const u = new URL(back); if (u.host === req.get('host')) dest = u.pathname + u.search; } catch (_) { /* ignore */ }
  res.redirect(dest);
});

module.exports = router;
module.exports.myschemeStateLink = myschemeStateLink;
