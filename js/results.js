/* StackSense prototype: review (E), analysis transition (F26) and results (F27–F31). */
(function (SS) {
  'use strict';

  var R = SS.results = {};
  var E = SS.engine, ui = SS.ui, esc = ui.esc, C = SS.charts;
  var icon = function (n, s, c) { return SS.icon(n, s, c); };
  var ACT = SS.actions = SS.actions || {};
  var S = function () { return SS.state; };

  /** Short, readable summary of a committed answer, for "You told us" lines. */
  R.answerSummary = function (cardId) {
    var st = S(), a = st.answers[cardId], card = SS.CARD[cardId];
    if (cardId === 'LAB') return 'Ferritin ' + st.labs.ferritin + ' µg/L';
    if (!a || !card) return '';
    if (a.notSure) return 'Not sure';
    var label = function (id) { var o = (card.options || []).filter(function (x) { return x.id === id; })[0]; return o ? o.label : id; };
    if (cardId === 'B3') { var y = a.follow && a.follow.years; return label(a.pick).replace(' (eggs + dairy)', '') + (y ? ' for ' + y + ' years' : ''); }
    if (cardId === 'C1') return (a.meds || []).map(function (id) { return SS.MED[id].name; }).join(', ') || 'None';
    if (card.type === 'single' || card.type === 'scale') return label(a.pick);
    if (card.type === 'multi') return (a.picks || []).map(label).join(', ');
    return '';
  };

  /* ------------------------------------------------------------------ */
  /* Screen E: Here's what we heard */
  R.review = function () {
    return {
      kind: 'review', appbar: 'intake',
      body: function () {
        var st = S(), raw = E.signalsRaw(st);
        var groups = SS.AREAS.map(function (a) {
          var ids = Object.keys(raw).filter(function (id) { return raw[id].area === a.id; });
          return { area: a, ids: ids };
        }).filter(function (g) { return g.ids.length; });
        var safety = Object.keys(raw).filter(function (id) { return !raw[id].area; });
        var html = '<section class="review"><h1 class="display-l">Here’s what we heard</h1>' +
          '<p class="lede">Tap a signal to see which answers created it. Remove anything that’s wrong; your stack updates as you go.</p>';
        groups.forEach(function (g) {
          html += '<div class="sig-group"><h3 class="sig-area"><span class="area-dot" style="background:' + g.area.color + '"></span>' + esc(g.area.name) + '</h3>' +
            '<div class="sig-chips">' + g.ids.map(function (id) { return sigChip(raw[id], g.area.color); }).join('') + '</div>' +
            sourcesFor(g.ids, raw) + '</div>';
        });
        if (safety.length) {
          html += '<div class="sig-group"><h3 class="sig-area"><span class="area-dot area-dot-safety"></span>Medicines and safety</h3>' +
            '<div class="sig-chips">' + safety.map(function (id) { return sigChip(raw[id], 'var(--caution)', true); }).join('') + '</div>' + sourcesFor(safety, raw) + '</div>';
        }
        return html + '</section>';
      },
      dock: function () {
        var st = S(), stack = E.stack(st);
        var flash = st.ui.countFlash ? ' is-flash' : '';
        st.ui.countFlash = false;
        return '<div class="dock dock-review">' + (st.ui.lastDiff ? '<div class="diff" role="status">' + icon('swap', 16) + '<div>' + st.ui.lastDiff + '</div></div>' : '') + '<p class="live-sum' + flash + '" aria-live="polite"><b>' + stack.items.length + ' supplements</b>' +
          (stack.locked ? ' · 1 locked' : '') + ' · ≈ ' + SS.fmt.money(stack.monthly) + '/month</p>' +
          '<button type="button" class="btn btn-primary btn-block" data-act="build">Build my stack</button></div>';
      }
    };
  };

  function sigChip(s, color, safety) {
    var st = S(), removed = !!st.removed[s.id], open = st.ui.reviewOpen === s.id;
    return '<span class="sig-chip' + (removed ? ' is-removed' : '') + (open ? ' is-open' : '') + '" style="--c:' + color + '">' +
      '<button type="button" class="sig-main" data-act="sig-open" data-arg="' + s.id + '" aria-expanded="' + open + '">' +
      (s.locked ? icon('lock', 13) : '') + esc(s.label) + '<span class="sig-count">' + s.sources.length + '</span></button>' +
      (safety ? '<span class="sig-lock" title="Change this in your medicines answer">' + icon('shield', 14) + '</span>' :
        removed ? '<button type="button" class="sig-x" data-act="sig-undo" data-arg="' + s.id + '" aria-label="Undo removing ' + esc(s.label) + '">' + icon('undo', 14) + '</button>'
          : '<button type="button" class="sig-x" data-act="sig-remove" data-arg="' + s.id + '" aria-label="Remove ' + esc(s.label) + '">' + icon('x', 14) + '</button>') +
      '</span>';
  }

  function sourcesFor(ids, raw) {
    var open = S().ui.reviewOpen;
    if (!open || ids.indexOf(open) < 0) return '';
    var s = raw[open];
    return '<ul class="sig-sources">' + s.sources.map(function (x) {
      return '<li><span class="src-card">' + (x.card === 'LAB' ? 'Lab' : x.card) + '</span>' + esc(x.text) + '</li>';
    }).join('') + '</ul>';
  }

  ACT['sig-open'] = function (id) { var st = S(); st.ui.reviewOpen = st.ui.reviewOpen === id ? null : id; SS.app.refresh(); };

  function needLine(before, after) {
    var out = [];
    SS.AREAS.forEach(function (a) {
      var b = before.need[a.id], c = after.need[a.id];
      if (Math.abs(b - c) > 0.01) out.push(esc(a.name) + ' need ' + SS.fmt.num(b) + ' → ' + SS.fmt.num(c));
    });
    return out;
  }

  function stackDiff(before, after, label, verb) {
    var bIds = before.items.map(function (x) { return x.id; }), aIds = after.items.map(function (x) { return x.id; });
    var gone = before.items.filter(function (x) { return aIds.indexOf(x.id) < 0; }).map(function (x) { return x.supp.short; });
    var back = after.items.filter(function (x) { return bIds.indexOf(x.id) < 0; }).map(function (x) { return x.supp.short; });
    var parts = ['<strong>' + verb + ' “' + esc(label) + '”.</strong>'];
    if (gone.length) parts.push(esc(SS.fmt.list(gone)) + ' left your stack (' + before.items.length + ' → ' + after.items.length + ' supplements).');
    if (back.length) parts.push(esc(SS.fmt.list(back)) + ' is back (' + before.items.length + ' → ' + after.items.length + ' supplements).');
    var needs = needLine(before, after);
    if (needs.length) parts.push(needs.join(' · ') + '.');
    if (!gone.length && !back.length) parts.push('Your stack stays at ' + after.items.length + '.');
    return parts.join(' ');
  }

  ACT['sig-remove'] = function (id) {
    var st = S(), raw = E.signalsRaw(st), before = E.stack(st);
    st.removed[id] = true;
    var after = E.stack(st);
    st.ui.lastDiff = stackDiff(before, after, raw[id].label, 'Removed');
    st.ui.countFlash = before.items.length !== after.items.length;
    st.ui.reviewOpen = null;
    SS.app.refresh();
  };
  ACT['sig-undo'] = function (id) {
    var st = S(), raw = E.signalsRaw(st), before = E.stack(st);
    delete st.removed[id];
    var after = E.stack(st);
    st.ui.lastDiff = stackDiff(before, after, raw[id].label, 'Restored');
    st.ui.countFlash = before.items.length !== after.items.length;
    SS.app.refresh();
  };

  ACT['build'] = function () { SS.app.go('F26'); };

  /* ------------------------------------------------------------------ */
  /* F26: analysis transition. Four beats, about 7 seconds, real work shown. */
  R.analysis = function () {
    return {
      kind: 'analysis', appbar: 'none',
      body: function () {
        var st = S(), sig = E.signals(st), stack = E.stack(st, sig);
        var n = stack.items.length;
        var removed = stack.excluded.slice();
        if (stack.locked) removed.push({ id: 'iron', name: 'Iron', short: 'needs a blood test first' });
        var budget = stack.budget != null ? stack.budget : 80;
        var timing = [];
        if (stack.items.some(function (i) { return i.id === 'magnesium'; })) timing.push('magnesium kept away from morning items');
        if (stack.items.some(function (i) { return i.id === 'curcumin'; })) timing.push('curcumin taken with food');
        if (stack.items.some(function (i) { return i.id === 'iron'; })) timing.push('iron 2 h from magnesium and coffee');
        return '<section class="analysis" aria-live="polite">' +
          '<div class="an-mark">' + icon('sparkle', 22) + '</div>' +
          '<h1 class="display-l">Building your stack</h1>' +
          '<ol class="beats">' +
          beat(1, 'Matching ' + Object.keys(sig).length + ' signals against <span class="counter" data-to="120">0</span> supplements…',
            '<p class="beat-sub">' + (n + removed.length) + ' candidates fit your signals.</p>') +
          beat(2, 'Removing what doesn’t fit you',
            '<ul class="strike-list">' + removed.map(function (x) {
              return '<li data-id="' + x.id + '"><span class="sl-name">' + esc(x.name) + '</span><span class="sl-reason">' + esc(x.short || x.reason) + '</span></li>';
            }).join('') + '</ul>') +
          beat(3, 'Checking ' + (n * (n - 1) / 2) + ' possible interactions between the rest',
            '<p class="beat-sub"><b>0 conflicts, ' + timing.length + ' timing rule' + (timing.length === 1 ? '' : 's') + ' applied</b>' + (timing.length ? ' (' + esc(timing.join('; ')) + ')' : '') + '.</p>') +
          beat(4, 'Fitting it to your day and your ' + SS.fmt.money(budget) + ' budget',
            '<p class="beat-sub">' + n + ' supplements · ' + stack.maxPills + ' pills on your busiest day · ≈ ' + SS.fmt.money(stack.monthly) + '/month.</p>') +
          '</ol></section>';
      },
      dock: function () { return '<div class="dock"><button type="button" class="link-btn" data-act="skip-analysis">Skip</button></div>'; },
      mount: function (view) { runAnalysis(view); }
    };
  };

  function beat(i, title, sub) {
    return '<li class="beat" data-beat="' + i + '"><span class="beat-mark"><span class="beat-spin"></span>' + icon('check', 14) + '</span>' +
      '<div class="beat-body"><p class="beat-title">' + title + '</p><div class="beat-more">' + sub + '</div></div></li>';
  }

  function runAnalysis(view) {
    var st = S();
    var fast = SS.reducedMotion();
    var timers = st.ui.timers = [];
    var at = function (ms, fn) { timers.push(setTimeout(fn, fast ? Math.min(ms, 200) : ms)); };
    var beats = view.querySelectorAll('.beat');
    var setState = function (i, cls) { if (beats[i]) { beats[i].classList.add(cls); } };
    var counter = view.querySelector('.counter');
    at(100, function () {
      setState(0, 'is-active');
      var t0 = performance.now(), dur = fast ? 1 : 1300;
      (function tick(now) {
        var k = Math.min(1, (now - t0) / dur);
        if (counter) counter.textContent = Math.round(120 * k);
        if (k < 1 && S().frame === 'F26') requestAnimationFrame(tick);
      })(t0);
    });
    at(1500, function () { setState(0, 'is-done'); setState(1, 'is-active'); });
    var items = view.querySelectorAll('.strike-list li');
    items.forEach(function (li, i) {
      at(1800 + i * 480, function () {
        li.classList.add('is-struck');
        if (li.getAttribute('data-id') === 'collagen') SS.app.moment('collagen');
        if (li.getAttribute('data-id') === 'sjw') SS.app.moment('sjw');
      });
    });
    var t3 = Math.max(3700, 1800 + items.length * 480 + 300);
    at(t3, function () { setState(1, 'is-done'); setState(2, 'is-active'); });
    at(t3 + 1300, function () { setState(2, 'is-done'); setState(3, 'is-active'); });
    at(t3 + 2500, function () { setState(3, 'is-done'); });
    at(Math.max(7000, t3 + 3000), function () { if (S().frame === 'F26') finish(); });
  }

  function finish() {
    var st = S();
    st.analysisDone = true;
    st.ui.animateMap = true;
    SS.app.go('F27', { noHistory: true });
  }
  ACT['skip-analysis'] = function () { (S().ui.timers || []).forEach(clearTimeout); finish(); };

  /* ------------------------------------------------------------------ */
  /* Banners shared by the map and the stack list */
  /** Nothing strong enough to act on: say so plainly instead of showing an empty chart. */
  function emptyResults() {
    var n = E.notSureCount(S());
    return '<section class="results"><div class="empty empty-results">' + icon('info', 28) +
      '<h1 class="display-l">We need a little more to build your stack</h1>' +
      '<p>' + (n ? 'You answered “Not sure” ' + n + ' time' + (n === 1 ? '' : 's') + ', so no signal is strong enough to act on.' : 'None of your answers raised a signal we can act on.') +
      ' No stack beats a guessed one.</p>' +
      '<button type="button" class="btn btn-primary btn-block" data-act="jump" data-arg="F03">Answer the questions again</button>' +
      '<button type="button" class="btn btn-secondary btn-block" data-act="labs">' + icon('flask', 16) + 'Enter lab results instead</button></div>' +
      ui.footer() + '</section>';
  }

  function banners(stack) {
    var out = '';
    if (stack.lowConfidence && stack.items.length) {
      out += '<div class="banner banner-amber">' + icon('info', 18) + '<div><strong>Low confidence: core 3 only</strong><p>You answered “Not sure” ' + E.notSureCount(S()) + ' times, so we’ve kept your 3 strongest picks. Bloodwork would sharpen the rest.</p>' +
        '<button type="button" class="link-btn" data-act="labs">' + icon('flask', 14) + 'Enter lab results</button></div></div>';
    }
    if (stack.pregnancy) {
      out += '<div class="banner banner-amber">' + icon('shieldCheck', 18) + '<div><strong>Pregnancy-safe library</strong><p>We hid ashwagandha and anything without strong pregnancy safety data. Check with your prenatal care provider before starting.</p></div></div>';
    }
    if (stack.optimizer) {
      var o = stack.optimizer;
      out += '<div class="banner banner-opt">' + icon('cart', 18) + '<div><strong>' + SS.fmt.money(stack.monthly) + '/month is ' + SS.fmt.money(o.over) + ' over your budget</strong><p>Pick one, or raise your budget.</p>' +
        '<div class="opt-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="optim-drop" data-arg="' + o.drop.id + '">Drop ' + esc(o.drop.name.toLowerCase()) + ' to save ' + SS.fmt.money2(o.drop.save) + '</button>' +
        (o.swap ? '<button type="button" class="btn btn-secondary btn-sm" data-act="optim-swap" data-arg="' + o.swap.ids.join(',') + '">Switch ' + o.swap.ids.length + ' items to budget picks to save ' + SS.fmt.money2(o.swap.save) + '</button>' : '') +
        '</div></div></div>';
    }
    var st = S();
    if (Object.keys(st.optim.dropped).length || Object.keys(st.optim.budget).length) {
      out += '<div class="banner banner-quiet">' + icon('check', 18) + '<div><p>Budget changes applied.</p><button type="button" class="link-btn" data-act="optim-reset">' + icon('undo', 14) + 'Undo budget changes</button></div></div>';
    }
    if (stack.pillLimit != null && stack.maxPills > stack.pillLimit) {
      out += '<div class="banner banner-amber">' + icon('pill', 18) + '<div><strong>' + stack.maxPills + ' pills on your busiest day</strong><p>That’s over your limit of ' + stack.pillLimit + '. Allowing powders or dropping an item would bring it down.</p></div></div>';
    }
    return out;
  }

  ACT['optim-drop'] = function (id) { S().optim.dropped[id] = true; SS.app.refresh(); };
  ACT['optim-swap'] = function (ids) { ids.split(',').forEach(function (id) { S().optim.budget[id] = true; }); SS.app.refresh(); };
  ACT['optim-reset'] = function () { S().optim = { dropped: {}, budget: {} }; SS.app.refresh(); };

  /* ------------------------------------------------------------------ */
  /* F27: Health Impact Map */
  R.headline = function (imp) {
    var n = imp.active.length, m = imp.met;
    if (!n) return 'Your stack is ready';
    if (m === n) return 'Your stack meets two-thirds or more of your need in every area';
    return 'Your stack meets two-thirds or more of your need in ' + m + ' of ' + n + ' areas';
  };

  R.mapPanel = function (opts) {
    opts = opts || {};
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig), imp = E.impact(st, sig, stack);
    var mode = opts.mode || st.ui.mapMode || 'radar';
    var chart = mode === 'radar'
      ? '<div class="chart chart-radar" id="radarWrap">' + C.radar(imp, { empty: !!opts.animate, size: opts.size }) +
        '<p class="radar-step" id="radarStep" aria-hidden="true"></p></div>' + C.radarLegend()
      : '<div class="chart chart-bars" id="barsWrap">' + C.bars(imp, stack.items, { wide: opts.wide, animate: !!opts.animate }) + '</div>' + C.barsLegend(stack.items);
    var gaps = imp.gaps.map(function (g) {
      var a = SS.AREA[g.id];
      return '<div class="gap" style="--c:' + a.color + '"><span class="gap-pct">' + SS.fmt.pct(g.coverage) + '</span><div><strong>' + esc(a.name) + '</strong> — ' + esc(g.reason) + '.' +
        (g.reason.indexOf('ferritin') >= 0 ? ' <button type="button" class="link-btn link-inline" data-act="labs">Enter lab result</button>' : '') + '</div></div>';
    }).join('');
    return '<div class="map-panel">' +
      (opts.noToggle ? '' : '<div class="seg-toggle seg-toggle-sm" role="tablist" aria-label="Chart view">' +
        '<button type="button" role="tab" class="' + (mode === 'radar' ? 'is-on' : '') + '" aria-selected="' + (mode === 'radar') + '" data-act="map-mode" data-arg="radar">' + icon('radar', 16) + 'Radar</button>' +
        '<button type="button" role="tab" class="' + (mode === 'bars' ? 'is-on' : '') + '" aria-selected="' + (mode === 'bars') + '" data-act="map-mode" data-arg="bars">' + icon('bars', 16) + 'Bars</button></div>') +
      chart + (gaps ? '<div class="gaps">' + gaps + '</div>' : '') + '</div>';
  };

  R.noticeStrip = function () {
    return '<div class="notice-strip"><h3>When you might notice</h3><div class="ns-row">' + SS.NOTICE_TIMES.map(function (n) {
      var a = SS.AREA[n.area];
      return '<div class="ns-item" style="--c:' + a.color + '"><span class="ns-label">' + icon(a.icon, 14) + esc(n.label) + '</span><b>' + n.range + '</b></div>';
    }).join('') + '</div><p class="ns-foot">Typical ranges from studies, not a promise.</p></div>';
  };

  function checkinCompare() {
    var st = S(), r = st.rescore;
    if (!r) return '';
    var rows = [['sleep', 'Sleep', 1.5], ['energy', 'Energy', 1], ['joints', 'Knees', 0.5]];
    return '<div class="checkin"><h3>' + icon('check', 16) + 'Your week-2 check-in</h3><table><thead><tr><th scope="col">Area</th><th scope="col">Predicted</th><th scope="col">You reported</th></tr></thead><tbody>' +
      rows.map(function (x) {
        var d = r[x[0]] - r.base[x[0]];
        return '<tr><th scope="row"><span class="area-dot" style="background:' + SS.AREA[x[0]].color + '"></span>' + x[1] + '</th><td>+' + x[2] + '</td><td><b>' + (d >= 0 ? '+' : '') + d + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  R.map = function () {
    return {
      kind: 'results', appbar: 'results', tab: 'map', title: 'Health Impact Map',
      body: function () {
        var st = S(), sig = E.signals(st), stack = E.stack(st, sig), imp = E.impact(st, sig, stack);
        if (!stack.items.length && !stack.locked) return emptyResults();
        return '<section class="results">' +
          '<p class="eyebrow">Health Impact Map</p>' +
          '<h1 class="display-l">' + esc(R.headline(imp)) + '</h1>' +
          '<p class="lede lede-sm">Projected benefit by body area from your ' + stack.items.length + '-item stack. Demo values.</p>' +
          banners(stack) +
          '<div class="card-surface">' + R.mapPanel({ animate: st.ui.animateMap }) + '</div>' +
          R.noticeStrip() + checkinCompare() +
          '<button type="button" class="btn btn-primary btn-block" data-act="go" data-arg="F28">See your stack (' + stack.items.length + ')</button>' +
          ui.footer() + '</section>';
      },
      mount: function (view) { R.mountMap(view); }
    };
  };

  R.mountMap = function (root, opts) {
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig), imp = E.impact(st, sig, stack);
    var radar = root.querySelector('.radar');
    var size = opts && opts.size;
    if (radar && st.ui.animateMap) {
      var step = root.querySelector('#radarStep');
      C.animateRadar(radar, imp, C.inChartOrder(stack.items), { size: size }, function (it) {
        if (step) step.textContent = it ? 'Adding ' + it.supp.short + '…' : '';
      });
    }
    var bars = root.querySelector('.bars');
    if (bars && bars.classList.contains('is-animating')) requestAnimationFrame(function () { requestAnimationFrame(function () { bars.classList.remove('is-animating'); }); });
    st.ui.animateMap = false;
    root.querySelectorAll('.chart-bars').forEach(function (b) { C.bindTips(b); });
  };

  ACT['map-mode'] = function (m) { var st = S(); st.ui.mapMode = m; st.ui.animateMap = true; SS.app.refresh(); };

  /* Tap an area: who contributes, how much, and why. */
  ACT['area'] = function (id) {
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig), imp = E.impact(st, sig, stack);
    var A = imp.areas.filter(function (x) { return x.id === id; })[0], area = SS.AREA[id];
    if (!A) return;
    var from = SS.NEED_RULES.filter(function (r) { return r.area === id && sig[r.sig]; }).map(function (r) { return esc(sig[r.sig].label.toLowerCase()) + ' <b>+' + SS.fmt.num(r.v) + '</b>'; });
    SS.goalsOf(E.answers(st)).forEach(function (g, i) {
      if (SS.GOAL_AREA[g] === id) from.push((i === 0 ? 'your top goal' : 'goal #' + (i + 1)) + ' <b>+' + SS.fmt.num(2.5 * SS.GOAL_WEIGHTS[i]) + '</b>');
    });
    var contrib = A.contributions.slice().sort(function (a, b) { return b.v - a.v; });
    var html = '<div class="sheet-head"><span class="sheet-dot" style="background:' + area.color + '">' + icon(area.icon, 18) + '</span><div><h2>' + esc(area.name) + '</h2>' +
      '<p>' + (A.need > 0 ? 'Need ' + SS.fmt.num(A.need) + ' from your answers · stack covers ' + SS.fmt.num(Math.min(A.supply, A.need)) + ' (' + SS.fmt.pct(A.coverage) + ')' : 'Your answers didn’t raise a need here.') + '</p></div></div>' +
      (from.length ? '<p class="need-from">From: ' + from.join(' · ') + '</p>' : '') +
      (contrib.length ? '<ul class="contrib">' + contrib.map(function (c) {
        var m = c.supp.mech[id] || ['Supports this area', c.supp.evidence];
        return '<li><span class="contrib-sw" style="background:' + c.supp.color + '"></span><div class="contrib-main"><div class="contrib-top"><b>' + esc(c.supp.short) + '</b>' +
          '<span class="contrib-share">' + Math.round(c.v / A.supply * 100) + '% of coverage</span>' + ui.evidence(m[1]) + '</div>' +
          '<p>' + esc(m[0]) + ' — ' + m[1] + ' evidence.</p></div></li>';
      }).join('') + '</ul>' : '<p class="muted">Nothing in your stack targets this area.</p>') +
      (A.need > 0 && A.coverage < 0.5 && stack.iron === 'locked' && (id === 'skin' || id === 'energy') ? '<div class="banner banner-amber">' + icon('lock', 18) + '<div><p>Likely iron-related. This unlocks after a ferritin test.</p><button type="button" class="link-btn" data-act="labs">Enter lab result</button></div></div>' : '') +
      (contrib.length ? '<button type="button" class="btn btn-secondary btn-block" data-act="filter-area" data-arg="' + id + '">Show the cards for ' + esc(area.name) + '</button>' : '');
    ui.openSheet(html, { id: 'area', label: area.name });
  };

  ACT['filter-area'] = function (id) {
    var st = S();
    ui.closeSheet(true);
    st.ui.areaFilter = id;
    if (st.device === 'desktop') SS.app.refresh(); else SS.app.go('F28');
  };

  /* ------------------------------------------------------------------ */
  /* F28: Your stack */
  R.summaryLine = function (stack) {
    var dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    var pills = stack.maxPills + ' pill' + (stack.maxPills === 1 ? '' : 's') + (stack.scoops ? ' + ' + stack.scoops + ' scoop' + (stack.scoops === 1 ? '' : 's') : '');
    var b = stack.budget != null ? (stack.monthly <= stack.budget ? 'within your ' + SS.fmt.money(stack.budget) + '/month' : SS.fmt.money(stack.monthly - stack.budget) + ' over your ' + SS.fmt.money(stack.budget)) : '';
    return stack.items.length + ' supplements · ' + pills + ' on the busiest day (' + dayNames[stack.busiestDay] + ') · ≈ ' + SS.fmt.money(stack.monthly) + '/month' + (b ? ', ' + b : '');
  };

  R.stackList = function (opts) {
    opts = opts || {};
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig);
    var f = st.ui.areaFilter;
    var items = stack.items.filter(function (it) { return !f || it.supp.contrib[f]; });
    var areasWithItems = SS.AREAS.filter(function (a) { return stack.need[a.id] > 0 && stack.items.some(function (it) { return it.supp.contrib[a.id]; }); });
    var filters = '<div class="filter-row" role="tablist" aria-label="Filter by body area">' +
      '<button type="button" class="fchip' + (!f ? ' is-on' : '') + '" data-act="filter-area" data-arg="">All</button>' +
      areasWithItems.map(function (a) {
        return '<button type="button" class="fchip' + (f === a.id ? ' is-on' : '') + '" data-act="filter-area" data-arg="' + a.id + '" style="--c:' + a.color + '"><span class="area-dot" style="background:' + a.color + '"></span>' + esc(a.short) + '</button>';
      }).join('') + '</div>';
    var cards = items.map(function (it) { return ui.stackCard(it, st.ui.expanded === it.id); }).join('');
    var excludedCount = stack.excluded.length + (stack.locked ? 1 : 0) + stack.dropped.length + stack.trimmed.length;
    var tips = stack.tips.filter(function (t) { return !f || t.area === f; }).map(function (t) {
      return '<div class="tip"><span class="tip-ic">' + icon('leaf', 18) + '</span><div><span class="tip-eyebrow">Lifestyle tip · no supplement</span><strong>' + esc(t.title) + '</strong><p>' + esc(t.text) + '</p></div></div>';
    }).join('');
    return filters + (f ? '<p class="filter-note">Showing ' + items.length + ' of ' + stack.items.length + ' for ' + esc(SS.AREA[f].name) + '. <button type="button" class="link-btn link-inline" data-act="filter-area" data-arg="">Show all</button></p>' : '') +
      '<div class="cards">' + cards + (stack.locked && (!f || f === 'energy' || f === 'skin') ? ui.lockedCard(stack.locked) : '') + '</div>' + tips +
      (excludedCount ? '<button type="button" class="excluded-link" data-act="excluded">' + icon('eye', 18) + '<span><b>' + excludedCount + ' items excluded for you</b><small>See what we removed and why</small></span>' + icon('right', 16) + '</button>' : '');
  };

  R.stack = function () {
    return {
      kind: 'results', appbar: 'results', tab: 'stack', title: 'Your stack',
      body: function () {
        var st = S(), stack = E.stack(st);
        if (!stack.items.length && !stack.locked) return emptyResults();
        return '<section class="results">' +
          '<h1 class="display-l">Your stack</h1>' +
          '<p class="stack-sum">' + esc(R.summaryLine(stack)) + '</p>' +
          banners(stack) + R.stackList() + ui.footer() + '</section>';
      }
    };
  };

  ACT['toggle-card'] = function (id) { var st = S(); st.ui.expanded = st.ui.expanded === id ? null : id; SS.app.refresh(); };

  /* F30: product sheet */
  ACT['product-sheet'] = function (id) {
    var st = S(), stack = E.stack(st);
    var it = stack.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var prod = it.prod, s = it.supp;
    var block = function (p, role, chip) {
      return '<div class="pick' + (role === 'Best match' ? ' pick-best' : '') + '">' +
        '<div class="pick-role">' + role + (chip || '') + '</div>' +
        '<div class="pick-row">' + ui.thumb(p, s.color) + '<div class="pick-main"><div class="prow-name"><b>' + esc(p.brand) + '</b> ' + esc(p.name) + '</div>' +
        '<p class="pick-note">' + esc(p.note) + '</p><div class="prow-tags">' + ui.fitChip(p) + ui.certs(p.certs) + '</div>' +
        '<p class="pick-meta">' + icon('sparkle', 12) + p.rating + ' · ' + p.reviews.toLocaleString('en-CA') + ' reviews · ' + p.servings + ' doses per bottle</p></div></div>' +
        '<div class="pick-buy"><span class="price">' + ui.pricePerDay(p, s) + '</span>' + ui.buyLink(p, p.linkLabel ? 'Buy on brand site' : 'Buy on Amazon.ca') + '</div></div>';
    };
    var html = '<div class="sheet-head"><span class="sheet-dot" style="background:' + s.color + '">' + icon(ui.formIcon(it.form), 18) + '</span><div><h2>Choosing your ' + esc(s.short.toLowerCase()) + '</h2><p>Target: ' + esc(s.dose) + ' · ' + esc(s.when) + '</p></div></div>' +
      (prod.swapped ? '<div class="banner banner-amber">' + icon('swap', 18) + '<div><strong>Swapped — original unavailable</strong><p>' + esc(prod.swapped.brand + ' ' + prod.swapped.name) + ' is our top pick but is out of stock, so we promoted the alternative.</p></div></div>' : '') +
      (prod.best ? block(prod.best, 'Best match', prod.budgetPick ? '<span class="fit fit-swap">Budget pick</span>' : '') : '') +
      (prod.alt ? block(prod.alt, prod.budgetPick ? 'Original pick' : 'Budget / alternative') : '') +
      prod.others.map(function (p) { return block(p, 'Also fits'); }).join('') +
      (prod.filtered.length ? '<div class="filtered"><h3>Filtered out for you</h3><ul>' + prod.filtered.map(function (x) {
        return '<li>' + icon('x', 14) + '<div><b>' + esc(x.p.brand + ' ' + x.p.name) + '</b><span>' + esc(x.reason) + '</span></div></li>';
      }).join('') + '</ul></div>' : '') +
      '<details class="why-product"><summary>' + icon('info', 16) + 'Why this product</summary><ol>' + SS.RANK_STEPS.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      '<p>Picks come from expert roundups and third-party testing, then get filtered by your answers. In this prototype the rows are demo data.</p></details>' +
      '<p class="fine">' + esc(SS.AFFILIATE) + '</p>';
    ui.openSheet(html, { id: 'product', label: 'Product options', tall: true });
  };

  ACT['buy'] = function () { SS.app.log('Buy link opened'); return true; };

  /* F31: Excluded for you */
  ACT['excluded'] = function () {
    var st = S(), stack = E.stack(st);
    var rows = stack.excluded.map(function (x) {
      return { icon: x.kind === 'diet' ? 'leaf' : x.kind === 'safety' ? 'shield' : 'x', tone: x.kind === 'safety' ? 'safety' : '', name: x.name, reason: x.reason, card: x.card, told: x.told };
    });
    if (stack.locked) rows.push({ icon: 'lock', tone: 'lock', name: 'Iron', reason: 'Locked: test first. It unlocks when you enter a ferritin result.', card: 'B7', action: '<button type="button" class="link-btn" data-act="labs">Enter lab result</button>' });
    stack.dropped.forEach(function (it) { rows.push({ icon: 'cart', tone: '', name: it.supp.name, reason: 'Dropped to fit your budget.', action: '<button type="button" class="link-btn" data-act="optim-reset">Undo</button>' }); });
    stack.trimmed.forEach(function (it) { rows.push({ icon: 'info', tone: '', name: it.supp.name, reason: 'Held back until we know more (too many “Not sure” answers).' }); });
    var html = '<div class="sheet-head"><span class="sheet-icon">' + icon('eye', 20) + '</span><div><h2>Excluded for you</h2><p>We never drop anything silently. Here’s what we removed and the answer behind it.</p></div></div>' +
      '<ul class="excl">' + rows.map(function (r) {
        var told = r.told || (r.card ? R.answerSummary(r.card) : '');
        return '<li class="excl-row' + (r.tone ? ' tone-' + r.tone : '') + '"><span class="excl-ic">' + icon(r.icon, 18) + '</span><div><b>' + esc(r.name) + '</b><p>' + esc(r.reason) + '</p>' +
          (told ? '<p class="excl-src"><span class="src-card">' + (r.card === 'LAB' ? 'Lab' : r.card) + '</span>You told us: ' + esc(told) + '</p>' : '') + (r.action || '') + '</div></li>';
      }).join('') + '</ul>';
    ui.openSheet(html, { id: 'excluded', label: 'Excluded for you' });
  };

  /* Doctor note: signals, stack, locked iron, and the test request. */
  ACT['doctor-note'] = function () {
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig);
    var text = E.doctorNote(st, sig, stack);
    var iron = sig.low_iron_risk;
    var html = '<div class="sheet-head"><span class="sheet-icon">' + icon('doc', 20) + '</span><div><h2>Note for your doctor</h2><p>Readable in a minute. Bring it to your appointment.</p></div></div>' +
      '<article class="letter" id="doctorLetter"><header><span class="logo logo-sm">' + icon('sparkle', 14) + 'StackSense</span><span>' + SS.fmt.date(new Date(2026, 9, 4)) + '</span></header>' +
      '<h3>Request: ferritin, CBC and vitamin B12</h3>' +
      '<p><b>' + SS.PERSONA.name + ', ' + SS.PERSONA.age + ', female.</b> Self-reported intake, not a diagnosis.</p>' +
      '<h4>Answers suggesting possible low iron</h4><ul>' + (iron ? iron.sources.map(function (s) { return '<li>' + esc(s.text) + '</li>'; }).join('') : '<li>None</li>') + '</ul>' +
      (sig.b12_risk ? '<h4>B12 risk</h4><ul><li>' + esc(sig.b12_risk.sources[0].text) + '</li></ul>' : '') +
      '<h4>Medication</h4><p>' + esc(R.answerSummary('C1') || 'None reported') + '</p>' +
      '<h4>Supplements planned from ' + SS.fmt.date(SS.PLAN_START) + '</h4><ul>' + stack.items.map(function (it) { return '<li>' + esc(it.supp.name + ' ' + it.supp.dose + ', ' + it.supp.when.toLowerCase()) + '</li>'; }).join('') + '</ul>' +
      '<p class="letter-hold">' + icon('lock', 14) + 'Iron is on hold until a ferritin result is available.</p></article>' +
      '<textarea class="sr-only" id="noteText" readonly>' + esc(text) + '</textarea>' +
      '<div class="sheet-actions">' +
      '<button type="button" class="btn btn-secondary" data-act="copy-note">' + icon('copy', 16) + 'Copy text</button>' +
      (SS.framed ? '' : '<button type="button" class="btn btn-primary" data-act="print-note">' + icon('download', 16) + 'Save as PDF</button>') + '</div>';
    ui.openSheet(html, { id: 'note', label: 'Doctor note', tall: true });
  };
  ACT['copy-note'] = function (_, el) { var t = document.getElementById('noteText'); ui.copy(t.value, t, el); };
  ACT['print-note'] = function () { SS.app.printNode(document.getElementById('doctorLetter')); };
})(window.SS = window.SS || {});
