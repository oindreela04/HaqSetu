'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const db = require('./db');
const sec = require('./security');
const i18n = require('./i18n');
const F = require('./profileFields');

function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  if (process.env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: isProd ? '7d' : 0 }));
  app.get('/healthz', async (req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); }
  });
  app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /account\n'));

  app.use(sec.globalLimiter);
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));

  if (isProd && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production');
  app.use(session({
    store: new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 60 * 15 }),
    name: 'haqsetu.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 3600 * 1000 },
  }));

  app.use((req, res, next) => {
    res.locals.F = F;
    res.locals.path = req.path;
    res.locals.title = null;
    res.locals.user = null;
    res.locals.csrfToken = '';
    res.locals.siteUrl = process.env.SITE_URL || '';
    next();
  });
  app.use(sec.flash);
  app.use(i18n.middleware);
  app.use(sec.csrf);
  app.use(sec.loadUser);

  app.use(require('./routes/public'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/account'));
  app.use('/admin', require('./routes/admin'));
  app.use('/api', require('./routes/api'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
  });
  return app;
}

module.exports = { createApp };
