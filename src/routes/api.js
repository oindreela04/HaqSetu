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

module.exports = router;
