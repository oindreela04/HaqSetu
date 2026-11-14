'use strict';
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function timingSafeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/** Synchroniser-token CSRF protection bound to the server-side session. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomToken(24);
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!timingSafeEqual(sent, req.session.csrf)) {
    res.status(403);
    return res.render('error', { title: 'Session expired', message: 'Your form expired or was submitted from another page. Please go back, refresh and try again.' });
  }
  return next();
}

/** Load the logged-in user (if any) onto req/res. */
async function loadUser(req, res, next) {
  res.locals.user = null;
  if (!req.session.userId) return next();
  try {
    const u = await db.one(
      `SELECT u.id, u.name, u.email, u.mobile, u.role, u.email_verified_at, u.created_at,
              p.onboarding_complete
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [req.session.userId]
    );
    if (!u) {
      delete req.session.userId;
      return next();
    }
    req.user = u;
    res.locals.user = u;
    return next();
  } catch (e) {
    return next(e);
  }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  req.flash('info', 'Please log in to continue.');
  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role)) return next();
    res.status(403);
    return res.render('error', { title: 'Not allowed', message: 'You do not have permission to view this page.' });
  };
}

/** Tiny session flash implementation */
function flash(req, res, next) {
  req.flash = (type, msg) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, msg });
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
}

const limiterOpts = (max, windowMin, message) => ({
  windowMs: windowMin * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429);
    res.render('error', { title: 'Too many attempts', message });
  },
});
const authLimiter = rateLimit(limiterOpts(Number(process.env.AUTH_RATE_MAX || 10), 15, 'Too many attempts from your network. Please wait 15 minutes and try again.'));
const sensitiveLimiter = rateLimit(limiterOpts(5, 60, 'Too many requests. Please wait an hour and try again.'));
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

async function audit(actorId, action, entity = '', entityId = '', details = {}) {
  try {
    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)', [
      actorId || null, action, entity, String(entityId || ''), JSON.stringify(details),
    ]);
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

/** Password policy: 8+ chars, at least one letter and one number. */
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain at least one letter and one number.';
  return null;
}

module.exports = {
  randomToken, sha256, csrf, loadUser, requireAuth, requireRole, flash, authLimiter, sensitiveLimiter, globalLimiter, audit, passwordProblem,
};
