'use strict';
/**
 * Deterministic, explainable eligibility engine.
 *
 * Rules are stored per scheme as JSON:
 *   { "all": [ <node>, ... ] }   every node must hold
 *   { "any": [ <node>, ... ] }   at least one node must hold
 *   leaf: { "field": "age", "op": "between", "value": [18, 40], "label": "optional custom text",
 *           "mandatory": true }
 *
 * Every leaf evaluates to TRUE, FALSE or UNKNOWN (missing profile data).
 * No language model is involved in any decision here.
 */
const { FIELDS, EDU_ORDER, optionLabel } = require('./profileFields');

const STATUS = {
  ELIGIBLE: 'eligible',
  MORE_INFO: 'more_info',
  NOT_ELIGIBLE: 'not_eligible',
};

function ageFromDob(dob, today = new Date()) {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

/** Turn a stored profile into the flat fact object the rules use. */
function buildFacts(profileData = {}, location = {}) {
  const f = {};
  const p = profileData || {};
  const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
  f.age = p.dob ? ageFromDob(p.dob) : num(p.age);
  for (const k of ['gender', 'residence', 'education', 'employment', 'occupation', 'social_category', 'marital_status']) {
    if (p[k] && p[k] !== 'prefer_not') f[k] = p[k];
  }
  f.annual_income = num(p.annual_income);
  f.monthly_income = num(p.monthly_income);
  if (f.monthly_income === undefined && f.annual_income !== undefined && p.income_is_personal) {
    f.monthly_income = Math.round(f.annual_income / 12);
  }
  f.family_size = num(p.family_size);
  f.disability_percent = num(p.disability_percent);
  f.class12_percent = num(p.class12_percent);
  f.last_exam_percent = num(p.last_exam_percent);
  const flags = p.flags || {};
  for (const [k, v] of Object.entries(flags)) {
    if (v === true || v === 'yes') f[k] = true;
    else if (v === false || v === 'no') f[k] = false;
  }
  // Derived convenience facts
  if (f.has_disability === undefined && f.disability_percent !== undefined) f.has_disability = f.disability_percent > 0;
  f.state_code = location.state_code || undefined;
  f.district_id = location.district_id || undefined;
  return f;
}

function fmtValue(field, v) {
  const def = FIELDS[field];
  if (!def) return String(v);
  if (def.type === 'enum') return Array.isArray(v) ? v.map((x) => optionLabel(def.options, x)).join(', ') : optionLabel(def.options, v);
  if (def.unit === '₹') return '₹' + Number(v).toLocaleString('en-IN');
  if (def.unit === '%') return v + '%';
  return String(v);
}

function describe(leaf) {
  if (leaf.label) return leaf.label;
  const def = FIELDS[leaf.field] || { label: leaf.field };
  const L = def.label;
  const v = leaf.value;
  switch (leaf.op) {
    case 'gte': return `${L} at least ${fmtValue(leaf.field, v)}`;
    case 'gt': return `${L} more than ${fmtValue(leaf.field, v)}`;
    case 'lte': return `${L} up to ${fmtValue(leaf.field, v)}`;
    case 'lt': return `${L} below ${fmtValue(leaf.field, v)}`;
    case 'between': return `${L} between ${fmtValue(leaf.field, v[0])} and ${fmtValue(leaf.field, v[1])}`;
    case 'eq': return `${L}: ${fmtValue(leaf.field, v)}`;
    case 'neq': return `${L} is not ${fmtValue(leaf.field, v)}`;
    case 'in': return `${L}: ${fmtValue(leaf.field, v)}`;
    case 'nin': return `${L} is not ${fmtValue(leaf.field, v)}`;
    case 'level_gte': return `${L}: ${optionLabel(def.options || [], v)} or higher`;
    case 'level_lte': return `${L}: ${optionLabel(def.options || [], v)} or lower`;
    case 'is': return v ? L : `Not true: “${L}”`;
    default: return `${L} ${leaf.op} ${v}`;
  }
}

/** Evaluate a single leaf → true / false / null (unknown) */
function evalLeaf(leaf, facts) {
  if (leaf.op === 'manual') return null; // cannot be checked online — always needs confirmation
  const val = facts[leaf.field];
  if (val === undefined || val === null || val === '') return null;
  const v = leaf.value;
  switch (leaf.op) {
    case 'gte': return Number(val) >= Number(v);
    case 'gt': return Number(val) > Number(v);
    case 'lte': return Number(val) <= Number(v);
    case 'lt': return Number(val) < Number(v);
    case 'between': return Number(val) >= Number(v[0]) && Number(val) <= Number(v[1]);
    case 'eq': return val === v;
    case 'neq': return val !== v;
    case 'in': return Array.isArray(v) && v.includes(val);
    case 'nin': return Array.isArray(v) && !v.includes(val);
    case 'level_gte': return EDU_ORDER.indexOf(val) >= EDU_ORDER.indexOf(v);
    case 'level_lte': return EDU_ORDER.indexOf(val) <= EDU_ORDER.indexOf(v);
    case 'is': return Boolean(val) === Boolean(v);
    default: return null;
  }
}

/**
 * Recursively evaluate a rule tree. Collects leaf outcomes into `trace`.
 * Non-mandatory leaves are recorded but do not change the outcome.
 */
function evalNode(node, facts, trace, groupLabel) {
  if (!node || typeof node !== 'object') return true;
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const isAll = Array.isArray(node.all);
    const children = isAll ? node.all : node.any;
    if (children.length === 0) return true;
    const label = node.label || groupLabel;
    const results = [];
    for (const child of children) {
      const childTrace = [];
      const r = evalNode(child, facts, childTrace, label);
      results.push({ r, childTrace, mandatory: child.mandatory !== false });
    }
    let out;
    const counted = results.filter((x) => x.mandatory);
    if (counted.length === 0) out = true;
    else if (isAll) {
      out = counted.some((x) => x.r === false) ? false : counted.some((x) => x.r === null) ? null : true;
    } else {
      out = counted.some((x) => x.r === true) ? true : counted.some((x) => x.r === null) ? null : false;
    }
    if (!isAll) {
      // For "any" groups, summarise as one line so the explanation stays readable.
      const opts = results.map((x) => x.childTrace.map((t) => t.label).join(' and ')).filter(Boolean);
      const missing = [...new Set(results.flatMap((x) => x.childTrace.filter((t) => t.result === 'unknown').map((t) => t.field)))];
      trace.push({
        label: node.label || `Any one of: ${opts.join(' OR ')}`,
        result: out === true ? 'met' : out === false ? 'unmet' : 'unknown',
        field: missing[0] || null,
        fields: missing,
        mandatory: node.mandatory !== false,
      });
    } else {
      for (const x of results) trace.push(...x.childTrace);
    }
    return out;
  }
  let r = evalLeaf(node, facts);
  // Some conditions are proxies (e.g. a BPL card for the SECC list). A "no" there
  // does not prove ineligibility, so it becomes "needs verification" instead.
  if (r === false && node.falseIsUnknown) r = null;
  trace.push({
    label: describe(node),
    result: r === true ? 'met' : r === false ? 'unmet' : 'unknown',
    field: node.field,
    fields: r === null && node.op !== 'manual' && (facts[node.field] === undefined || facts[node.field] === null) ? [node.field] : [],
    mandatory: node.mandatory !== false,
  });
  return r;
}

