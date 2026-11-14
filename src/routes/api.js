'use strict';
const express = require('express');
const svc = require('../services');

const router = express.Router();

router.get('/states', async (req, res, next) => {
  try { res.json(await svc.states()); } catch (e) { next(e); }
});

router.get('/districts', async (req, res, next) => {
  try {
    const s = String(req.query.state || '');
    if (/^\d+$/.test(s)) return res.json(await svc.districtsByState(Number(s)));
    if (/^[A-Z]{2,4}$/.test(s)) return res.json(await svc.districtsByState(s));
    return res.json([]);
  } catch (e) { next(e); }
});

// Public read-only scheme listing (open data)
router.get('/schemes', async (req, res, next) => {
  try {
    const r = await svc.searchSchemes({
      q: String(req.query.q || '').slice(0, 100), state: /^[A-Z]{2,4}$/.test(req.query.state || '') ? req.query.state : '',
      level: String(req.query.level || ''), category: String(req.query.category || ''), page: Number(req.query.page) || 1, perPage: 50,
    });
    res.json({ total: r.total, page: r.page, pages: r.pages, schemes: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
