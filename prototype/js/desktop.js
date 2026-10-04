/* StackSense prototype: desktop frames at 1440 x 900 (D1 results, D2 calendar, D3 weekly sheet).
 * Internally they are DESK1–DESK3 so they never collide with intake cards D1–D3. */
(function (SS) {
  'use strict';

  var DK = SS.desktop = {};
  var E = SS.engine, ui = SS.ui, esc = ui.esc, D = SS.dates, fmt = SS.fmt;
  var icon = function (n, s, c) { return SS.icon(n, s, c); };
  var ACT = SS.actions = SS.actions || {};
  var S = function () { return SS.state; };

  function topbar(active) {
    var st = S(), stack = E.stack(st);
    var tabs = [['DESK1', 'Results', 'radar'], ['DESK2', 'Calendar', 'calendar'], ['DESK3', 'Weekly sheet', 'print']];
    return '<header class="desk-top"><span class="logo">' + icon('sparkle', 18) + 'StackSense</span>' +
      '<nav class="desk-nav">' + tabs.map(function (t) {
        return '<button type="button" class="' + (active === t[0] ? 'is-on' : '') + '" data-act="desk-go" data-arg="' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : '') + '>' + icon(t[2], 16) + t[1] + '</button>';
      }).join('') + '</nav>' +
      '<span class="desk-sum">' + stack.items.length + ' supplements · ≈ ' + fmt.money(stack.monthly) + '/month</span>' +
      '<span class="desk-user">' + icon('user', 16) + SS.PERSONA.name + '</span></header>';
  }

  ACT['desk-go'] = function (f) { SS.app.go(f); };

  DK.render = function (frame) {
    var body = frame === 'DESK2' ? calendar() : frame === 'DESK3' ? weekly() : results();
    return '<div class="desk-app">' + topbar(frame) + body + '<div class="layer" id="deskLayer"></div></div>';
  };

  function results() {
    var st = S(), sig = E.signals(st), stack = E.stack(st, sig), imp = E.impact(st, sig, stack);
    var mode = st.ui.deskMapMode || 'bars';
    return '<main class="desk-main desk-results">' +
      '<section class="desk-col desk-map"><p class="eyebrow">Health Impact Map</p>' +
      '<h1 class="display-l">' + esc(SS.results.headline(imp)) + '</h1>' +
      '<p class="lede lede-sm">Skin and hair stays low until iron is tested. Projected benefit by body area, stacked by supplement. Demo values.</p>' +
      '<div class="card-surface">' +
      '<div class="seg-toggle seg-toggle-sm" role="tablist" aria-label="Chart view">' +
      '<button type="button" role="tab" class="' + (mode === 'bars' ? 'is-on' : '') + '" aria-selected="' + (mode === 'bars') + '" data-act="desk-map" data-arg="bars">' + icon('bars', 16) + 'Bars</button>' +
      '<button type="button" role="tab" class="' + (mode === 'radar' ? 'is-on' : '') + '" aria-selected="' + (mode === 'radar') + '" data-act="desk-map" data-arg="radar">' + icon('radar', 16) + 'Radar</button></div>' +
      SS.results.mapPanel({ mode: mode, wide: true, noToggle: true, size: 520, animate: st.ui.animateMap }) + '</div>' +
      SS.results.noticeStrip() + '</section>' +
      '<section class="desk-col desk-stack"><div class="desk-stack-head"><h2 class="display-m">Your stack</h2><p class="stack-sum">' + esc(SS.results.summaryLine(stack)) + '</p></div>' +
      SS.results.stackList() + ui.footer() + '</section></main>';
  }

  ACT['desk-map'] = function (m) { var st = S(); st.ui.deskMapMode = m; st.ui.animateMap = true; SS.app.refresh(); };

  function calendar() {
    var st = S();
    var date = st.ui.calDate ? D.parse(st.ui.calDate) : SS.DEMO_TODAY;
    return '<main class="desk-main desk-cal"><section class="desk-col desk-month">' + SS.calendar.monthView({ wide: true, noExport: true }) + '</section>' +
      '<aside class="desk-col desk-day">' + SS.calendar.dayView(date, { noFooter: true }) + '</aside></main>';
  }

  function weekly() {
    var st = S();
    var date = st.ui.calDate ? D.parse(st.ui.calDate) : SS.DEMO_TODAY;
    var monday = D.add(date, -((date.getDay() + 6) % 7));
    return '<main class="desk-main desk-print"><div class="print-bar">' +
      '<button type="button" class="icon-btn" data-act="week-shift" data-arg="-7" aria-label="Previous week">' + icon('left', 18) + '</button>' +
      '<span>Week of ' + fmt.date(monday) + '</span>' +
      '<button type="button" class="icon-btn" data-act="week-shift" data-arg="7" aria-label="Next week">' + icon('right', 18) + '</button>' +
      (SS.framed ? '<span class="print-hint">Open the prototype in its own tab to print this sheet.</span>' : '<button type="button" class="btn btn-primary btn-sm" data-act="print-week">' + icon('print', 16) + 'Print</button>') +
      '</div><div class="paper">' + SS.calendar.weekSheet(monday) + '</div></main>';
  }

  ACT['week-shift'] = function (n) {
    var st = S(), d = D.add(st.ui.calDate ? D.parse(st.ui.calDate) : SS.DEMO_TODAY, +n);
    if (d < D.add(SS.PLAN_START, -7) || d > new Date(2027, 0, 31)) return;
    st.ui.calDate = D.key(d);
    SS.app.refresh();
  };
  ACT['print-week'] = function () { SS.app.printNode(document.getElementById('weeklySheet')); };

  DK.mount = function (root, frame) {
    if (frame === 'DESK1') SS.results.mountMap(root, { size: 520 });
    if (frame === 'DESK2') SS.calendar.bindRescore(root);
  };
})(window.SS = window.SS || {});
