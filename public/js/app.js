(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content;

  // Dependent district dropdown
  document.querySelectorAll('select[data-district-target]').forEach(function (stateSel) {
    var target = document.getElementById(stateSel.getAttribute('data-district-target'));
    if (!target) return;
    function load(selected) {
      var id = stateSel.value;
      target.innerHTML = '<option value="">' + (id ? 'Loading…' : '— Select state first —') + '</option>';
      if (!id) return;
      fetch('/api/districts?state=' + encodeURIComponent(id), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (rows) {
          target.innerHTML = '<option value="">— Select district —</option>';
          rows.forEach(function (d) {
            var o = document.createElement('option');
            o.value = d.id; o.textContent = d.name;
            if (String(d.id) === String(selected)) o.selected = true;
            target.appendChild(o);
          });
        })
        .catch(function () { target.innerHTML = '<option value="">Could not load districts</option>'; });
    }
    stateSel.addEventListener('change', function () { load(''); });
    load(target.getAttribute('data-selected'));
  });

  // Tabs
  document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    var root = tabs.parentElement;
    tabs.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
        root.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== btn.getAttribute('data-tab'); });
      });
    });
  });

  // Confirm dangerous forms
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // Simple-language explainer
  document.querySelectorAll('[data-explain]').forEach(function (box) {
    var btn = box.querySelector('button');
    var out = box.querySelector('.ai-out');
    btn.addEventListener('click', function () {
      btn.disabled = true; out.textContent = 'Preparing a simple explanation…';
      fetch(box.getAttribute('data-explain'), { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (j) { out.textContent = j.text || j.error || 'Not available right now.'; })
        .catch(function () { out.textContent = 'Not available right now.'; })
        .finally(function () { btn.disabled = false; });
    });
  });
})();
