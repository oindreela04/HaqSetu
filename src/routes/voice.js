'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const svc = require('../services');
const sec = require('../security');
const voice = require('../voiceService');

const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests — please slow down.' } });

router.get('/voice', (req, res) => res.render('voice', { title: 'Voice assistant' }));

async function profileFor(req) {
  if (!req.user) return { user_id: null, profile: null };
  const consent = await db.one('SELECT use_profile_for_matching FROM consents WHERE user_id = $1', [req.user.id]);
  if (consent && !consent.use_profile_for_matching) return { user_id: req.user.id, profile: { data: {}, state_code: null, district_id: null } };
  const p = await svc.getProfile(req.user.id);
  return { user_id: req.user.id, profile: { data: p.data || {}, state_code: p.state_code || null, district_id: p.district_id || null, district_name: p.district_name || null } };
}

function unavailable(res) {
  return res.status(503).json({ error: 'The voice assistant is starting or temporarily unavailable. Please try again in a moment.', fallback: 'text' });
}

router.get('/voice-api/capabilities', async (req, res) => {
  if (!voice.isReady()) return unavailable(res);
  try {
    const r = await voice.call('GET', '/v1/capabilities', { timeout: 8000 });
    res.status(r.status).json(await r.json());
  } catch (e) { unavailable(res); }
});

router.post('/voice-api/chat', limiter, async (req, res) => {
  if (!voice.isReady()) return unavailable(res);
  try {
    const { user_id, profile } = await profileFor(req);
    const sessionKey = req.session.voiceSession || null;
    const r = await voice.call('POST', '/v1/chat', { json: { session_id: sessionKey, lang: String(req.body.lang || 'en').slice(0, 5), text: String(req.body.text || '').slice(0, 1000), user_id, profile } });
    const j = await r.json();
    if (j.session_id) req.session.voiceSession = j.session_id;
    // A confirmed save is remembered server-side; the browser cannot invent one.
    if (j.action === 'save_confirmed' && req.user) {
      req.session.voicePendingSave = { updates: j.updates, state_code: j.state_code, district_id: j.district_id, at: Date.now() };
    }
    delete j.session_id;
    res.status(r.status).json(j);
  } catch (e) {
    res.status(504).json({ error: 'The assistant did not respond in time. Please type your question or try again.', fallback: 'text' });
  }
});

router.post('/voice-api/save-profile', limiter, sec.requireAuth, async (req, res, next) => {
  try {
    const pending = req.session.voicePendingSave;
    if (!pending || Date.now() - pending.at > 10 * 60 * 1000) return res.status(409).json({ error: 'Nothing confirmed to save.' });
    delete req.session.voicePendingSave;
    const current = await svc.getProfile(req.user.id);
    const merged = { ...(current.data || {}) };
    const u = pending.updates || {};
    for (const [k, v] of Object.entries(u)) {
      if (k === 'flags' || k === '_location') continue;
      merged[k] = v;
      if (k === 'age') delete merged.dob;
    }
    const flags = {};
    for (const [k, v] of Object.entries({ ...(current.data && current.data.flags), ...(u.flags || {}) })) flags[`flag_${k}`] = v === true ? 'yes' : v === false ? 'no' : '';
    // Re-validate through the same parser used by the profile form.
    let stateId = current.state_id;
    let districtId = current.district_id;
    if (u._location && u._location.state_code) {
      const st = await db.one('SELECT id FROM states WHERE code = $1', [u._location.state_code]);
      if (st) { stateId = st.id; districtId = u._location.district_id || null; }
    }
    const parsed = await svc.parseProfileForm({ ...merged, ...flags, state_id: stateId, district_id: districtId });
    if (parsed.errors.length) return res.status(422).json({ error: parsed.errors.join(' ') });
    await svc.saveProfile(req.user.id, parsed, { complete: Boolean(parsed.state_id) });
    await sec.audit(req.user.id, 'profile.update_via_voice', 'user', req.user.id, { fields: Object.keys(u) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/voice-api/asr', limiter, express.raw({ type: 'multipart/form-data', limit: '7mb' }), async (req, res) => {
  if (!voice.isReady()) return unavailable(res);
  try {
    const r = await voice.call('POST', '/v1/asr', { body: req.body, headers: { 'content-type': req.get('content-type') }, timeout: 60000 });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(504).json({ error: 'Speech recognition timed out. Please type instead.', fallback: 'text' }); }
});

router.post('/voice-api/tts', limiter, async (req, res) => {
  if (!voice.isReady()) return unavailable(res);
  try {
    const r = await voice.call('POST', '/v1/tts', { json: { text: String(req.body.text || '').slice(0, 2000), lang: String(req.body.lang || 'en').slice(0, 5) }, timeout: 70000 });
    if (!r.ok) return res.status(r.status).json(await r.json());
    res.set('Content-Type', r.headers.get('content-type') || 'audio/wav');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(504).json({ error: 'Audio timed out.', fallback: 'device_or_text' }); }
});

router.post('/voice-api/reset', async (req, res) => {
  const sid = req.session.voiceSession;
  delete req.session.voiceSession;
  delete req.session.voicePendingSave;
  if (sid && voice.isReady()) { try { await voice.call('DELETE', `/v1/session/${encodeURIComponent(sid)}`, { timeout: 5000 }); } catch (_) { /* ignore */ } }
  res.json({ ok: true });
});

module.exports = router;