/**
 * Is the scheme geographically applicable at all?
 * returns 'yes' | 'no' | 'unknown'
 */
function locationApplies(scheme, facts) {
  if (scheme.level === 'central') {
    // A central scheme may still be restricted to some states (e.g. NE region schemes).
    if (scheme.state_codes && scheme.state_codes.length) {
      if (!facts.state_code) return 'unknown';
      return scheme.state_codes.includes(facts.state_code) ? 'yes' : 'no';
    }
    return 'yes';
  }
  if (!facts.state_code) return 'unknown';
  if (!scheme.state_codes || !scheme.state_codes.includes(facts.state_code)) return 'no';
  if (scheme.level === 'district' || (scheme.district_ids && scheme.district_ids.length)) {
    if (!scheme.district_ids || scheme.district_ids.length === 0) return 'yes';
    if (!facts.district_id) return 'unknown';
    return scheme.district_ids.includes(Number(facts.district_id)) ? 'yes' : 'no';
  }
  return 'yes';
}

function evaluateScheme(scheme, facts) {
  const trace = [];
  const loc = locationApplies(scheme, facts);
  const levelName = { central: 'Central Government', state: 'State Government', ut: 'Union Territory', district: 'District' }[scheme.level];
  if (loc === 'no') {
    return { status: 'out_of_area', trace: [], reasons: [], scheme };
  }
  trace.push({
    label: scheme.level === 'central' && !(scheme.state_codes || []).length
      ? 'Available across India (Central Government scheme)'
      : `Available in your ${scheme.level === 'district' ? 'district' : 'state / UT'} (${levelName} scheme)`,
    result: loc === 'yes' ? 'met' : 'unknown',
    field: loc === 'yes' ? null : 'state',
    fields: loc === 'yes' ? [] : ['state'],
    mandatory: true,
  });
  const r = evalNode(scheme.rules || { all: [] }, facts, trace);
  const mandatory = trace.filter((t) => t.mandatory);
  let status;
  if (mandatory.some((t) => t.result === 'unmet')) status = STATUS.NOT_ELIGIBLE;
  else if (r === null || loc === 'unknown' || mandatory.some((t) => t.result === 'unknown')) status = STATUS.MORE_INFO;
  else status = STATUS.ELIGIBLE;

  const met = trace.filter((t) => t.result === 'met').map((t) => t.label);
  const unknown = trace.filter((t) => t.result === 'unknown');
  const unmet = trace.filter((t) => t.result === 'unmet' && t.mandatory).map((t) => t.label);
  const missingFields = [...new Set(unknown.flatMap((t) => t.fields || []).filter(Boolean))];

  let nextStep;
  if (status === STATUS.ELIGIBLE) {
    nextStep = 'Your details match the known rules. Check the required documents and apply through the official link. Final approval is decided by the government department.';
  } else if (status === STATUS.MORE_INFO) {
    nextStep = missingFields.length
      ? 'Add the missing details to your profile to get a clearer answer, then confirm on the official website.'
      : 'Some conditions cannot be checked online. Confirm them on the official website or at your nearest Common Service Centre (CSC).';
  } else {
    nextStep = 'One or more required conditions are not met based on your profile. If your situation changes, update your profile and check again.';
  }

  return {
    status,
    scheme,
    trace,
    met,
    unknown: unknown.map((t) => t.label),
    unmet,
    missingFields,
    nextStep,
    whyShown: `${levelName} scheme${scheme.beneficiary_categories && scheme.beneficiary_categories.length ? ' for ' + scheme.beneficiary_categories.join(', ') : ''} that applies to your location.`,
  };
}

/** Evaluate every scheme and group the results. */
function matchAll(schemes, facts) {
  const groups = { eligible: [], more_info: [], not_eligible: [] };
  for (const s of schemes) {
    const ev = evaluateScheme(s, facts);
    if (ev.status === 'out_of_area') continue;
    groups[ev.status].push(ev);
  }
  const byMet = (a, b) => b.met.length - a.met.length || a.missingFields.length - b.missingFields.length;
  groups.eligible.sort(byMet);
  groups.more_info.sort((a, b) => a.missingFields.length - b.missingFields.length || byMet(a, b));
  return groups;
}

/** Which missing questions would unlock the most schemes? */
function unlockSuggestions(moreInfo) {
  const counts = {};
  for (const ev of moreInfo) {
    for (const f of ev.missingFields) counts[f] = (counts[f] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => ({ field, count, label: field === 'state' ? 'Your state' : (FIELDS[field] ? FIELDS[field].label : field) }));
}

module.exports = { buildFacts, evaluateScheme, matchAll, unlockSuggestions, locationApplies, evalLeaf, ageFromDob, describe, STATUS };
