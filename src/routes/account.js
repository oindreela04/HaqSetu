'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const svc = require('../services');
const sec = require('../security');
const { myschemeStateLink } = require('./public');

const router = express.Router();

// ───────────── Onboarding & profile ─────────────
async function renderProfileForm(req, res, view, extra = {}) {
  const [states, profile] = await Promise.all([svc.states(), svc.getProfile(req.user.id)]);
  const values = { ...(profile.data || {}), flags: (profile.data && profile.data.flags) || {}, state_id: profile.state_id, district_id: profile.district_id };
  res.render(view, { title: view === 'account/onboarding' ? 'Tell us about yourself' : 'Edit profile', states, values, errors: [], ...extra });
}

router.get('/onboarding', sec.requireAuth, (req, res, next) => renderProfileForm(req, res, 'account/onboarding').catch(next));
router.get('/profile', sec.requireAuth, (req, res, next) => renderProfileForm(req, res, 'account/profile').catch(next));

async function handleProfilePost(req, res, view) {
  const parsed = await svc.parseProfileForm(req.body);
  if (parsed.errors.length) {
    const states = await svc.states();
    return res.status(422).render(view, { title: 'Profile', states, values: { ...parsed.data, state_id: parsed.state_id, district_id: parsed.district_id }, errors: parsed.errors });
  }
  if (!parsed.state_id) {
    const states = await svc.states();
    return res.status(422).render(view, { title: 'Profile', states, values: { ...parsed.data, state_id: null, district_id: parsed.district_id }, errors: ['Please choose your state or Union Territory — it decides which state schemes you see.'] });
  }
  await svc.saveProfile(req.user.id, parsed, { complete: true });
  await sec.audit(req.user.id, 'profile.update', 'user', req.user.id);
  req.flash('success', view === 'account/onboarding' ? 'Profile saved! Here are the schemes that match you.' : 'Profile updated. Your recommendations have been refreshed.');
  return res.redirect('/dashboard');
}
router.post('/onboarding', sec.requireAuth, (req, res, next) => handleProfilePost(req, res, 'account/onboarding').catch(next));
router.post('/profile', sec.requireAuth, (req, res, next) => handleProfilePost(req, res, 'account/profile').catch(next));

// ───────────── Dashboard ─────────────
router.get('/dashboard', sec.requireAuth, async (req, res, next) => {
  try {
    const profile = await svc.getProfile(req.user.id);
    if (!profile.onboarding_complete) return res.redirect('/onboarding');
    const consent = await db.one('SELECT * FROM consents WHERE user_id = $1', [req.user.id]);
    const matchingAllowed = !consent || consent.use_profile_for_matching;
    const results = matchingAllowed ? await svc.matchProfile(profile, req.user.id) : null;
    const saved = await db.many(
      `SELECT s.slug, s.name, s.level, s.benefit_amount, us.status, us.updated_at
         FROM user_schemes us JOIN schemes s ON s.id = us.scheme_id
        WHERE us.user_id = $1 AND us.status IN ('saved','applied') ORDER BY us.updated_at DESC`,
      [req.user.id]
    );
    res.render('account/dashboard', {
      title: 'My benefits', profile, results, saved, matchingAllowed,
      completeness: svc.profileCompleteness(profile),
      tab: ['eligible', 'more_info', 'not_eligible'].includes(req.query.tab) ? req.query.tab : 'eligible',
      myschemeLink: profile.state_name ? myschemeStateLink(profile.state_name) : null,
    });
  } catch (e) { next(e); }
});

