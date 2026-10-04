/* StackSense prototype: daily dosage calendar (F32 Today, F33 Month, F34 Export). */
(function (SS) {
  'use strict';

  var K = SS.calendar = {};
  var E = SS.engine, ui = SS.ui, esc = ui.esc, C = SS.charts, D = SS.dates, fmt = SS.fmt;
  var icon = function (n, s, c) { return SS.icon(n, s, c); };
  var ACT = SS.actions = SS.actions || {};
  var S = function () { return SS.state; };

  function selDate() { var st = S(); return st.ui.calDate ? D.parse(st.ui.calDate) : SS.DEMO_TODAY; }

  /** Ring segments for a day: done / miss / pending / off, one per slot. */
  K.segments = function (stack, date) {
    var st = S(), plan = E.dayPlan(st, stack, date), taken = st.taken[plan.key] || {};
    var past = date < SS.DEMO_TODAY && !D.same(date, SS.DEMO_TODAY);
    return plan.slots.map(function (sl) {
      if (sl.items.every(function (x) { return x.off; })) return 'off';
      if (taken[sl.id]) return 'done';
      return past ? 'miss' : 'todo';
    });
  };

  var EVENT_ICON = { test: 'flask', rescore: 'check', race: 'flag', refill: 'cart', new: 'plus', off: 'minus' };

  /* ------------------------------------------------------------------ */
  /* F32: Today */
  K.today = function () {
    return {
      kind: 'calendar', appbar: 'results', tab: 'today', title: 'Today',
      body: function () { return '<section class="today">' + K.dayView(selDate(), {}) + '</section>'; },
      mount: function (view) { bindRescore(view); }
    };
  };

  K.dayView = function (date, opts) {
    var st = S(), stack = E.stack(st), plan = E.dayPlan(st, stack, date), prog = E.dayProgress(st, plan);
    var isToday = D.same(date, SS.DEMO_TODAY);
    var head = '<div class="day-head">' +
      (opts.noNav ? '' : '<button type="button" class="icon-btn" data-act="day-shift" data-arg="-1" aria-label="Previous day">' + icon('left', 20) + '</button>') +
      '<div class="day-title"><p class="eyebrow">' + (isToday ? 'Today' : plan.idx < 0 ? 'Before your plan' : 'Day ' + (plan.idx + 1) + ' of your plan') + '</p>' +
      '<h1 class="display-m">' + fmt.date(date) + '</h1>' +
      '<p class="day-sub">' + (plan.idx >= 0 ? 'Day ' + (plan.idx + 1) : 'Starts ' + fmt.date(SS.PLAN_START)) + (plan.isRun ? ' · ' + icon('run', 14) + ' Run day' : '') + '</p></div>' +
      (opts.noNav ? '' : '<button type="button" class="icon-btn" data-act="day-shift" data-arg="1" aria-label="Next day">' + icon('right', 20) + '</button>') + '</div>';
    if (plan.idx < 0) {
      return head + '<div class="empty">' + icon('calendar', 28) + '<p>Your plan starts ' + fmt.date(SS.PLAN_START) + ' with vitamin D3 + K2 and omega-3. New items come in every few days so you can tell what agrees with you.</p>' +
        '<button type="button" class="btn btn-secondary" data-act="day-jump" data-arg="' + D.key(SS.PLAN_START) + '">Go to day 1</button></div>';
    }
    var streak = E.streak(st, stack, SS.DEMO_TODAY);
    var stats = '<div class="day-stats">' + C.dayRing(K.segments(stack, date), 58, { label: prog.done + '/' + prog.total, stroke: 6 }) +
      '<div class="ds-text"><b>' + (prog.done === prog.total && prog.total ? 'All done for today' : prog.done + ' of ' + prog.total + ' slots taken') + '</b>' +
      '<span>' + countLine(plan) + '</span>' +
      '<span class="streak" title="Days in a row with every slot taken">' + icon('flame', 14) + streak + '-day streak</span></div></div>';
    var events = plan.events.filter(function (e) { return e.type !== 'new' && e.type !== 'off'; }).map(eventCard).join('');
    var news = [];
    plan.slots.forEach(function (sl) { sl.items.forEach(function (x) { if (x.isNew && !x.off) news.push(x.it); }); });
    var feel = news.map(function (it) { return feelCard(it, plan); }).join('');
    var timeline = '<ol class="timeline">' + plan.slots.map(function (sl) { return slotCard(sl, plan, opts); }).join('') + '</ol>';
    return head + stats + events + feel + timeline +
      (plan.isRun ? '<p class="hint">' + icon('run', 14) + 'Run day: creatine after your run is fine too.</p>' : '') +
      (opts.noFooter ? '' : '<p class="fine">' + esc(SS.DISCLAIMER) + '</p>');
  };

  function countLine(plan) {
    var pills = 0, scoops = 0;
    plan.slots.forEach(function (sl) { sl.items.forEach(function (x) { if (x.off) return; if (x.it.isPill) pills += x.it.units; else if (x.it.form === 'powder') scoops++; }); });
    return pills + ' pill' + (pills === 1 ? '' : 's') + (scoops ? ' + ' + scoops + ' scoop' + (scoops === 1 ? '' : 's') : '') + ' today';
  }

  function slotCard(sl, plan, opts) {
    var st = S(), taken = (st.taken[plan.key] || {})[sl.id];
    var allOff = sl.items.every(function (x) { return x.off; });
    var areas = {};
    sl.items.forEach(function (x) { if (!x.off) Object.keys(x.it.supp.contrib).forEach(function (a) { areas[a] = 1; }); });
    var dots = SS.AREAS.filter(function (a) { return areas[a.id]; }).map(function (a) {
      return '<span class="adot' + (taken ? ' is-solid' : '') + '" style="--c:' + a.color + '" title="' + esc(a.name) + '"></span>';
    }).join('');
    return '<li class="slot' + (taken ? ' is-done' : '') + (allOff ? ' is-off' : '') + '">' +
      '<div class="slot-time">' + fmt.time24(sl.time) + '</div>' +
      '<div class="slot-card"><div class="slot-head">' + icon(sl.icon, 16) + '<b>' + esc(sl.label) + '</b>' +
      (sl.cue ? '<span class="slot-cue">“' + esc(sl.cue) + '”</span>' : '') + '</div>' +
      '<ul class="slot-items">' + sl.items.map(function (x) {
        var s = x.it.supp;
        return '<li class="' + (x.off ? 'is-off' : '') + '"><span class="form-ic" style="--c:' + s.color + '">' + icon(ui.formIcon(x.it.form), 16) + '</span>' +
          '<span class="si-main"><b>' + esc(s.short === 'D3 + K2' ? 'Vitamin D3 + K2' : s.name) + '</b> <span class="si-amt">' + esc(x.it.form === 'powder' ? s.amount : amountFor(x.it)) + '</span>' +
          (x.isNew ? ' <span class="badge-new">New</span>' : '') +
          (s.freq === 'mwf' ? ' <span class="si-note">Mon/Wed/Fri only</span>' : '') +
          (x.off ? '<span class="si-off">' + esc(x.offReason) + '</span>' : '') +
          (x.runNote ? '<span class="si-run">' + icon('run', 12) + esc(x.runNote) + '</span>' : '') + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="slot-foot"><span class="area-dots">' + dots + '</span>' +
      (allOff || opts.readOnly ? '' : '<button type="button" class="check' + (taken ? ' is-on' : '') + '" data-act="slot-check" data-arg="' + plan.key + '|' + sl.id + '" aria-pressed="' + !!taken + '" aria-label="Mark ' + esc(sl.label) + ' as taken">' + icon('check', 18) + '</button>') +
      '</div></div></li>';
  }

  function amountFor(it) {
    var p = it.product;
    if (!p) return it.supp.amount;
    var n = it.units, unit = { capsule: 'capsule', softgel: 'softgel', tablet: 'tablet', lozenge: 'lozenge', drops: 'dose of drops', gummy: 'gummy' }[p.form] || 'capsule';
    var dose = it.id === 'ashwagandha' ? '600 mg · ' : '';
    return dose + n + ' ' + unit + (n > 1 && unit.slice(-1) !== 's' ? 's' : '');
  }

  function eventCard(e) {
    var body = '<p>' + esc(e.sub) + '</p>', actions = '';
    if (e.type === 'test') actions = '<div class="ev-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="doctor-note">' + icon('doc', 14) + 'Doctor note</button><button type="button" class="btn btn-secondary btn-sm" data-act="labs">' + icon('flask', 14) + 'Enter result</button></div>';
    if (e.type === 'refill') actions = '<div class="ev-actions"><a class="btn btn-secondary btn-sm" href="' + esc(e.link) + '" target="_blank" rel="noopener sponsored">' + icon('cart', 14) + 'Reorder</a></div>';
    if (e.type === 'rescore') return rescoreCard(e);
    return '<div class="evcard ev-' + e.type + '"><span class="evcard-ic">' + icon(EVENT_ICON[e.type], 18) + '</span><div><strong>' + esc(e.title) + '</strong>' + body + actions + '</div></div>';
  }

  /* 60-second re-score: sleep, energy and knees. */
  var BASE = { sleep: 4, energy: 4, joints: 5 };
  function rescoreCard() {
    var st = S();
    if (st.rescore) {
      return '<div class="evcard ev-rescore is-done"><span class="evcard-ic">' + icon('check', 18) + '</span><div><strong>Re-score saved</strong>' +
        '<p>Your Health Impact Map now shows your change next to the predicted one.</p><button type="button" class="link-btn" data-act="go" data-arg="F27">See the map' + icon('right', 14) + '</button></div></div>';
    }
    var v = st.ui.rescoreDraft || (st.ui.rescoreDraft = { sleep: 6, energy: 5, joints: 6 });
    var row = function (k, label) {
      return '<label class="rs-row" for="rs-' + k + '"><span>' + label + '</span><input id="rs-' + k + '" class="rs-range" data-k="' + k + '" type="range" min="0" max="10" step="1" value="' + v[k] + '"><output id="rs-out-' + k + '">' + v[k] + '</output></label>';
    };
    return '<div class="evcard ev-rescore"><span class="evcard-ic">' + icon('check', 18) + '</span><div><strong>60-second re-score</strong><p>How are things now? 0 = worst, 10 = great. You started at ' + BASE.sleep + ', ' + BASE.energy + ' and ' + BASE.joints + '.</p>' +
      '<div class="rs">' + row('sleep', 'Sleep') + row('energy', 'Energy') + row('joints', 'Knees') + '</div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="rescore-save">Save re-score</button></div></div>';
  }
  K.bindRescore = bindRescore;
  function bindRescore(view) {
    view.querySelectorAll('.rs-range').forEach(function (r) {
      r.addEventListener('input', function () {
        var k = r.getAttribute('data-k');
        S().ui.rescoreDraft[k] = +r.value;
        var o = view.querySelector('#rs-out-' + k); if (o) o.textContent = r.value;
      });
    });
  }
  ACT['rescore-save'] = function () {
    var st = S(), v = st.ui.rescoreDraft || { sleep: 6, energy: 5, joints: 6 };
    st.rescore = { sleep: v.sleep, energy: v.energy, joints: v.joints, base: BASE };
    SS.app.refresh();
    ui.toast('Saved. Your map now shows reported vs predicted.', { icon: 'check' });
  };

  function feelCard(it, plan) {
    var st = S(), key = plan.key + ':' + it.id, v = st.feel[key];
    var opts = ['Good', 'No change', 'Stomach upset', 'Other'];
    var reply = v === 'Stomach upset' ? 'Try taking it in the middle of a meal. If it continues for 3 more days, we’ll suggest pausing it.' : v === 'Other' ? 'Thanks. We’ll ask again tomorrow.' : v ? 'Thanks. Noted for your next re-score.' : '';
    return '<div class="feel"><p><span class="badge-new">New</span> How do you feel since starting <b>' + esc(it.supp.short.toLowerCase()) + '</b>?</p>' +
      '<div class="chips chips-sm">' + opts.map(function (o) {
        return '<button type="button" class="chip' + (v === o ? ' is-on' : '') + '" data-act="feel" data-arg="' + key + '|' + o + '">' + o + '</button>';
      }).join('') + '</div>' + (reply ? '<p class="feel-reply">' + esc(reply) + '</p>' : '') + '</div>';
  }
  ACT['feel'] = function (arg) { var p = arg.split('|'); S().feel[p[0]] = p[1]; SS.app.refresh(); };

  ACT['slot-check'] = function (arg) {
    var st = S(), p = arg.split('|');
    var t = st.taken[p[0]] || (st.taken[p[0]] = {});
    t[p[1]] = !t[p[1]];
    SS.app.refresh();
  };

  ACT['day-shift'] = function (n) {
    var st = S(), d = D.add(selDate(), +n);
    var min = D.add(SS.PLAN_START, -1), max = new Date(2027, 0, 31);
    if (d < min || d > max) return;
    st.ui.calDate = D.key(d);
    SS.app.refresh();
  };
  ACT['day-jump'] = function (key) {
    var st = S();
    st.ui.calDate = key;
    st.ui.calMonth = key.slice(0, 7);
    if (st.device === 'desktop') SS.app.refresh(); else SS.app.go('F32');
  };

  /* ------------------------------------------------------------------ */
  /* F33: Month */
  K.month = function () {
    return {
      kind: 'calendar', appbar: 'results', tab: 'month', title: 'Plan',
      body: function () { return '<section class="month">' + K.monthView({}) + '</section>'; }
    };
  };

  function monthDate() {
    var st = S(), m = st.ui.calMonth || D.key(SS.DEMO_TODAY).slice(0, 7);
    var p = m.split('-');
    return new Date(+p[0], +p[1] - 1, 1);
  }

  K.monthView = function (opts) {
    var st = S(), stack = E.stack(st), first = monthDate();
    var head = '<div class="month-head"><button type="button" class="icon-btn" data-act="month-shift" data-arg="-1" aria-label="Previous month">' + icon('left', 20) + '</button>' +
      '<h1 class="display-m">' + fmt.month(first) + '</h1>' +
      '<button type="button" class="icon-btn" data-act="month-shift" data-arg="1" aria-label="Next month">' + icon('right', 20) + '</button>' +
      '</div>';
    var lead = (first.getDay() + 6) % 7; // Monday first
    var days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var cells = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { cells += '<div class="cal-wd" aria-hidden="true">' + (opts.wide ? d : d[0]) + '</div>'; });
    for (var i = 0; i < lead; i++) cells += '<div class="cal-cell is-blank"></div>';
    var upcoming = [];
    var sel = st.ui.calDate;
    for (var dnum = 1; dnum <= days; dnum++) {
      var date = new Date(first.getFullYear(), first.getMonth(), dnum), key = D.key(date);
      var plan = E.dayPlan(st, stack, date);
      var marks = plan.events.map(function (e) { return e.type; });
      plan.events.forEach(function (e) { upcoming.push({ date: date, e: e }); });
      var off = plan.slots.some(function (sl) { return sl.items.some(function (x) { return x.off; }); });
      var isToday = D.same(date, SS.DEMO_TODAY);
      cells += '<button type="button" class="cal-cell' + (plan.idx < 0 ? ' is-pre' : '') + (isToday ? ' is-today' : '') + (sel === key ? ' is-sel' : '') + (off ? ' has-off' : '') + '" data-act="day-jump" data-arg="' + key + '" aria-label="' + fmt.date(date) + (marks.length ? ', ' + plan.events.map(function (e) { return e.title; }).join(', ') : '') + '">' +
        '<span class="cal-num">' + dnum + '</span>' +
        (plan.idx >= 0 ? C.dayRing(K.segments(stack, date), opts.wide ? 34 : 26, { stroke: opts.wide ? 4 : 3.5 }) : '<span class="cal-ring-pad"></span>') +
        '<span class="cal-marks">' + uniq(marks).map(function (m) { return '<span class="cm cm-' + m + '">' + icon(EVENT_ICON[m], 10) + '</span>'; }).join('') + '</span>' +
        (opts.wide && plan.events.length ? '<span class="cal-ev">' + esc(plan.events[0].title) + '</span>' : '') +
        '</button>';
    }
    var legend = '<div class="cal-legend">' +
      '<span>' + C.dayRing(['done', 'done', 'todo', 'todo'], 16, { stroke: 3 }) + 'Ring split by slot, filled = taken</span>' +
      '<span><span class="cm cm-test">' + icon('flask', 10) + '</span>Blood test</span>' +
      '<span><span class="cm cm-rescore">' + icon('check', 10) + '</span>Re-score</span>' +
      '<span><span class="cm cm-new">' + icon('plus', 10) + '</span>New item</span>' +
      '<span><span class="cm cm-refill">' + icon('cart', 10) + '</span>Refill</span>' +
      '<span><span class="cm cm-race">' + icon('flag', 10) + '</span>Race</span>' +
      '<span><span class="cal-offkey"></span>Ashwagandha off-week</span></div>';
    var list = upcoming.length ? '<div class="upcoming"><h3>This month</h3><ul>' + upcoming.map(function (u) {
      return '<li><span class="up-date">' + fmt.dateShort(u.date) + '</span><span class="cm cm-' + u.e.type + '">' + icon(EVENT_ICON[u.e.type], 10) + '</span><span><b>' + esc(u.e.title) + '</b> ' + esc(u.e.sub) + '</span></li>';
    }).join('') + '</ul></div>' : '';
    return head + '<div class="cal-grid' + (opts.wide ? ' cal-grid-wide' : '') + '">' + cells + '</div>' + legend + (opts.noList ? '' : list);
  };

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  ACT['month-shift'] = function (n) {
    var st = S(), d = monthDate();
    var nd = new Date(d.getFullYear(), d.getMonth() + (+n), 1);
    if (nd < new Date(2026, 9, 1) || nd > new Date(2027, 0, 1)) return;
    st.ui.calMonth = D.key(nd).slice(0, 7);
    SS.app.refresh();
  };

  /* ------------------------------------------------------------------ */
  /* F34: Export and reminders */
  K.exportScreen = function () {
    return {
      kind: 'calendar', appbar: 'results', tab: 'month', title: 'Reminders', back: true,
      body: function () {
        var st = S(), times = E.slotTimes(st), stack = E.stack(st);
        var used = {};
        stack.items.forEach(function (it) { used[it.supp.slot] = 1; });
        var sw = function (key, label, sub, ic) {
          var on = st.reminders[key] !== false;
          return '<div class="set-row">' + icon(ic, 18) + '<span class="set-label">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
            '<button type="button" class="switch' + (on ? ' is-on' : '') + '" role="switch" aria-checked="' + on + '" data-act="reminder" data-arg="' + key + '" aria-label="' + esc(label) + ' reminder"><span></span></button></div>';
        };
        return '<section class="export"><h1 class="display-l">Reminders and export</h1>' +
          '<h3 class="set-h">Push reminders</h3><div class="set-group">' +
          SS.SLOTS.filter(function (s) { return used[s.id]; }).map(function (s) { return sw(s.id, s.label, fmt.time24(times[s.id]), s.icon); }).join('') +
          sw('refills', 'Refill reminders', '5 days before a bottle runs out', 'cart') +
          sw('rescore', 'Re-score check-ins', 'Weeks 2, 4 and 8', 'check') + '</div>' +
          '<h3 class="set-h">Calendar</h3><div class="set-group set-actions">' +
          '<button type="button" class="set-btn" data-act="ics" data-arg="google">' + icon('calendar', 18) + '<span>Add to Google Calendar<small>An .ics feed that stays in sync if your plan changes</small></span>' + icon('right', 16) + '</button>' +
          '<button type="button" class="set-btn" data-act="ics" data-arg="apple">' + icon('calendar', 18) + '<span>Add to Apple Calendar<small>Same feed, opens in Calendar</small></span>' + icon('right', 16) + '</button></div>' +
          '<h3 class="set-h">Print and share</h3><div class="set-group set-actions">' +
          '<button type="button" class="set-btn" data-act="weekly-sheet">' + icon('print', 18) + '<span>Print a weekly sheet<small>Fridge-friendly, one week per page</small></span>' + icon('right', 16) + '</button>' +
          '<button type="button" class="set-btn" data-act="doctor-note">' + icon('doc', 18) + '<span>Doctor note<small>Signals, stack and the test request</small></span>' + icon('right', 16) + '</button></div>' +
          '<p class="fine">' + esc(SS.DISCLAIMER) + '</p></section>';
      }
    };
  };

  ACT['reminder'] = function (key) { var st = S(); st.reminders[key] = st.reminders[key] === false; SS.app.refresh(); };

  ACT['ics'] = function (which) {
    var st = S(), text = E.ics(st, E.stack(st));
    var lines = text.split('\r\n');
    var events = lines.filter(function (l) { return l === 'BEGIN:VEVENT'; }).length;
    var html = '<div class="sheet-head"><span class="sheet-icon">' + icon('calendar', 20) + '</span><div><h2>Your calendar feed</h2><p>' + events + ' events: daily slots, blood test, re-scores, refills and race day. ' +
      (which === 'google' ? 'In Google Calendar, use Settings › Import.' : 'Open the file and Calendar adds it.') + '</p></div></div>' +
      '<pre class="ics" tabindex="0">' + esc(lines.slice(0, 24).join('\n')) + '\n…</pre>' +
      '<textarea class="sr-only" id="icsText" readonly>' + esc(text) + '</textarea>' +
      '<div class="sheet-actions">' +
      '<button type="button" class="btn btn-secondary" data-act="copy-ics">' + icon('copy', 16) + 'Copy .ics text</button>' +
      (SS.framed ? '' : '<button type="button" class="btn btn-primary" data-act="download-ics">' + icon('download', 16) + 'Download .ics</button>') + '</div>' +
      '<p class="fine">In the app this is a live subscription link, so changes to your plan update the calendar.</p>';
    ui.openSheet(html, { id: 'ics', label: 'Calendar feed', tall: true });
  };
  ACT['copy-ics'] = function (_, el) { var t = document.getElementById('icsText'); ui.copy(t.value, t, el); };
  ACT['download-ics'] = function () { ui.download('stacksense-plan.ics', document.getElementById('icsText').value, 'text/calendar'); };

  ACT['weekly-sheet'] = function () { SS.app.setDevice('desktop', 'DESK3'); };

  /* ------------------------------------------------------------------ */
  /* Printable weekly sheet (used by desktop frame D3). */
  K.weekSheet = function (weekStart) {
    var st = S(), stack = E.stack(st), times = E.slotTimes(st);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(D.add(weekStart, i));
    var plans = days.map(function (d) { return E.dayPlan(st, stack, d); });
    var rows = SS.SLOTS.map(function (sl) {
      var any = plans.some(function (p) { return p.slots.some(function (x) { return x.id === sl.id; }); });
      if (!any) return '';
      return '<tr><th scope="row"><span class="ws-slot">' + icon(sl.icon, 14) + esc(sl.label) + '</span><span class="ws-time">' + fmt.time24(times[sl.id]) + '</span></th>' +
        plans.map(function (p) {
          var s = p.slots.filter(function (x) { return x.id === sl.id; })[0];
          if (!s) return '<td class="ws-none">—</td>';
          return '<td><ul>' + s.items.map(function (x) {
            return '<li class="' + (x.off ? 'is-off' : '') + '"><span class="ws-box"></span>' + esc(x.it.supp.short) + (x.off ? ' <i>off</i>' : '') + '</li>';
          }).join('') + '</ul></td>';
        }).join('') + '</tr>';
    }).join('');
    var notes = [];
    plans.forEach(function (p) { p.events.forEach(function (e) { notes.push('<li><b>' + fmt.date(p.date) + '</b> ' + esc(e.title) + (e.sub ? ' — ' + esc(e.sub) : '') + '</li>'); }); });
    return '<article class="wsheet" id="weeklySheet"><header class="ws-head"><div><span class="logo logo-sm">' + icon('sparkle', 14) + 'StackSense</span>' +
      '<h1>Week of ' + fmt.date(weekStart) + '</h1><p>' + esc(SS.PERSONA.name) + '’s plan · tick each box when taken</p></div>' +
      '<div class="ws-key"><span>' + icon('run', 14) + 'Run days: ' + times.runDays.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); }).join(', ') + '</span><span>B12 Mon/Wed/Fri only</span></div></header>' +
      '<table class="ws-table"><thead><tr><th scope="col"></th>' + plans.map(function (p) {
        return '<th scope="col">' + fmt.dayName(p.date) + '<small>' + fmt.dateShort(p.date) + (p.isRun ? ' · run' : '') + '</small></th>';
      }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="ws-foot"><div><h3>This week</h3><ul>' + (notes.join('') || '<li>No special events.</li>') + '</ul></div>' +
      '<div><h3>Notes</h3><ul><li>D3 + K2 with food that has some fat.</li><li>Omega-3 with a meal to avoid aftertaste.</li><li>Magnesium 90 min before bed. Phone away.</li></ul></div></div>' +
      '<p class="fine">' + esc(SS.DISCLAIMER) + '</p></article>';
  };
})(window.SS = window.SS || {});
