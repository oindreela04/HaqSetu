// Used by voice/tests: evaluates profiles against seed schemes with the JS engine.
const { buildFacts, evaluateScheme } = require('../src/eligibility');
const schemes = require('../data/schemes');
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const cases = JSON.parse(input);
  const out = cases.map((c) => schemes.map((s) => {
    const ev = evaluateScheme(s, buildFacts(c.profile, { state_code: c.state, district_id: c.district }));
    return { slug: s.slug, status: ev.status, missing: (ev.missingFields || []).slice().sort(), met: (ev.met || []).length, unmet: ev.unmet || [] };
  }));
  process.stdout.write(JSON.stringify(out));
});