router.post('/my-schemes/:id', sec.requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || '');
    const scheme = await db.one('SELECT id, slug FROM schemes WHERE id = $1', [id]);
    if (!scheme) return res.redirect('/dashboard');
    if (status === 'clear') await db.query('DELETE FROM user_schemes WHERE user_id = $1 AND scheme_id = $2', [req.user.id, id]);
    else if (['saved', 'applied', 'dismissed'].includes(status)) {
      await db.query(
        `INSERT INTO user_schemes (user_id, scheme_id, status) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, scheme_id) DO UPDATE SET status = $3, updated_at = now()`,
        [req.user.id, id, status]
      );
    }
    const back = String(req.body.back || '');
    res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/schemes/${scheme.slug}`);
  } catch (e) { next(e); }
});

// ───────────── Account settings ─────────────
router.get('/account', sec.requireAuth, async (req, res, next) => {
  try {
    const consent = (await db.one('SELECT * FROM consents WHERE user_id = $1', [req.user.id])) || { use_profile_for_matching: true, email_updates: false, deadline_reminders: false };
    res.render('account/settings', { title: 'Account & privacy', consent, errors: [], mailConfigured: require('../mail').configured });
  } catch (e) { next(e); }
});

router.post('/account/details', sec.requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 120);
    const mobile = String(req.body.mobile || '').replace(/\s+/g, '');
    if (name.length < 2) { req.flash('error', 'Please enter your full name.'); return res.redirect('/account'); }
    if (mobile && !/^(\+91[\s-]?)?[6-9][0-9]{9}$/.test(mobile)) { req.flash('error', 'Please enter a valid 10-digit Indian mobile number.'); return res.redirect('/account'); }
    await db.query('UPDATE users SET name = $2, mobile = $3, updated_at = now() WHERE id = $1', [req.user.id, name, mobile || null]);
    req.flash('success', 'Details updated.');
    res.redirect('/account');
  } catch (e) { next(e); }
});

router.post('/account/password', sec.requireAuth, sec.authLimiter, async (req, res, next) => {
  try {
    const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.current_password || ''), u.password_hash))) { req.flash('error', 'Your current password is incorrect.'); return res.redirect('/account'); }
    const pw = String(req.body.password || '');
    const err = sec.passwordProblem(pw) || (pw !== req.body.password_confirm ? 'New passwords do not match.' : null);
    if (err) { req.flash('error', err); return res.redirect('/account'); }
    await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await bcrypt.hash(pw, Number(process.env.BCRYPT_ROUNDS || 12))]);
    await db.query(`DELETE FROM "session" WHERE (sess->>'userId') = $1 AND sid <> $2`, [req.user.id, req.sessionID]);
    await sec.audit(req.user.id, 'user.password_change', 'user', req.user.id);
    req.flash('success', 'Password changed. Other devices have been signed out.');
    res.redirect('/account');
  } catch (e) { next(e); }
});

router.post('/account/consent', sec.requireAuth, async (req, res, next) => {
  try {
    const v = (k) => req.body[k] === 'on';
    await db.query(
      `INSERT INTO consents (user_id, use_profile_for_matching, email_updates, deadline_reminders, updated_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (user_id) DO UPDATE SET use_profile_for_matching = $2, email_updates = $3, deadline_reminders = $4, updated_at = now()`,
      [req.user.id, v('use_profile_for_matching'), v('email_updates'), v('deadline_reminders')]
    );
    await sec.audit(req.user.id, 'user.consent_update', 'user', req.user.id, { matching: v('use_profile_for_matching'), email: v('email_updates') });
    req.flash('success', 'Privacy preferences saved.');
    res.redirect('/account');
  } catch (e) { next(e); }
});

router.get('/account/export', sec.requireAuth, async (req, res, next) => {
  try {
    const [user, profile, consent, schemes] = await Promise.all([
      db.one('SELECT id, name, email, mobile, role, email_verified_at, created_at, last_login_at FROM users WHERE id = $1', [req.user.id]),
      svc.getProfile(req.user.id),
      db.one('SELECT use_profile_for_matching, email_updates, deadline_reminders, consent_version, updated_at FROM consents WHERE user_id = $1', [req.user.id]),
      db.many('SELECT s.name, us.status, us.updated_at FROM user_schemes us JOIN schemes s ON s.id = us.scheme_id WHERE us.user_id = $1', [req.user.id]),
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="haqsetu-my-data.json"');
    res.json({ exported_at: new Date().toISOString(), user, profile: { state: profile.state_name, district: profile.district_name, details: profile.data }, consent, schemes });
  } catch (e) { next(e); }
});

router.post('/account/delete', sec.requireAuth, sec.authLimiter, async (req, res, next) => {
  try {
    const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (req.body.confirm !== 'DELETE' || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
      req.flash('error', 'To delete your account, type DELETE and enter your current password.');
      return res.redirect('/account#delete');
    }
    const id = req.user.id;
    await sec.audit(null, 'user.deleted', 'user', id);
    await db.query(`DELETE FROM "session" WHERE (sess->>'userId') = $1`, [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]); // cascades to profile, consents, tokens, saved schemes
    req.session.regenerate(() => {
      req.flash('success', 'Your account and all personal data have been permanently deleted.');
      res.redirect('/');
    });
  } catch (e) { next(e); }
});

// ───────────── Optional AI explainer (never decides eligibility) ─────────────
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
router.post('/schemes/:slug/explain', sec.requireAuth, aiLimiter, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'The simple-language explainer is not enabled on this server.' });
  try {
    const s = await svc.schemeBySlug(req.params.slug);
    if (!s) return res.status(404).json({ error: 'Scheme not found' });
    const lang = { hi: 'Hindi', bn: 'Bengali' }[res.locals.lang] || 'simple English';
    const record = {
      name: s.name, description: s.description, eligibility: s.eligibility_text, benefits: s.benefits,
      documents: s.documents, how_to_apply: s.application_process, official_link: s.official_url, deadline: s.deadline_note,
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 600,
        system: 'You explain Indian government schemes to citizens with little formal education. Use ONLY the scheme record provided. Do not add any rule, amount, date or link that is not in the record. Never say the reader is eligible or will be approved; say the government department decides. Use short sentences and bullet points. End with: "Always confirm on the official website."',
        messages: [{ role: 'user', content: `Explain this scheme in ${lang} in under 180 words.\n\nSCHEME RECORD (JSON):\n${JSON.stringify(record)}` }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'The explainer is temporarily unavailable.' });
    const j = await r.json();
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return res.json({ text });
  } catch (e) {
    console.error('[ai]', e.message);
    return res.status(502).json({ error: 'The explainer is temporarily unavailable.' });
  }
});

module.exports = router;
