'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const sec = require('../security');
const mail = require('../mail');

const router = express.Router();
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MOBILE_RE = /^(\+91[\s-]?)?[6-9][0-9]{9}$/;

function baseUrl(req) {
  return process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
}

async function issueToken(userId, kind, hours) {
  const token = sec.randomToken(32);
  await db.query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
  await db.query(`INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval)`, [userId, kind, sec.sha256(token), String(hours)]);
  return token;
}

async function consumeToken(token, kind) {
  if (!token || token.length > 100) return null;
  return db.one(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sec.sha256(token), kind]
  );
}

async function sendVerification(req, user) {
  const token = await issueToken(user.id, 'verify_email', 48);
  const link = `${baseUrl(req)}/verify-email/${token}`;
  return mail.send(user.email, 'Verify your HaqSetu email',
    `Namaste ${user.name},\n\nPlease confirm your email address for HaqSetu by opening this link (valid for 48 hours):\n${link}\n\nIf you did not create an account, you can ignore this message.\n\n— HaqSetu`);
}

function startSession(req, user) {
  return new Promise((resolve, reject) => {
    const returnTo = req.session.returnTo;
    const lang = req.session.lang;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.lang = lang;
      req.session.save((e) => (e ? reject(e) : resolve(returnTo)));
    });
  });
}

// ───────────── Register ─────────────
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Create account', values: {}, errors: [] });
});

router.post('/register', sec.authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 120);
    const email = String(req.body.email || '').trim().toLowerCase();
    const mobile = String(req.body.mobile || '').replace(/\s+/g, '');
    const password = String(req.body.password || '');
    const errors = [];
    if (name.length < 2) errors.push('Please enter your full name.');
    if (!EMAIL_RE.test(email)) errors.push('Please enter a valid email address.');
    if (mobile && !MOBILE_RE.test(mobile)) errors.push('Please enter a valid 10-digit Indian mobile number.');
    const pwErr = sec.passwordProblem(password);
    if (pwErr) errors.push(pwErr);
    if (password !== req.body.password_confirm) errors.push('Passwords do not match.');
    if (req.body.consent !== 'on') errors.push('Please accept the Terms and Privacy Policy to continue.');
    if (errors.length) return res.status(422).render('auth/register', { title: 'Create account', values: { name, email, mobile }, errors });

    const exists = await db.one('SELECT id FROM users WHERE email = $1', [email]);
    if (exists) {
      return res.status(422).render('auth/register', { title: 'Create account', values: { name, email, mobile }, errors: ['An account with this email already exists. Try logging in or resetting your password.'] });
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const role = adminEmails.includes(email) ? 'admin' : 'citizen';
    const user = await db.one(
      `INSERT INTO users (name, email, mobile, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email`,
      [name, email, mobile || null, hash, role]
    );
    await db.query('INSERT INTO consents (user_id, use_profile_for_matching, email_updates) VALUES ($1, TRUE, $2)', [user.id, req.body.email_updates === 'on']);
    await db.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    await sec.audit(user.id, 'user.register', 'user', user.id);
    await sendVerification(req, user);
    await startSession(req, user);
    req.flash('success', mail.configured
      ? 'Welcome to HaqSetu! We sent a verification link to your email.'
      : 'Welcome to HaqSetu! Your account is ready.');
    return res.redirect('/onboarding');
  } catch (e) { return next(e); }
});

// ───────────── Login / logout ─────────────
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Log in', values: {}, errors: [] });
});

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

router.post('/login', sec.authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await db.one('SELECT id, name, email, password_hash, failed_logins, locked_until FROM users WHERE email = $1', [email]);
    const fail = (msg = 'Incorrect email or password.') => res.status(401).render('auth/login', { title: 'Log in', values: { email }, errors: [msg] });
    if (!user) { await bcrypt.compare(password, DUMMY_HASH); return fail(); }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return fail('Too many failed attempts. Your account is temporarily locked — try again in 15 minutes or reset your password.');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const n = user.failed_logins + 1;
      await db.query(`UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $2 >= 8 THEN now() + interval '15 minutes' ELSE NULL END WHERE id = $1`, [user.id, n >= 8 ? 0 : n]);
      await sec.audit(user.id, 'user.login_failed', 'user', user.id);
      return fail();
    }
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    const returnTo = await startSession(req, user);
    await sec.audit(user.id, 'user.login', 'user', user.id);
    const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';
    return res.redirect(safe);
  } catch (e) { return next(e); }
});

