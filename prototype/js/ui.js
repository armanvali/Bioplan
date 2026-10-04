/* StackSense prototype: shared UI pieces (chips, badges, stack cards, sheets, toasts). */
(function (SS) {
  'use strict';

  var ui = SS.ui = {};
  var icon = function (n, s, c) { return SS.icon(n, s, c); };

  ui.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var esc = ui.esc;

  SS.reducedMotion = function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  };
  SS.framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  /* ------------------------------------------------------------------ */
  ui.areaDots = function (supp, solid) {
    return '<span class="area-dots" aria-label="Body areas: ' + Object.keys(supp.contrib).map(function (a) { return SS.AREA[a].name; }).join(', ') + '">' +
      SS.AREAS.filter(function (a) { return supp.contrib[a.id]; }).map(function (a) {
        return '<span class="adot' + (solid ? ' is-solid' : '') + '" style="--c:' + a.color + '" title="' + esc(a.name) + '"></span>';
      }).join('') + '</span>';
  };

  ui.evidence = function (level) {
    return '<span class="ev ev-' + level.toLowerCase() + '">' + level + '</span>';
  };

  ui.slotIcon = function (slot) {
    return { breakfast: 'sun', lunch: 'meal', dinner: 'meal', winddown: 'moon' }[slot] || 'clock';
  };

  ui.formIcon = function (form) {
    return { powder: 'scoop', softgel: 'softgel', drops: 'drops', capsule: 'pill', tablet: 'pill', lozenge: 'pill', gummy: 'pill' }[form] || 'pill';
  };

  /** Neutral placeholder thumbnail: a bottle, tub or dropper in the supplement's tint. */
  ui.thumb = function (product, color) {
    var form = product ? product.form : 'capsule';
    var shape;
    if (form === 'powder') shape = '<rect x="9" y="16" width="30" height="26" rx="5"/><rect x="7" y="10" width="34" height="8" rx="3"/>';
    else if (form === 'drops') shape = '<rect x="15" y="20" width="18" height="22" rx="4"/><rect x="19" y="12" width="10" height="9" rx="2"/><rect x="21" y="5" width="6" height="8" rx="3"/>';
    else shape = '<rect x="12" y="14" width="24" height="28" rx="5"/><rect x="14" y="7" width="20" height="8" rx="2"/>';
    return '<span class="thumb" style="--c:' + color + '" aria-hidden="true"><svg viewBox="0 0 48 48" width="40" height="40">' + shape +
      '<rect class="thumb-label" x="' + (form === 'drops' ? 17 : 14) + '" y="' + (form === 'powder' ? 23 : 24) + '" width="' + (form === 'drops' ? 14 : form === 'powder' ? 20 : 20) + '" height="9" rx="2"/></svg></span>';
  };

  ui.certs = function (certs) {
    return (certs || []).map(function (c) { return '<span class="cert">' + esc(c) + '</span>'; }).join('');
  };

  ui.fitChip = function (p) {
    if (!p) return '';
    if (p.fit === 'fits') return '<span class="fit fit-ok">' + icon('check', 12) + 'Fits your dose</span>';
    if (p.fit === 'split') return '<span class="fit fit-warn">Split dose</span>';
    if (p.fit === 'lower') return '<span class="fit fit-warn">Lower dose</span>';
    return '<span class="fit fit-warn">Over your dose</span>';
  };

  ui.pricePerDay = function (p, supp) {
    if (!p) return '';
    var unit = supp.freq === 'mwf' ? '/dose' : '/day';
    return SS.fmt.money2(p.price) + '<small>' + unit + '</small>';
  };

  ui.buyLink = function (p, label, cls) {
    return '<a class="btn btn-buy ' + (cls || '') + '" href="' + esc(p.link) + '" target="_blank" rel="noopener sponsored" data-act="buy" data-arg="' + esc(p.id) + '">' +
      esc(label || 'Buy') + icon('external', 14) + '</a>';
  };

  /** Product row at the bottom of each stack card. */
  ui.productRow = function (item) {
    var p = item.product, prod = item.prod;
    if (!p) return '<div class="prow prow-empty">No product fits all your filters yet.</div>';
    var more = (prod.alt ? 1 : 0) + prod.others.length + prod.filtered.length + (prod.swapped ? 1 : 0);
    return '<div class="prow">' +
      ui.thumb(p, item.supp.color) +
      '<div class="prow-main">' +
      '<div class="prow-name"><b>' + esc(p.brand) + '</b> ' + esc(p.name) + '</div>' +
      '<div class="prow-tags">' + (prod.swapped ? '<span class="fit fit-swap">' + icon('swap', 12) + 'Swapped — original unavailable</span>' : '') +
      (prod.budgetPick ? '<span class="fit fit-swap">Budget pick</span>' : '') + ui.fitChip(p) + ui.certs(p.certs.slice(0, 2)) + '</div>' +
      '</div>' +
      '<div class="prow-buy"><span class="price">' + ui.pricePerDay(p, item.supp) + '</span>' + ui.buyLink(p) + '</div>' +
      '</div>' +
      (more ? '<button type="button" class="link-btn prow-more" data-act="product-sheet" data-arg="' + item.id + '">See ' + more + ' more' + icon('right', 14) + '</button>' : '');
  };

  /** Stack card (F28) with optional expanded detail (F29). */
  ui.stackCard = function (item, expanded, opts) {
    opts = opts || {};
    var s = item.supp, d = s.detail;
    var why = item.why.length ? 'You said: ' + esc(item.why.join(', ')) + '.' : '';
    var out = '<article class="scard' + (expanded ? ' is-open' : '') + '" data-supp="' + s.id + '" style="--c:' + s.color + '">' +
      '<button type="button" class="scard-head" data-act="toggle-card" data-arg="' + s.id + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
      '<span class="scard-icon">' + icon(ui.formIcon(item.form), 20) + '</span>' +
      '<span class="scard-titles"><span class="scard-name">' + esc(s.name) + (s.sub ? ' <span class="scard-sub">' + esc(s.sub) + '</span>' : '') + '</span>' +
      '<span class="scard-meta"><span class="dose">' + esc(s.dose) + '</span><span class="sep">·</span>' +
      '<span class="timing">' + icon(ui.slotIcon(s.slot), 14) + esc(s.when) + '</span></span></span>' +
      '<span class="scard-right">' + ui.evidence(s.evidence) + ui.areaDots(s, true) + '</span>' +
      '</button>' +
      (why ? '<p class="scard-why"><span class="why-label">Why you</span>' + why + '</p>' : '') +
      (item.note ? '<p class="scard-note">' + icon('leaf', 14) + esc(item.note) + '</p>' : '');
    if (expanded) {
      out += '<div class="scard-detail">' +
        '<div class="sd-block"><h4>What it does</h4><p>' + esc(d.does) + '</p></div>' +
        '<div class="sd-block"><h4>What the research says ' + ui.evidence(s.evidence) + '</h4><p>' + esc(d.research) + '</p></div>' +
        '<div class="sd-block"><h4>How to take it</h4><p>' + esc(d.how) + '</p></div>' +
        '<div class="sd-grid"><div class="sd-block"><h4>Side effects to watch</h4><p>' + esc(d.side) + '</p></div>' +
        '<div class="sd-block"><h4>Interacts with</h4><p>' + esc(d.interacts) + '</p></div></div>' +
        '<div class="sd-areas">' + SS.AREAS.filter(function (a) { return s.contrib[a.id]; }).map(function (a) {
          return '<span class="sd-area"><span class="area-dot" style="background:' + a.color + '"></span>' + esc(a.name) + ' <b>+' + SS.fmt.num(s.contrib[a.id]) + '</b></span>';
        }).join('') + '</div>' +
        '</div>';
    }
    out += ui.productRow(item) + '</article>';
    return out;
  };

  ui.lockedCard = function (locked, compact) {
    var src = locked.sources.filter(function (x) { return x.card !== 'B7'; }).map(function (x) { return x.text.toLowerCase(); });
    return '<article class="scard scard-locked">' +
      '<div class="scard-head is-static"><span class="scard-icon">' + icon('lock', 20) + '</span>' +
      '<span class="scard-titles"><span class="scard-name">Iron</span><span class="scard-meta">Not dosed · Test first</span></span>' +
      '<span class="scard-right"><span class="ev ev-locked">Locked</span></span></div>' +
      '<div class="locked-why"><h4>Why it’s locked</h4><p>Iron only helps if you’re actually low, and too much is harmful. Your answers point that way (' +
      esc(src.join(', ')) + '), but only a ferritin test can tell.</p></div>' +
      (compact ? '' : '<div class="locked-actions"><button type="button" class="btn btn-secondary" data-act="labs">' + icon('flask', 16) + 'Enter lab result</button>' +
        '<button type="button" class="btn btn-secondary" data-act="doctor-note">' + icon('doc', 16) + 'Get doctor note</button></div>') +
      '</article>';
  };

  ui.footer = function () {
    return '<footer class="fine-print"><p>' + esc(SS.AFFILIATE) + '</p><p>' + esc(SS.DISCLAIMER) + '</p></footer>';
  };

  ui.safetyBanner = function (title, text, extra) {
    return '<div class="safety-banner" role="note"><span class="sb-icon">' + icon('alert', 18) + '</span><div><strong>' + esc(title) + '</strong><p>' + text + '</p>' + (extra || '') + '</div></div>';
  };

  /* ------------------------------------------------------------------ */
  /* Sheets and toasts live in the active frame's layer. */
  function layer() { return document.getElementById(SS.state.device === 'desktop' ? 'deskLayer' : 'layer'); }

  ui.openSheet = function (html, opts) {
    opts = opts || {};
    var L = layer();
    ui.closeSheet(true);
    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap' + (opts.tall ? ' is-tall' : '');
    wrap.innerHTML = '<div class="sheet-scrim" data-act="close-sheet"></div>' +
      '<section class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.label || 'Details') + '">' +
      '<div class="sheet-grab" aria-hidden="true"></div>' +
      '<button type="button" class="sheet-close icon-btn" data-act="close-sheet" aria-label="Close">' + icon('x', 18) + '</button>' +
      '<div class="sheet-body">' + html + '</div></section>';
    L.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });
    SS.state.ui.sheet = opts.id || 'sheet';
    var focusEl = wrap.querySelector('.sheet-close');
    if (focusEl) try { focusEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    if (opts.onMount) opts.onMount(wrap);
    SS.app.updatePanels();
    return wrap;
  };

  ui.closeSheet = function (instant) {
    var L = layer();
    if (!L) return;
    L.querySelectorAll('.sheet-wrap').forEach(function (w) {
      if (instant || SS.reducedMotion()) { w.remove(); return; }
      w.classList.remove('is-in');
      setTimeout(function () { w.remove(); }, 220);
    });
    if (SS.state.ui.sheet) { SS.state.ui.sheet = null; if (!instant) SS.app.updatePanels(); }
  };

  var toastTimer = null;
  ui.toast = function (t, opts) {
    opts = opts || {};
    var L = layer();
    if (!L) return;
    var old = L.querySelector('.toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'toast toast-' + (opts.kind || 'branch');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="toast-icon">' + icon(opts.icon || 'sparkle', 16) + '</span><span class="toast-text">' + (opts.html ? t : esc(t)) + '</span>';
    L.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    clearTimeout(toastTimer);
    if (!opts.sticky) {
      toastTimer = setTimeout(function () {
        el.classList.remove('is-in');
        setTimeout(function () { el.remove(); }, 260);
      }, opts.ms || 2500);
    }
    return el;
  };

  /** Copy text, falling back to selecting it when the clipboard is refused. */
  ui.copy = function (text, selectEl, btn) {
    function done(ok) {
      if (btn) { var l = btn.innerHTML; btn.innerHTML = ok ? icon('check', 16) + 'Copied' : 'Select and copy'; setTimeout(function () { btn.innerHTML = l; }, 1600); }
      if (!ok && selectEl) { selectEl.focus(); if (selectEl.select) selectEl.select(); }
    }
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  };

  /** Save a text file when the page is allowed to; returns false inside sandboxed viewers. */
  ui.download = function (name, text, type) {
    if (SS.framed) return false;
    try {
      var blob = new Blob([text], { type: type || 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      return true;
    } catch (e) { return false; }
  };
})(window.SS = window.SS || {});
