(function () {
  'use strict';
  // Visual builder for simple "all" rule lists. The JSON textarea stays the source of truth.
  var host = document.getElementById('rule-builder');
  var ta = document.getElementById('rules-json');
  if (!host || !ta) return;
  var FIELDS = JSON.parse(host.getAttribute('data-fields'));
  var OPS = {
    number: [['gte', '≥'], ['lte', '≤'], ['between', 'between'], ['gt', '>'], ['lt', '<'], ['eq', '=']],
    enum: [['in', 'is one of'], ['nin', 'is not one of'], ['eq', 'is'], ['neq', 'is not'], ['level_gte', 'at least (education)'], ['level_lte', 'at most (education)']],
    bool: [['is', 'is']],
  };

  function parse() { try { return JSON.parse(ta.value || '{"all":[]}'); } catch (e) { return null; } }
  function isSimple(r) { return r && Array.isArray(r.all) && r.all.every(function (n) { return n && n.field && !n.all && !n.any; }); }
  function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }

  function render() {
    host.innerHTML = '';
    var rules = parse();
    if (!rules) { host.appendChild(el('p', { class: 'flash flash-error' }, 'The JSON below is invalid — fix it to use the builder.')); return; }
    if (!isSimple(rules)) { host.appendChild(el('p', { class: 'muted small' }, 'These rules contain OR-groups — edit them in the JSON box below.')); return; }
    rules.all.forEach(function (leaf, i) { host.appendChild(row(leaf, i)); });
    var add = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '+ Add condition');
    add.onclick = function () { var r = parse(); r.all.push({ field: 'age', op: 'gte', value: 18 }); write(r); };
    var addM = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '+ Manual condition');
    addM.onclick = function () { var r = parse(); r.all.push({ field: '__manual', op: 'manual', label: 'Describe the condition' }); write(r); };
    host.appendChild(add); host.appendChild(addM);
  }

  function write(r) { ta.value = JSON.stringify(r, null, 2); render(); }

  function row(leaf, i) {
    var wrap = el('div', { class: 'rb-row' });
    if (leaf.op === 'manual') {
      var lab = el('input', { value: leaf.label || '', placeholder: 'Condition checked by the applicant / office' });
      lab.style.gridColumn = 'span 3';
      lab.oninput = function () { var r = parse(); r.all[i].label = lab.value; ta.value = JSON.stringify(r, null, 2); };
      wrap.appendChild(lab);
    } else {
      var fsel = el('select');
      Object.keys(FIELDS).forEach(function (k) { var o = el('option', { value: k }, FIELDS[k].label); if (k === leaf.field) o.selected = true; fsel.appendChild(o); });
      var type = (FIELDS[leaf.field] || {}).type || 'number';
      var osel = el('select');
      OPS[type].forEach(function (op) { var o = el('option', { value: op[0] }, op[1]); if (op[0] === leaf.op) o.selected = true; osel.appendChild(o); });
      var val;
      if (type === 'bool') {
        val = el('select'); [['true', 'Yes'], ['false', 'No']].forEach(function (o) { var x = el('option', { value: o[0] }, o[1]); if (String(leaf.value) === o[0]) x.selected = true; val.appendChild(x); });
      } else if (type === 'enum') {
        val = el('select', { multiple: 'multiple', size: '3' });
        var cur = [].concat(leaf.value);
        FIELDS[leaf.field].options.forEach(function (o) { var x = el('option', { value: o[0] }, o[1]); if (cur.indexOf(o[0]) >= 0) x.selected = true; val.appendChild(x); });
      } else {
        val = el('input', { value: Array.isArray(leaf.value) ? leaf.value.join(',') : (leaf.value == null ? '' : leaf.value), placeholder: leaf.op === 'between' ? 'min,max' : 'value' });
      }
      function sync() {
        var r = parse(); var n = r.all[i];
        var newField = fsel.value; var t = FIELDS[newField].type;
        if (newField !== n.field) { n.field = newField; n.op = OPS[t][0][0]; n.value = t === 'bool' ? true : t === 'enum' ? [] : 0; delete n.label; return write(r); }
        n.op = osel.value;
        if (t === 'bool') n.value = val.value === 'true';
        else if (t === 'enum') { var sel = Array.prototype.filter.call(val.options, function (o) { return o.selected; }).map(function (o) { return o.value; }); n.value = (n.op === 'in' || n.op === 'nin') ? sel : sel[0]; }
        else if (n.op === 'between') n.value = String(val.value).split(',').map(Number);
        else n.value = Number(val.value);
        ta.value = JSON.stringify(r, null, 2);
      }
      fsel.onchange = sync; osel.onchange = sync; val.onchange = sync; val.oninput = sync;
      wrap.appendChild(fsel); wrap.appendChild(osel); wrap.appendChild(val);
    }
    var mand = el('label', { class: 'check small', title: 'If unticked, the condition is shown but does not affect the result' });
    var cb = el('input', { type: 'checkbox' }); cb.checked = leaf.mandatory !== false;
    cb.onchange = function () { var r = parse(); if (cb.checked) delete r.all[i].mandatory; else r.all[i].mandatory = false; ta.value = JSON.stringify(r, null, 2); };
    mand.appendChild(cb); mand.appendChild(document.createTextNode(' required'));
    var del = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Remove' }, '✕');
    del.onclick = function () { var r = parse(); r.all.splice(i, 1); write(r); };
    wrap.appendChild(mand); wrap.appendChild(del);
    return wrap;
  }

  ta.addEventListener('change', render);
  render();
})();