router.post('/logout', (req, res) => {
  const lang = req.session.lang;
  req.session.regenerate(() => {
    req.session.lang = lang;
    req.flash('success', 'You have been logged out.');
    res.redirect('/');
  });
});

// ───────────── Email verification ─────────────
router.get('/verify-email/:token', async (req, res, next) => {
  try {
    const t = await consumeToken(req.params.token, 'verify_email');
    if (!t) return res.status(400).render('error', { title: 'Link expired', message: 'This verification link is invalid or has expired. Log in and request a new one from your account page.' });
    await db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [t.user_id]);
    await sec.audit(t.user_id, 'user.email_verified', 'user', t.user_id);
    req.flash('success', 'Your email address is verified. Thank you!');
    return res.redirect(req.user ? '/account' : '/login');
  } catch (e) { return next(e); }
});

router.post('/verify-email/resend', sec.requireAuth, sec.sensitiveLimiter, async (req, res, next) => {
  try {
    if (req.user.email_verified_at) return res.redirect('/account');
    const r = await sendVerification(req, req.user);
    req.flash(r.delivered ? 'success' : 'warning', r.delivered ? 'A new verification link has been sent.' : 'Email delivery is not configured on this server yet. Please try again later.');
    return res.redirect('/account');
  } catch (e) { return next(e); }
});

// ───────────── Password reset ─────────────
router.get('/forgot-password', (req, res) => res.render('auth/forgot', { title: 'Reset password', sent: false }));

router.post('/forgot-password', sec.sensitiveLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = EMAIL_RE.test(email) ? await db.one('SELECT id, name, email FROM users WHERE email = $1', [email]) : null;
    if (user) {
      const token = await issueToken(user.id, 'reset_password', 1);
      await mail.send(user.email, 'Reset your HaqSetu password',
        `Namaste ${user.name},\n\nUse this link to set a new password (valid for 1 hour):\n${baseUrl(req)}/reset-password/${token}\n\nIf you did not ask for this, ignore this email — your password will not change.\n\n— HaqSetu`);
      await sec.audit(user.id, 'user.reset_requested', 'user', user.id);
    }
    // Same response whether or not the account exists (prevents account enumeration).
    return res.render('auth/forgot', { title: 'Reset password', sent: true, mailConfigured: mail.configured });
  } catch (e) { return next(e); }
});

router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const row = await db.one(`SELECT 1 FROM auth_tokens WHERE token_hash = $1 AND kind = 'reset_password' AND used_at IS NULL AND expires_at > now()`, [sec.sha256(req.params.token)]);
    if (!row) return res.status(400).render('error', { title: 'Link expired', message: 'This password reset link is invalid or has expired. Please request a new one.' });
    return res.render('auth/reset', { title: 'Choose a new password', token: req.params.token, errors: [] });
  } catch (e) { return next(e); }
});

router.post('/reset-password/:token', sec.authLimiter, async (req, res, next) => {
  try {
    const pw = String(req.body.password || '');
    const errors = [];
    const pwErr = sec.passwordProblem(pw);
    if (pwErr) errors.push(pwErr);
    if (pw !== req.body.password_confirm) errors.push('Passwords do not match.');
    if (errors.length) return res.status(422).render('auth/reset', { title: 'Choose a new password', token: req.params.token, errors });
    const t = await consumeToken(req.params.token, 'reset_password');
    if (!t) return res.status(400).render('error', { title: 'Link expired', message: 'This password reset link is invalid or has expired. Please request a new one.' });
    const hash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [t.user_id, hash]);
    // Sign out every existing session for this user.
    await db.query(`DELETE FROM "session" WHERE (sess->>'userId') = $1`, [t.user_id]);
    await sec.audit(t.user_id, 'user.password_reset', 'user', t.user_id);
    req.flash('success', 'Your password has been changed. Please log in.');
    return res.redirect('/login');
  } catch (e) { return next(e); }
});

module.exports = router;
module.exports.issueToken = issueToken;
