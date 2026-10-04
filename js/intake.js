/* StackSense prototype: onboarding, the adaptive intake cards, stop cards and lab entry. */
(function (SS) {
  'use strict';

  var I = SS.intake = {};
  var E = SS.engine, ui = SS.ui, esc = ui.esc, has = SS.has;
  var icon = function (n, s, c) { return SS.icon(n, s, c); };
  var ACT = SS.actions = SS.actions || {};
  var S = function () { return SS.state; };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ */
  /* Answers: prefilled with Maya's when the demo toggle is on. */
  I.answer = function (id) {
    var st = S(), card = SS.CARD[id];
    if (st.answers[id] === undefined || st.answers[id].notSure) {
      st.answers[id] = st.prefill ? clone(card.maya) : emptyAnswer(card);
      if (id === 'C1' && st.prefill) st.answers[id] = { meds: [], query: 'con' };
    }
    return st.answers[id];
  };

  function emptyAnswer(card) {
    switch (card.type) {
      case 'rank': return { ranked: [] };
      case 'multi': return { picks: [], follow: {} };
      case 'single': case 'scale': return { pick: null, follow: {} };
      case 'time': return { mins: 12 * 60 };
      case 'energy': return { points: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
      case 'body': return { side: 'front', spots: [] };
      case 'training': return { runs: 0, km: 0, hasEvent: false, eventType: 'half', date: '2026-12-13' };
      case 'pss': return { items: [null, null, null, null], source: null };
      case 'meds': return { meds: [], query: '' };
      case 'budget': return { amount: 80 };
      case 'pills': return { max: 4, powders: true };
      case 'day': return clone(card.maya);
    }
    return {};
  }

  function valid(card, a) {
    if (!a) return false;
    switch (card.type) {
      case 'rank': return a.ranked.length > 0;
      case 'multi': return a.picks.length > 0 && (!card.follow || !card.follow.when(a) || card.follow.type !== 'chips' || !!(a.follow && a.follow[card.follow.key]));
      case 'single': case 'scale': return !!a.pick;
      case 'body': return a.spots.length > 0;
      case 'pss': return a.items.every(function (v) { return v != null; }) && !!a.source;
      case 'meds': return a.meds.length > 0 || !!a.none;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Insight rail + confidence ring (top of every intake card). */
  I.appbar = function () {
    var st = S(), pct = E.confidence(st);
    return '<header class="appbar appbar-intake">' +
      '<button type="button" class="icon-btn" data-act="back" aria-label="Back">' + icon('back', 20) + '</button>' +
      '<div class="conf" aria-live="polite">' + SS.charts.confidenceRing(pct, 40) +
      '<span class="conf-text"><span class="conf-label">Profile confidence</span><span class="conf-val">' + pct + '%</span></span></div>' +
      '<span class="brand-mini" aria-hidden="true">' + icon('sparkle', 16) + '</span>' +
      '</header>' + I.rail();
  };

  I.rail = function () {
    var st = S(), sig = E.signals(st);
    st.railOrder = st.railOrder.filter(function (id) { return sig[id]; });
    Object.keys(sig).forEach(function (id) { if (st.railOrder.indexOf(id) < 0) st.railOrder.push(id); });
    var tags = st.railOrder.map(function (id) {
      var s = sig[id], known = st.railKnown[id];
      var cls = !known ? ' is-new' : (known !== s.tag ? ' is-changed' : '');
      var tone = id === 'low_iron_risk' ? (s.locked ? ' tone-lock' : ' tone-iron') : id === 'med_contraceptive' ? ' tone-safety' : '';
      var area = s.area ? SS.AREA[s.area].color : 'var(--caution)';
      return '<button type="button" class="rail-tag' + cls + tone + '" data-act="rail-tag" data-arg="' + id + '" style="--c:' + area + '">' +
        (s.locked ? icon('lock', 12) : '<span class="rail-dot"></span>') + esc(s.tag) + '</button>';
    }).join('');
    var empty = '<span class="rail-empty">Signals appear here as you answer</span>';
    var pop = '';
    if (st.ui.railPop && sig[st.ui.railPop]) {
      var s = sig[st.ui.railPop];
      pop = '<div class="rail-pop" role="dialog" aria-label="Where this came from"><div class="rail-pop-head"><strong>' + esc(s.label) + '</strong>' +
        '<button type="button" class="icon-btn icon-btn-sm" data-act="rail-tag" data-arg="' + s.id + '" aria-label="Close">' + icon('x', 14) + '</button></div>' +
        '<p class="rail-pop-sub">Created by these answers</p><ul>' + s.sources.map(function (x) {
          return '<li><span class="src-card">' + (x.card === 'LAB' ? 'Lab' : x.card) + '</span>' + esc(x.text) + '</li>';
        }).join('') + '</ul></div>';
    }
    return '<div class="rail" id="rail"><div class="rail-track">' + (tags || empty) + '</div>' + pop + '</div>';
  };

  /** After rendering, remember the tags so the next change can pulse once. */
  I.settleRail = function () {
    var st = S(), sig = E.signals(st), changed = false;
    Object.keys(sig).forEach(function (id) { if (st.railKnown[id] !== sig[id].tag) changed = true; });
    var rail = document.getElementById('rail');
    if (rail && changed && st.ui.pulse) {
      rail.classList.remove('is-pulse'); void rail.offsetWidth; rail.classList.add('is-pulse');
      var last = rail.querySelector('.rail-tag.is-new:last-of-type, .rail-tag.is-changed');
      var track = rail.querySelector('.rail-track');
      if (track) track.scrollTo({ left: track.scrollWidth, behavior: SS.reducedMotion() ? 'auto' : 'smooth' });
      if (last) last.setAttribute('data-fresh', '1');
    }
    st.railKnown = {};
    Object.keys(sig).forEach(function (id) { st.railKnown[id] = sig[id].tag; });
    st.ui.pulse = false;
  };

  ACT['rail-tag'] = function (id) {
    var st = S();
    st.ui.railPop = st.ui.railPop === id ? null : id;
    var rail = document.getElementById('rail');
    if (rail) { var tmp = document.createElement('div'); tmp.innerHTML = I.rail(); rail.replaceWith(tmp.firstChild); }
    I.settleRail();
  };

  /* ------------------------------------------------------------------ */
  /* Screen 0: Welcome and privacy */
  I.welcome = function () {
    return {
      kind: 'onboarding', appbar: 'none',
      body: function () {
        var dots = SS.AREAS.map(function (a, i) {
          var ang = (-90 + i * 45) * Math.PI / 180, r = 62;
          return '<circle cx="' + (90 + r * Math.cos(ang)).toFixed(1) + '" cy="' + (90 + r * Math.sin(ang)).toFixed(1) + '" r="7" fill="' + a.color + '"/>';
        }).join('');
        var ring = [30, 62].map(function (r) {
          return '<polygon points="' + SS.AREAS.map(function (a, i) { var ang = (-90 + i * 45) * Math.PI / 180; return (90 + r * Math.cos(ang)).toFixed(1) + ',' + (90 + r * Math.sin(ang)).toFixed(1); }).join(' ') + '"/>';
        }).join('');
        return '<section class="welcome">' +
          '<div class="logo">' + icon('sparkle', 18) + '<span>StackSense</span></div>' +
          '<svg class="welcome-art" viewBox="0 0 180 180" aria-hidden="true"><g class="wa-grid">' + ring + '</g>' +
          '<polygon class="wa-shape" points="90,40 128,58 140,90 120,124 90,128 66,116 52,90 62,62"/>' + dots + '</svg>' +
          '<h1 class="display-xl">Let’s figure out what your body is asking for.</h1>' +
          '<p class="lede">Tell us what you want to feel. We’ll build the stack, show what it does to every part of you, and tell you exactly what to take today.</p>' +
          '<ul class="promises">' +
          '<li>' + icon('clock', 18) + '<span>About 7 minutes</span></li>' +
          '<li>' + icon('user', 18) + '<span>No account needed until the end</span></li>' +
          '<li>' + icon('info', 18) + '<span>We’ll tell you why we ask everything</span></li>' +
          '</ul></section>';
      },
      dock: function () {
        return '<div class="dock"><button type="button" class="btn btn-primary btn-block" data-act="go" data-arg="F02">Start</button>' +
          '<button type="button" class="link-btn" data-act="labs" data-arg="welcome">' + icon('flask', 16) + 'I already have bloodwork</button></div>';
      }
    };
  };

  I.privacy = function () {
    return {
      kind: 'onboarding', appbar: 'back',
      body: function () {
        return '<section class="privacy">' +
          '<span class="privacy-icon">' + icon('shieldCheck', 28) + '</span>' +
          '<h1 class="display-l">Your answers stay yours</h1>' +
          '<p class="lede">Some questions are personal. Here’s what happens to what you tell us.</p>' +
          '<ul class="plist">' +
          '<li><b>Stored on this device</b><span>Nothing leaves your phone until you choose to save your plan.</span></li>' +
          '<li><b>Never sold or shared</b><span>We don’t sell health data or use it for ads.</span></li>' +
          '<li><b>Delete in one tap</b><span>Clear every answer from Settings at any time.</span></li>' +
          '<li><b>Links never steer advice</b><span>We may earn a commission on products. It never changes what we recommend.</span></li>' +
          '</ul></section>';
      },
      dock: function () {
        return '<div class="dock"><button type="button" class="btn btn-primary btn-block" data-act="go" data-arg="A1">Sounds good</button></div>';
      }
    };
  };

  /* ------------------------------------------------------------------ */
  /* Question cards */
  I.card = function (id) {
    var card = SS.CARD[id];
    return {
      kind: 'intake', appbar: 'intake', card: id,
      body: function () {
        var st = S(), a = I.answer(id);
        var title = typeof card.title === 'function' ? card.title(E.answers(st)) : card.title;
        var eyebrow = '';
        if (card.type === 'pss') {
          var step = st.ui.pssStep || 0;
          title = step < 4 ? card.items[step].q : 'What’s the main source right now?';
          eyebrow = '<p class="q-eyebrow">Stress check · ' + (step < 4 ? (step + 1) + ' of 4' : 'last one') + '</p>';
        }
        return '<section class="qcard" data-card="' + id + '">' + eyebrow +
          '<h1 class="q-title">' + esc(title) + '</h1>' +
          (card.helper ? '<p class="q-helper">' + (card.id === 'B12' ? icon('sun', 14) : '') + esc(card.helper) + '</p>' : '') +
          '<div class="q-control">' + CONTROLS[card.type](card, a) + '</div>' +
          whyStrip(card) + '</section>';
      },
      dock: function () {
        var st = S(), a = I.answer(id);
        var ok = card.type === 'pss' ? pssStepValid(a) : valid(card, a);
        var label = card.type === 'pss' && (st.ui.pssStep || 0) < 4 ? 'Next' : 'Continue';
        return '<div class="dock dock-intake">' +
          '<button type="button" class="btn btn-primary btn-block" data-act="continue"' + (ok ? '' : ' disabled') + '>' + label + '</button>' +
          '<button type="button" class="link-btn" data-act="not-sure">Not sure</button></div>';
      },
      mount: function (view) {
        if (card.type === 'rank') bindRank(view);
        if (card.type === 'energy') bindEnergy(view);
        if (card.type === 'meds') bindMeds(view);
        if (card.type === 'budget') bindBudget(view);
        if (card.type === 'training') bindTraining(view);
      }
    };
  };

  function whyStrip(card) {
    var open = S().ui.whyOpen;
    return '<div class="why' + (open ? ' is-open' : '') + '">' +
      '<button type="button" class="why-toggle" data-act="why-toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      icon('info', 16) + '<span>Why we’re asking</span>' + icon(open ? 'up' : 'down', 16, 'why-chev') + '</button>' +
      (open ? '<p class="why-text">' + esc(card.why) + '</p>' : '') + '</div>';
  }

  ACT['why-toggle'] = function () { S().ui.whyOpen = !S().ui.whyOpen; SS.app.refresh(); };

  /* ---------- Controls ---------- */
  var CONTROLS = {};

  CONTROLS.rank = function (card, a) {
    var full = a.ranked.length >= card.max;
    var grid = '<div class="goal-grid">' + card.options.map(function (o) {
      var r = a.ranked.indexOf(o.id), on = r >= 0;
      return '<button type="button" class="goal-chip' + (on ? ' is-on' : '') + (!on && full ? ' is-muted' : '') + '" data-act="rank-toggle" data-arg="' + o.id + '" aria-pressed="' + on + '" style="--c:' + SS.AREA[o.area].color + '">' +
        '<span class="goal-ic">' + icon(o.icon, 20) + '</span><span class="goal-label">' + esc(o.label) + '</span>' +
        (on ? '<span class="goal-rank">' + (r + 1) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    var list = '';
    if (a.ranked.length) {
      list = '<div class="rank-box"><p class="rank-title">Your order <span>' + (a.ranked.length > 1 ? 'Drag to rank' : 'Pick up to 2 more') + '</span></p>' +
        '<ol class="rank-list" data-rank-list>' + a.ranked.map(function (gid, i) {
          var o = card.options.filter(function (x) { return x.id === gid; })[0];
          return '<li class="rank-item" data-id="' + gid + '" data-i="' + i + '" style="--c:' + SS.AREA[o.area].color + '">' +
            '<span class="rank-num">' + (i + 1) + '</span>' + icon(o.icon, 18, 'rank-ic') + '<span class="rank-label">' + esc(o.label) + '</span>' +
            '<span class="rank-weight">weight ' + SS.GOAL_WEIGHTS[i].toFixed(1) + '</span>' +
            '<span class="rank-handle" data-drag aria-label="Drag to reorder" role="button" tabindex="0">' + icon('handle', 18) + '</span></li>';
        }).join('') + '</ol></div>';
    }
    return grid + list;
  };

  CONTROLS.multi = function (card, a) {
    var out = '<div class="chips">' + card.options.map(function (o) {
      var on = a.picks.indexOf(o.id) >= 0;
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + (o.id === 'none' ? ' chip-ghost' : '') + '" data-act="multi-toggle" data-arg="' + o.id + '" aria-pressed="' + on + '">' +
        (on ? icon('check', 14) : '') + esc(o.label) + '</button>';
    }).join('') + '</div>';
    return out + followUp(card, a);
  };

  CONTROLS.single = function (card, a) {
    var out = '<div class="opt-list" role="radiogroup">' + card.options.map(function (o) {
      var on = a.pick === o.id;
      return '<button type="button" class="opt' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="single-pick" data-arg="' + o.id + '">' +
        '<span class="opt-radio"></span><span>' + esc(o.label) + '</span></button>';
    }).join('') + '</div>';
    return out + followUp(card, a);
  };

  function followUp(card, a) {
    var f = card.follow;
    if (!f || !f.when(a)) return '';
    a.follow = a.follow || {};
    var inner;
    if (f.type === 'chips') {
      inner = '<div class="chips chips-sm">' + f.options.map(function (o) {
        var on = a.follow[f.key] === o;
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-act="follow-pick" data-arg="' + f.key + '|' + esc(o) + '" aria-pressed="' + on + '">' + esc(o) + '</button>';
      }).join('') + '</div>';
    } else {
      var v = a.follow[f.key] == null ? 1 : a.follow[f.key];
      inner = stepper('follow-step', f.key, v, f.unit);
    }
    return '<div class="follow"><p class="follow-label">' + esc(f.label) + '</p>' + inner + '</div>';
  }

  function stepper(act, key, value, unit, display) {
    return '<div class="stepper"><button type="button" class="icon-btn" data-act="' + act + '" data-arg="' + key + '|-1" aria-label="Decrease">' + icon('minus', 18) + '</button>' +
      '<output class="stepper-val">' + (display || value) + (unit ? ' <small>' + esc(unit) + '</small>' : '') + '</output>' +
      '<button type="button" class="icon-btn" data-act="' + act + '" data-arg="' + key + '|1" aria-label="Increase">' + icon('plus', 18) + '</button></div>';
  }

  CONTROLS.time = function (card, a) {
    var none = !!a.none;
    var t = SS.fmt.time12(a.mins).split(' ');
    var quick = [['Morning only', 10 * 60], ['Around lunch', 13 * 60], ['Mid-afternoon', 15 * 60 + 30], ['Evening', 19 * 60]];
    return '<div class="timepick' + (none ? ' is-muted' : '') + '">' +
      '<button type="button" class="icon-btn icon-btn-lg" data-act="time-step" data-arg="-15" aria-label="15 minutes earlier">' + icon('minus', 22) + '</button>' +
      '<output class="time-big">' + (none ? '—' : t[0] + ' <small>' + t[1] + '</small>') + '</output>' +
      '<button type="button" class="icon-btn icon-btn-lg" data-act="time-step" data-arg="15" aria-label="15 minutes later">' + icon('plus', 22) + '</button></div>' +
      '<div class="chips chips-sm chips-center">' + quick.map(function (q) {
        var on = !none && a.mins === q[1];
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-act="time-set" data-arg="' + q[1] + '">' + q[0] + '</button>';
      }).join('') + '<button type="button" class="chip chip-ghost' + (none ? ' is-on' : '') + '" data-act="time-none">No caffeine</button></div>';
  };

  /* Energy line: 9 draggable points from 6 am to 10 pm on a 6 am–11 pm axis. */
  var EG = { w: 320, h: 196, x0: 30, x1: 308, y0: 156, y1: 18 };
  function ex(h) { return EG.x0 + (h - 6) / 17 * (EG.x1 - EG.x0); }
  function ey(v) { return EG.y0 - v / 10 * (EG.y0 - EG.y1); }

  CONTROLS.energy = function (card, a) {
    var pat = E.energyPattern(a.points);
    var presets = [['steady', 'Steady'], ['slow', 'Slow start'], ['crash', 'Afternoon crash']];
    return '<div class="energy">' + energySvg(a.points, pat) + '</div>' +
      '<p class="energy-read" id="energyRead">' + icon('bolt', 14) + '<span>Looks like: ' + esc(pat.text.toLowerCase()) + '</span></p>' +
      '<div class="chips chips-sm chips-center">' + presets.map(function (p) {
        return '<button type="button" class="chip" data-act="energy-preset" data-arg="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div>';
  };

  function energySvg(pts, pat) {
    var H = SS.ENERGY_HOURS;
    var xy = pts.map(function (v, i) { return [ex(H[i]), ey(v)]; });
    var line = SS.charts.smoothPath(xy);
    var area = line + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + EG.y0 + ' L' + xy[0][0].toFixed(1) + ' ' + EG.y0 + ' Z';
    var ticks = [[6, '6a'], [9, '9a'], [12, '12p'], [15, '3p'], [18, '6p'], [21, '9p'], [23, '11p']];
    return '<svg class="energy-svg" viewBox="0 0 ' + EG.w + ' ' + EG.h + '" role="img" aria-label="Energy through the day">' +
      '<rect class="eg-crash' + (pat && pat.crash ? ' is-on' : '') + '" x="' + ex(14).toFixed(1) + '" y="' + EG.y1 + '" width="' + (ex(16) - ex(14)).toFixed(1) + '" height="' + (EG.y0 - EG.y1) + '" rx="6"/>' +
      [0, 5, 10].map(function (v) { return '<line class="eg-grid" x1="' + EG.x0 + '" x2="' + EG.x1 + '" y1="' + ey(v) + '" y2="' + ey(v) + '"/>'; }).join('') +
      '<text class="eg-y" x="' + (EG.x0 - 6) + '" y="' + (ey(10) + 4) + '" text-anchor="end">High</text>' +
      '<text class="eg-y" x="' + (EG.x0 - 6) + '" y="' + (ey(0) + 4) + '" text-anchor="end">Low</text>' +
      ticks.map(function (t) { return '<text class="eg-x" x="' + ex(t[0]).toFixed(1) + '" y="' + (EG.y0 + 20) + '" text-anchor="middle">' + t[1] + '</text>'; }).join('') +
      '<path class="eg-area" d="' + area + '"/><path class="eg-line" d="' + line + '"/>' +
      xy.map(function (p, i) {
        return '<g class="eg-pt" data-pt="' + i + '"><circle class="eg-hit" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="16"/>' +
          '<circle class="eg-dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="6.5"/></g>';
      }).join('') + '</svg>';
  }

  function bindEnergy(view) {
    var svg = view.querySelector('.energy-svg');
    if (!svg) return;
    var dragging = null;
    svg.addEventListener('pointerdown', function (e) {
      var g = e.target.closest('.eg-pt');
      if (!g) return;
      dragging = +g.getAttribute('data-pt');
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('is-dragging');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      if (dragging == null) return;
      var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      var v = Math.max(0, Math.min(10, (EG.y0 - loc.y) / (EG.y0 - EG.y1) * 10));
      var a = I.answer('B1');
      a.points[dragging] = Math.round(v * 2) / 2;
      redrawEnergy(view, a);
    });
    function end() {
      if (dragging == null) return;
      dragging = null; svg.classList.remove('is-dragging');
      SS.app.refreshDock();
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  function redrawEnergy(view, a) {
    var pat = E.energyPattern(a.points), H = SS.ENERGY_HOURS;
    var xy = a.points.map(function (v, i) { return [ex(H[i]), ey(v)]; });
    var line = SS.charts.smoothPath(xy);
    var svg = view.querySelector('.energy-svg');
    svg.querySelector('.eg-line').setAttribute('d', line);
    svg.querySelector('.eg-area').setAttribute('d', line + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + EG.y0 + ' L' + xy[0][0].toFixed(1) + ' ' + EG.y0 + ' Z');
    svg.querySelector('.eg-crash').classList.toggle('is-on', !!pat.crash);
    svg.querySelectorAll('.eg-pt').forEach(function (g, i) {
      g.querySelectorAll('circle').forEach(function (c) { c.setAttribute('cy', xy[i][1].toFixed(1)); });
    });
    var read = view.querySelector('#energyRead span');
    if (read) read.textContent = 'Looks like: ' + pat.text.toLowerCase();
  }

  ACT['energy-preset'] = function (p) {
    var a = I.answer('B1');
    a.points = { steady: [5, 6, 6.5, 6.5, 6, 6, 6, 5.5, 4.5], slow: [2, 3.5, 5, 6.5, 7, 7, 6.5, 6, 5], crash: clone(SS.CARD.B1.maya.points) }[p];
    SS.app.refresh();
  };

  CONTROLS.scale = function (card, a) {
    return '<div class="scale" role="radiogroup">' + card.options.map(function (o) {
      var on = a.pick === o.id, drops = '';
      for (var i = 1; i <= 4; i++) drops += '<span class="sdrop' + (i <= o.level ? ' is-fill' : '') + '">' + icon('drop', 16) + '</span>';
      return '<button type="button" class="scale-opt' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="single-pick" data-arg="' + o.id + '">' +
        '<span class="sdrops">' + drops + '</span><span class="scale-label">' + esc(o.label) + '</span><span class="scale-sub">' + esc(o.sub) + '</span></button>';
    }).join('') + '</div>';
  };

  CONTROLS.body = function (card, a) {
    var side = a.side || 'front';
    var spots = SS.BODY_SPOTS[side];
    var fig = '<g class="fig">' +
      '<circle cx="100" cy="36" r="20"/><rect x="91" y="54" width="18" height="16" rx="5"/>' +
      '<path d="M60 82 Q100 68 140 82 L136 204 Q100 214 64 204 Z"/>' +
      '<path class="limb" d="M141 90 L154 160 L162 216" /><path class="limb" d="M59 90 L46 160 L38 216" />' +
      '<path class="limb leg" d="M120 202 L120 290 L118 372" /><path class="limb leg" d="M80 202 L80 290 L82 372" />' +
      '<ellipse cx="' + (side === 'front' ? 124 : 116) + '" cy="386" rx="12" ry="6"/><ellipse cx="' + (side === 'front' ? 76 : 84) + '" cy="386" rx="12" ry="6"/></g>';
    var targets = spots.map(function (s) {
      var on = a.spots.indexOf(s.id) >= 0;
      return '<g class="spot' + (on ? ' is-on' : '') + '" data-act="spot-toggle" data-arg="' + s.id + '" role="button" tabindex="0" aria-pressed="' + on + '" aria-label="' + esc(s.label) + '">' +
        '<circle class="spot-hit" cx="' + s.x + '" cy="' + s.y + '" r="17"/><circle class="spot-dot" cx="' + s.x + '" cy="' + s.y + '" r="9"/></g>';
    }).join('');
    return '<div class="seg-toggle" role="tablist">' +
      '<button type="button" role="tab" class="' + (side === 'front' ? 'is-on' : '') + '" aria-selected="' + (side === 'front') + '" data-act="body-side" data-arg="front">Front</button>' +
      '<button type="button" role="tab" class="' + (side === 'back' ? 'is-on' : '') + '" aria-selected="' + (side === 'back') + '" data-act="body-side" data-arg="back">Back</button></div>' +
      '<div class="bodymap"><svg viewBox="0 0 200 400" class="body-svg" aria-label="Body map, ' + side + '">' + fig + targets + '</svg>' +
      '<p class="body-sel">' + icon('joint', 16) + '<span>' + esc(SS.spotsLabel(a)) + '</span></p></div>';
  };

  CONTROLS.training = function (card, a) {
    var types = [['5k', '5K'], ['10k', '10K'], ['half', 'Half'], ['full', 'Marathon']];
    return '<div class="form-rows">' +
      '<div class="form-row"><span class="fr-label">Runs per week</span>' + stepper('train-step', 'runs', a.runs) + '</div>' +
      '<div class="form-row"><span class="fr-label">Distance per week</span>' + stepper('train-step', 'km', a.km, 'km') + '</div>' +
      '<div class="form-row"><span class="fr-label">Training for an event?</span>' +
      '<button type="button" class="switch' + (a.hasEvent ? ' is-on' : '') + '" role="switch" aria-checked="' + !!a.hasEvent + '" data-act="train-event" aria-label="Training for an event"><span></span></button></div>' +
      (a.hasEvent ? '<div class="form-sub"><div class="chips chips-sm">' + types.map(function (t) {
        return '<button type="button" class="chip' + (a.eventType === t[0] ? ' is-on' : '') + '" data-act="train-type" data-arg="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div><label class="date-field" for="eventDate">' + icon('flag', 16) + '<span>Event date</span>' +
        '<input id="eventDate" type="date" min="2026-10-05" max="2027-12-31" value="' + esc(a.date) + '"></label>' +
        '<p class="hint">' + icon('calendar', 14) + 'Goes on your calendar. Nothing new starts that week.</p></div>' : '') +
      '</div>';
  };

  function bindTraining(view) {
    var inp = view.querySelector('#eventDate');
    if (inp) inp.addEventListener('change', function () { I.answer('B10').date = inp.value; });
  }

  function pssStepValid(a) {
    var step = S().ui.pssStep || 0;
    return step < 4 ? a.items[step] != null : !!a.source;
  }

  CONTROLS.pss = function (card, a) {
    var step = S().ui.pssStep || 0;
    var dots = '<div class="pss-dots" aria-hidden="true">' + [0, 1, 2, 3, 4].map(function (i) {
      return '<span class="' + (i < step ? 'is-done' : i === step ? 'is-cur' : '') + '"></span>';
    }).join('') + '</div>';
    if (step < 4) {
      return dots + '<div class="pss-card' + (S().ui.pssAnim ? ' is-enter' : '') + '"><p class="pss-scope">In the last month</p><div class="opt-list opt-list-tight" role="radiogroup">' + card.scale.map(function (label, v) {
        var on = a.items[step] === v;
        return '<button type="button" class="opt' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-act="pss-pick" data-arg="' + v + '">' +
          '<span class="opt-radio"></span><span>' + label + '</span><span class="opt-num">' + v + '</span></button>';
      }).join('') + '</div></div>';
    }
    var score = E.pssScore(a);
    return dots + '<div class="pss-card' + (S().ui.pssAnim ? ' is-enter' : '') + '"><p class="pss-score">Your score: <b>' + score + ' of 16</b>' + (score > 8 ? ' · moderate stress' : ' · low stress') + '</p>' +
      '<div class="chips">' + card.sources.map(function (src) {
        var on = a.source === src;
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-act="pss-source" data-arg="' + esc(src) + '" aria-pressed="' + on + '">' + (on ? icon('check', 14) : '') + esc(src) + '</button>';
      }).join('') + '</div></div>';
  };

  /* C1: search over a small local drug list, autocomplete after 3 letters. */
  CONTROLS.meds = function (card, a) {
    var sel = a.meds.map(function (id) {
      return '<span class="chip is-on chip-removable">' + esc(SS.MED[id].name) +
        '<button type="button" data-act="med-remove" data-arg="' + id + '" aria-label="Remove ' + esc(SS.MED[id].name) + '">' + icon('x', 14) + '</button></span>';
    }).join('');
    return '<div class="search"><label for="medSearch" class="sr-only">Search medicines and supplements</label>' + icon('search', 18) +
      '<input id="medSearch" type="search" autocomplete="off" spellcheck="false" placeholder="Search medicines and supplements" value="' + esc(a.query || '') + '"></div>' +
      '<div class="ac" id="medResults">' + medResults(a) + '</div>' +
      (sel ? '<div class="chips sel-meds">' + sel + '</div>' : '') +
      (a.meds.length ? '' : '<button type="button" class="chip chip-ghost' + (a.none ? ' is-on' : '') + '" data-act="meds-none">' + (a.none ? icon('check', 14) : '') + 'I don’t take anything</button>') +
      '<div id="medNotice">' + medNotices(a) + '</div>';
  };

  function medResults(a) {
    var q = (a.query || '').trim().toLowerCase();
    if (q.length < 3) return q.length ? '<p class="ac-hint">Keep typing…</p>' : '';
    var hits = SS.MEDS.filter(function (m) {
      return a.meds.indexOf(m.id) < 0 && (m.name.toLowerCase().indexOf(q) >= 0 || m.alias.toLowerCase().indexOf(q) >= 0);
    }).slice(0, 5);
    if (!hits.length) return '<p class="ac-hint">No match. You can still continue; a pharmacist will check it.</p>';
    return '<ul class="ac-list" role="listbox">' + hits.map(function (m) {
      var name = esc(m.name), i = m.name.toLowerCase().indexOf(q);
      if (i >= 0) name = esc(m.name.slice(0, i)) + '<mark>' + esc(m.name.slice(i, i + q.length)) + '</mark>' + esc(m.name.slice(i + q.length));
      return '<li><button type="button" role="option" data-act="med-add" data-arg="' + m.id + '">' + icon('plus', 16) + '<span><span class="ac-name">' + name + '</span><span class="ac-alias">' + esc(m.alias) + '</span></span></button></li>';
    }).join('') + '</ul>';
  }

  function medNotices(a) {
    var cls = a.meds.map(function (id) { return SS.MED[id].cls; });
    var out = [];
    if (cls.indexOf('hormonal') >= 0) {
      out.push(ui.safetyBanner('Interaction check', 'We will never suggest <b>St John’s wort</b> to you: it can make birth control less reliable.',
        '<p class="sb-plus">' + icon('plus', 14) + 'The pill is linked to lower magnesium and B-vitamin levels, so we’ll give those more weight.</p>'));
    }
    if (cls.indexOf('ssri') >= 0) out.push(ui.safetyBanner('Interaction check', 'We will never suggest <b>St John’s wort</b> or <b>5-HTP</b> to you: both can interact with your antidepressant.'));
    if (cls.indexOf('thinner') >= 0) out.push(ui.safetyBanner('Interaction check', 'We’ll leave out <b>curcumin</b> and keep omega-3 to a modest dose because you take a blood thinner.'));
    if (cls.indexOf('thyroid') >= 0) out.push(ui.safetyBanner('Timing rule', 'We’ll keep magnesium, iron and calcium at least 4 hours away from your thyroid medicine.'));
    if (cls.indexOf('b12drain') >= 0) out.push('<div class="notice">' + icon('info', 16) + '<p>This can lower B12 over time, so we’ll give B12 more weight.</p></div>');
    if (cls.indexOf('supp') >= 0) out.push('<div class="notice">' + icon('info', 16) + '<p>We’ll count what you already take so you don’t double up.</p></div>');
    if (a.meds.length && !out.length) out.push('<div class="notice notice-ok">' + icon('check', 16) + '<p>No conflicts with common supplements.</p></div>');
    return out.join('');
  }

  function bindMeds(view) {
    var inp = view.querySelector('#medSearch');
    if (!inp) return;
    inp.addEventListener('input', function () {
      var a = I.answer('C1');
      a.query = inp.value;
      view.querySelector('#medResults').innerHTML = medResults(a);
    });
    if (S().ui.focusSearch) { try { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* ignore */ } }
  }

  CONTROLS.budget = function (card, a) {
    var st = S(), stack = E.stack(st);
    var est = stack.monthly;
    return '<div class="budget"><output class="budget-big" id="budgetOut">$' + a.amount + '<small>/month</small></output>' +
      '<label class="sr-only" for="budget">Monthly budget in Canadian dollars</label>' +
      '<input id="budget" type="range" min="30" max="150" step="5" value="' + a.amount + '" style="--p:' + ((a.amount - 30) / 120 * 100) + '%">' +
      '<div class="budget-scale"><span>$30</span><span>$90</span><span>$150</span></div>' +
      (est ? '<p class="budget-est" id="budgetEst">' + budgetEstText(est, a.amount) + '</p>' : '') + '</div>';
  };

  function budgetEstText(est, amount) {
    return icon('cart', 14) + '<span>What we’ve heard so far points to about <b>' + SS.fmt.money(est) + '/month</b>' +
      (est > amount ? '. We’ll drop the lowest-value item to fit.' : ', inside this budget.') + '</span>';
  }

  function bindBudget(view) {
    var r = view.querySelector('#budget');
    if (!r) return;
    r.addEventListener('input', function () {
      var a = I.answer('D1');
      a.amount = +r.value;
      r.style.setProperty('--p', ((a.amount - 30) / 120 * 100) + '%');
      view.querySelector('#budgetOut').innerHTML = '$' + a.amount + '<small>/month</small>';
      var est = view.querySelector('#budgetEst');
      if (est) est.innerHTML = budgetEstText(E.stack(S()).monthly, a.amount);
    });
  }

  CONTROLS.pills = function (card, a) {
    var st = S();
    var prev = st.answers.D2; st.answers.D2 = a; var wasCommitted = st.committed.D2; st.committed.D2 = true;
    var stack = E.stack(st);
    st.committed.D2 = wasCommitted; st.answers.D2 = prev;
    return '<div class="form-rows">' +
      '<div class="form-row"><span class="fr-label">Pills a day, at most</span>' + stepper('pills-step', 'max', a.max) + '</div>' +
      '<div class="form-row"><span class="fr-label">Powders are OK<small>Stirred into a drink</small></span>' +
      '<button type="button" class="switch' + (a.powders ? ' is-on' : '') + '" role="switch" aria-checked="' + !!a.powders + '" data-act="pills-powders" aria-label="Powders are OK"><span></span></button></div></div>' +
      (stack.items.length ? '<p class="hint hint-box">' + icon('pill', 14) + 'Right now that’s <b>' + stack.maxPills + ' pills' + (stack.scoops ? ' + ' + stack.scoops + ' scoops' : '') + '</b> on your busiest day' +
        (stack.maxPills > a.max ? ', over your limit.' : '.') + (a.powders ? ' Creatine comes as a powder, so it won’t add a 7th pill.' : '') + '</p>' : '');
  };

  CONTROLS.day = function (card, a) {
    var rows = [['wake', 'Wake up'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['bed', 'Bed']];
    var days = [['mon', 'M'], ['tue', 'T'], ['wed', 'W'], ['thu', 'T'], ['fri', 'F'], ['sat', 'S'], ['sun', 'S']];
    return '<div class="form-rows form-rows-tight">' + rows.map(function (r) {
      return '<div class="form-row"><span class="fr-label">' + r[1] + '</span>' + stepper('day-step', r[0], a[r[0]], '', SS.fmt.time24(a[r[0]])) + '</div>';
    }).join('') + '</div>' +
      '<p class="follow-label">Run days</p><div class="daypick">' + days.map(function (d) {
        var on = a.runDays.indexOf(d[0]) >= 0;
        return '<button type="button" class="dayc' + (on ? ' is-on' : '') + '" data-act="runday-toggle" data-arg="' + d[0] + '" aria-pressed="' + on + '" aria-label="' + d[0] + '">' + d[1] + '</button>';
      }).join('') + '</div>';
  };

  /* ---------- Control actions ---------- */
  function cur() { return SS.CARD[S().frameCard]; }

  ACT['rank-toggle'] = function (id) {
    var a = I.answer('A1'), i = a.ranked.indexOf(id);
    if (i >= 0) a.ranked.splice(i, 1);
    else if (a.ranked.length < 3) a.ranked.push(id);
    SS.app.refresh();
  };

  ACT['multi-toggle'] = function (id) {
    var card = cur(), a = I.answer(card.id), i = a.picks.indexOf(id);
    if (i >= 0) a.picks.splice(i, 1);
    else {
      if (card.exclusive && id === card.exclusive) a.picks = [];
      else if (card.exclusive) a.picks = a.picks.filter(function (x) { return x !== card.exclusive; });
      a.picks.push(id);
    }
    SS.app.refresh();
  };

  ACT['single-pick'] = function (id) { var c = cur(), a = I.answer(c.id); a.pick = id; SS.app.refresh(); };
  ACT['follow-pick'] = function (arg) { var p = arg.split('|'), a = I.answer(cur().id); a.follow = a.follow || {}; a.follow[p[0]] = p[1]; SS.app.refresh(); };
  ACT['follow-step'] = function (arg) {
    var p = arg.split('|'), c = cur(), f = c.follow, a = I.answer(c.id);
    a.follow = a.follow || {};
    var v = (a.follow[p[0]] == null ? 1 : a.follow[p[0]]) + (+p[1]) * (f.step || 1);
    a.follow[p[0]] = Math.max(f.min || 0, Math.min(f.max || 99, v));
    SS.app.refresh();
  };
  ACT['time-step'] = function (d) { var a = I.answer('A4'); a.none = false; a.mins = Math.max(5 * 60, Math.min(23 * 60, a.mins + (+d))); SS.app.refresh(); };
  ACT['time-set'] = function (m) { var a = I.answer('A4'); a.none = false; a.mins = +m; SS.app.refresh(); };
  ACT['time-none'] = function () { var a = I.answer('A4'); a.none = !a.none; SS.app.refresh(); };

  ACT['body-side'] = function (side) { I.answer('B8').side = side; SS.app.refresh(); };
  ACT['spot-toggle'] = function (id) {
    var a = I.answer('B8'), i = a.spots.indexOf(id);
    if (i >= 0) a.spots.splice(i, 1); else a.spots.push(id);
    SS.app.refresh();
  };

  ACT['train-step'] = function (arg) {
    var p = arg.split('|'), a = I.answer('B10');
    if (p[0] === 'runs') a.runs = Math.max(0, Math.min(14, a.runs + (+p[1])));
    else a.km = Math.max(0, Math.min(200, a.km + 5 * (+p[1])));
    SS.app.refresh();
  };
  ACT['train-event'] = function () { var a = I.answer('B10'); a.hasEvent = !a.hasEvent; SS.app.refresh(); };
  ACT['train-type'] = function (t) { I.answer('B10').eventType = t; SS.app.refresh(); };

  ACT['pss-pick'] = function (v) {
    var st = S(), a = I.answer('B11');
    a.items[st.ui.pssStep || 0] = +v;
    st.ui.pssAnim = false;
    SS.app.refresh();
    clearTimeout(I._pssT);
    I._pssT = setTimeout(function () {
      if (st.frameCard !== 'B11' || (st.ui.pssStep || 0) >= 4) return;
      st.ui.pssStep = (st.ui.pssStep || 0) + 1;
      st.ui.pssAnim = true;
      SS.app.refresh();
    }, SS.reducedMotion() ? 0 : 260);
  };
  ACT['pss-source'] = function (src) { I.answer('B11').source = src; SS.app.refresh(); };

  ACT['med-add'] = function (id) {
    var a = I.answer('C1');
    if (a.meds.indexOf(id) < 0) a.meds.push(id);
    a.query = ''; a.none = false;
    if (SS.MED[id].cls === 'hormonal') SS.app.moment('sjw');
    S().ui.focusSearch = false;
    SS.app.refresh();
  };
  ACT['med-remove'] = function (id) { var a = I.answer('C1'); a.meds = a.meds.filter(function (x) { return x !== id; }); SS.app.refresh(); };
  ACT['meds-none'] = function () { var a = I.answer('C1'); a.none = !a.none; SS.app.refresh(); };

  ACT['pills-step'] = function (arg) { var a = I.answer('D2'); a.max = Math.max(1, Math.min(12, a.max + (+arg.split('|')[1]))); SS.app.refresh(); };
  ACT['pills-powders'] = function () { var a = I.answer('D2'); a.powders = !a.powders; SS.app.refresh(); };
  ACT['day-step'] = function (arg) {
    var p = arg.split('|'), a = I.answer('D3');
    a[p[0]] = Math.max(0, Math.min(24 * 60 - 15, a[p[0]] + 15 * (+p[1])));
    SS.app.refresh();
  };
  ACT['runday-toggle'] = function (d) {
    var a = I.answer('D3'), i = a.runDays.indexOf(d);
    if (i >= 0) a.runDays.splice(i, 1); else a.runDays.push(d);
    SS.app.refresh();
  };

  /* Drag-to-rank (A1) with pointer events; other rows make room as you drag. */
  function bindRank(view) {
    var list = view.querySelector('[data-rank-list]');
    if (!list) return;
    var drag = null;
    list.addEventListener('pointerdown', function (e) {
      var item = e.target.closest('.rank-item');
      if (!item || item.parentNode.children.length < 2) return;
      var items = Array.prototype.slice.call(list.children);
      var h = items[0].getBoundingClientRect().height + 8;
      var scale = list.getBoundingClientRect().height / list.offsetHeight || 1;
      drag = { el: item, from: +item.getAttribute('data-i'), to: +item.getAttribute('data-i'), y0: e.clientY, h: h, items: items, scale: scale };
      item.classList.add('is-dragging');
      list.classList.add('is-sorting');
      list.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    list.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = (e.clientY - drag.y0) / drag.scale;
      drag.el.style.transform = 'translateY(' + dy + 'px)';
      var to = Math.max(0, Math.min(drag.items.length - 1, Math.round(drag.from + dy / drag.h)));
      drag.to = to;
      drag.items.forEach(function (el, i) {
        if (el === drag.el) return;
        var shift = 0;
        if (drag.from < to && i > drag.from && i <= to) shift = -drag.h;
        if (drag.from > to && i < drag.from && i >= to) shift = drag.h;
        el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    });
    function end() {
      if (!drag) return;
      var a = I.answer('A1');
      var moved = a.ranked.splice(drag.from, 1)[0];
      a.ranked.splice(drag.to, 0, moved);
      drag = null;
      SS.app.refresh();
    }
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    list.addEventListener('keydown', function (e) {
      var h = e.target.closest('.rank-handle');
      if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      var i = +h.parentNode.getAttribute('data-i'), j = i + (e.key === 'ArrowUp' ? -1 : 1);
      var a = I.answer('A1');
      if (j < 0 || j >= a.ranked.length) return;
      var t = a.ranked[i]; a.ranked[i] = a.ranked[j]; a.ranked[j] = t;
      e.preventDefault();
      SS.app.refresh();
      var nh = document.querySelectorAll('.rank-handle')[j];
      if (nh) nh.focus();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Continue / Not sure / commit */
  ACT['continue'] = function () {
    var st = S(), id = st.frameCard, card = SS.CARD[id], a = I.answer(id);
    if (card.type === 'pss' && (st.ui.pssStep || 0) < 4) {
      if (!pssStepValid(a)) return;
      st.ui.pssStep = (st.ui.pssStep || 0) + 1; st.ui.pssAnim = true;
      SS.app.refresh();
      return;
    }
    if (!valid(card, a)) return;
    if (id === 'B7' && a.pick === 'yes' && st.labs.ferritin == null) { ACT.labs('B7'); return; }
    I.commit(id);
  };

  ACT['not-sure'] = function () {
    var st = S(), id = st.frameCard;
    st.answers[id] = { notSure: true };
    I.commit(id);
  };

  I.commit = function (id) {
    var st = S();
    var before = E.signals(st);
    st.committed[id] = true;
    var after = E.signals(st);
    var a = st.answers[id];
    if (id === 'A2' && has(a, 'snoring') && !st.stopped.sleep) { SS.app.go('STOP_SLEEP'); return; }
    if (id === 'B9' && has(a, 'swelling') && !st.stopped.joints) { SS.app.go('STOP_JOINT'); return; }
    var toast = E.branchToast(id, before, after, st);
    I.advance(id, toast);
  };

  I.advance = function (fromId, toast) {
    var st = S();
    var next = E.nextCard(st, fromId);
    st.ui.pulse = true;
    SS.app.go(next || 'F25');
    if (toast) {
      ui.toast(toast.text, { html: toast.html });
      if (toast.moment) SS.app.moment(toast.moment);
      st.lastToast = toast;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Stop cards (red flags) */
  I.stop = function (which) {
    var D = which === 'sleep' ? {
      title: 'Let’s check your snoring first',
      text: 'Loud snoring or gasping at night can be a sign of sleep apnea. Supplements won’t fix it, and they could hide it. A doctor can arrange a simple sleep test.',
      res: 'Your family doctor is the best first stop. In Ontario you can also call Health811 (dial 811) for free advice, day or night.',
      card: 'A2', from: 'A2', goal: 'sleep'
    } : {
      title: 'Swelling or locking needs a physio',
      text: 'Swelling, locking or a knee that gives way can mean an injury inside the joint. A physiotherapist or sports doctor should look at it before you add anything.',
      res: 'Most physios in Ontario take direct bookings without a referral. Rest from long runs until you’ve been seen.',
      card: 'B9', from: 'B9', goal: 'joints'
    };
    return {
      kind: 'stop', appbar: 'back',
      body: function () {
        return '<section class="stopcard" role="alert"><span class="stop-icon">' + icon('stethoscope', 28) + '</span>' +
          '<p class="stop-eyebrow">See a professional first</p><h1 class="display-l">' + esc(D.title) + '</h1>' +
          '<p class="lede">' + esc(D.text) + '</p>' +
          '<div class="stop-res">' + icon('phoneCall', 18) + '<p>' + esc(D.res) + '</p></div>' +
          '<p class="stop-note">We’ll pause supplements for your ' + (D.goal === 'sleep' ? 'sleep' : 'joints') + ' goal. You can keep going for your other goals.</p></section>';
      },
      dock: function () {
        return '<div class="dock"><button type="button" class="btn btn-primary btn-block" data-act="stop-continue" data-arg="' + D.goal + '|' + D.from + '">Continue for my other goals only</button>' +
          '<button type="button" class="link-btn" data-act="back">Change my answer</button></div>';
      }
    };
  };

  ACT['stop-continue'] = function (arg) {
    var p = arg.split('|'), st = S();
    st.stopped[p[0]] = true;
    I.advance(p[1], { text: p[0] === 'sleep' ? 'Sleep goal paused until you’ve seen a doctor.' : 'Joint supplements paused until a physio has a look.' });
  };

  /* ------------------------------------------------------------------ */
  /* Lab entry sheet: from Welcome, B7 or the locked iron card. */
  ACT['labs'] = function (from) {
    var st = S(), L = st.labs;
    var html = '<div class="sheet-head"><span class="sheet-icon">' + icon('flask', 20) + '</span><div><h2>Enter lab results</h2><p>From bloodwork in the last 12 months. Leave blank anything you don’t have.</p></div></div>' +
      '<form class="labs" id="labsForm" novalidate>' +
      labField('ferritin', 'Ferritin', 'µg/L', L.ferritin, 'Iron stores. Under 30 is low.') +
      labField('b12', 'Vitamin B12', 'pmol/L', L.b12, 'Under 150 is low.') +
      labField('vitd', 'Vitamin D, 25(OH)D', 'nmol/L', L.vitd, 'Under 50 is low.') +
      '<div class="labs-examples"><span>Try an example:</span>' +
      '<button type="button" class="chip chip-sm" data-act="lab-example" data-arg="18">Ferritin 18 (low)</button>' +
      '<button type="button" class="chip chip-sm" data-act="lab-example" data-arg="72">Ferritin 72 (normal)</button></div>' +
      '<button type="submit" class="btn btn-primary btn-block">Save results</button></form>';
    ui.openSheet(html, {
      id: 'labs', label: 'Enter lab results', onMount: function (w) {
        var f = w.querySelector('#labsForm');
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var val = function (n) { var v = f.elements[n].value.trim(); return v === '' ? null : Math.max(0, +v); };
          saveLabs({ ferritin: val('ferritin'), b12: val('b12'), vitd: val('vitd') }, from);
        });
      }
    });
  };

  function labField(name, label, unit, v, hint) {
    return '<label class="lab-field" for="lab-' + name + '"><span class="lab-label">' + label + '<small>' + hint + '</small></span>' +
      '<span class="lab-input"><input id="lab-' + name + '" name="' + name + '" type="number" inputmode="decimal" min="0" step="any" value="' + (v == null ? '' : v) + '"><span>' + unit + '</span></span></label>';
  }

  ACT['lab-example'] = function (v) {
    var f = document.getElementById('labsForm');
    if (f) f.elements.ferritin.value = v;
  };

  function saveLabs(vals, from) {
    var st = S();
    st.labs = vals;
    ui.closeSheet();
    var f = vals.ferritin;
    var msg = f == null ? 'Saved. Add a ferritin value to unlock iron.' : f < 30 ? 'Ferritin ' + f + ' µg/L is low. Iron is unlocked.' : f < 50 ? 'Ferritin ' + f + ' µg/L is borderline. Food first, retest in 3 months.' : 'Ferritin ' + f + ' µg/L is normal. No iron needed.';
    if (from === 'welcome') {
      st.labsEarly = true;
      ui.toast('Saved. We’ll skip the questions your bloodwork answers.', { icon: 'check' });
      return;
    }
    if (from === 'B7') {
      st.answers.B7 = { pick: 'yes' };
      I.commit('B7');
      setTimeout(function () { ui.toast(msg, { icon: 'flask' }); }, 50);
      return;
    }
    SS.app.refresh();
    ui.toast(msg, { icon: 'flask' });
  }
})(window.SS = window.SS || {});
