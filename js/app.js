/* StackSense prototype: state, routing, the viewer chrome (frame list, notes, engine panel) and boot. */
(function (SS) {
  'use strict';

  var E = SS.engine, ui = SS.ui, esc = ui.esc;
  var icon = function (n, s, c) { return SS.icon(n, s, c); };
  var ACT = SS.actions = SS.actions || {};
  var app = SS.app = {};

  /* ------------------------------------------------------------------ */
  /* Frames, as listed in section 10 of the spec, plus the edge states from section 9. */
  var FRAMES = [
    { id: 'F01', to: 'F01', group: 'Onboarding', label: 'Welcome', note: 'Headline, three promises, Start. “I already have bloodwork” opens lab entry, which skips questions later.', wire: 'Start → F02 → F03' },
    { id: 'F02', to: 'F02', label: 'Privacy promise', note: 'What happens to answers, before the first question.', wire: 'Sounds good → F03' },
    { id: 'F03', to: 'A1', group: 'Phase A · What do you want to change?', label: 'A1 · Goals' },
    { id: 'F04', to: 'A2', label: 'A2 · Hardest part of sleep' },
    { id: 'F05', to: 'A3', label: 'A3 · When you lie down' },
    { id: 'F06', to: 'A4', label: 'A4 · Last caffeine' },
    { id: 'F06b', to: 'A4', overlay: 'toast', label: 'Branch toast overlay', note: 'The restless-legs answer opened the iron path. Toast auto-dismisses after 2.5 s; the rail pulses once and the new tag fades in.', wire: 'Toast auto-dismiss 2.5 s · tap a rail tag to see its sources' },
    { id: 'F07', to: 'B1', group: 'Phase B · Follow the signals', label: 'B1 · Energy line', wire: 'Drag any point, or use the 3 preset shapes' },
    { id: 'F08', to: 'B2', label: 'B2 · Symptom cluster', wire: 'Continue → rail grows “Hair shedding”; iron tag turns high; ring 31% → 48%' },
    { id: 'F09', to: 'B3', label: 'B3 · Diet', wire: 'Continue → rail grows 3 diet tags; branch toast' },
    { id: 'F10', to: 'B4', label: 'B4 · Periods' },
    { id: 'F10b', to: 'B4', overlay: 'why', label: '“Why we’re asking” expanded', note: 'The collapsible amber strip, open. Every card has one.' },
    { id: 'F11', to: 'B5', label: 'B5 · How heavy' },
    { id: 'F12', to: 'B6', label: 'B6 · Pregnancy gate' },
    { id: 'F13', to: 'B7', label: 'B7 · Bloodwork' },
    { id: 'F14', to: 'B8', label: 'B8 · Body map', wire: 'Tap spots; front/back toggle' },
    { id: 'F15', to: 'B9', label: 'B9 · Knee pattern' },
    { id: 'F16', to: 'B10', label: 'B10 · Training' },
    { id: 'F17', to: 'B11', label: 'B11 · Stress (PSS-4)', wire: '4 swipe cards, then the source micro-card' },
    { id: 'F18', to: 'B12', label: 'B12 · Daylight' },
    { id: 'F19', to: 'C1', group: 'Phase C · Safety check', label: 'C1 · Medicines search', wire: 'Autocomplete after 3 letters; tap “Combined oral contraceptive”' },
    { id: 'F19b', to: 'C1', overlay: 'interaction', label: 'Interaction notice', note: 'Interaction check runs live as soon as the pill is added: St John’s wort is blocked, magnesium and B vitamins gain weight.' },
    { id: 'F20', to: 'C2', label: 'C2 · Conditions' },
    { id: 'F21', to: 'C3', label: 'C3 · Allergies' },
    { id: 'F22', to: 'D1', group: 'Phase D · Make it fit your life', label: 'D1 · Budget', wire: 'Slider in $5 steps; Maya’s value is $80' },
    { id: 'F23', to: 'D2', label: 'D2 · Pills and powders' },
    { id: 'F24', to: 'D3', label: 'D3 · Your usual day' },
    { id: 'F25', to: 'F25', group: 'Review and analysis', label: 'Here’s what we heard', note: 'Detected signals as editable chips grouped by body area, each with the answers that created it.', wire: 'Tap chip → sources · remove chip → stack count and needs update live' },
    { id: 'F25b', to: 'F25', overlay: 'removed', label: 'Signal removed state', note: '“Actually, my hair is fine.” The summary names exactly what changed.' },
    { id: 'F26', to: 'F26', label: 'Analysis transition', note: 'Four beats over about 7 s. The strike-through list is the emotional peak: it proves earlier answers mattered.', wire: 'After 7 s → F27 · Skip' },
    { id: 'F27', to: 'F27', group: 'Results', label: 'Health Impact Map', note: 'Radar by default; bars show who contributes what. Gap callout for areas under 50%.', wire: 'Toggle radar ↔ bars · tap an area → bottom sheet → filter cards' },
    { id: 'F28', to: 'F28', label: 'Your stack', note: 'Cards sorted by total impact. Product row on each card. Locked iron. Excluded drawer link.', wire: 'Buy → external link (new tab) · See N more → product sheet' },
    { id: 'F29', to: 'F28', overlay: 'expanded', label: 'Stack card expanded', note: 'What it does, the research, how to take it, side effects, interactions.' },
    { id: 'F30', to: 'F28', overlay: 'product', label: 'Product sheet', note: 'Best match, alternative and what the filters removed, with the ranking rules.' },
    { id: 'F31', to: 'F28', overlay: 'excluded', label: 'Excluded drawer', note: 'Collagen (animal-derived), St John’s wort (birth control), melatonin (racing thoughts, not timing), iron (locked: test first).' },
    { id: 'F32', to: 'F32', group: 'Calendar', label: 'Today', note: 'Mon 19 Oct, day 15: full stack, a NEW badge on curcumin, and the first re-score.', wire: 'Check a slot → ring fills and area dots turn solid' },
    { id: 'F33', to: 'F33', label: 'Month', note: 'Ring per day split by slot. Markers for the blood test, re-scores, off-weeks, refills and race day.', wire: 'Tap a day → Today for that date' },
    { id: 'F34', to: 'F34', label: 'Export and reminders', note: 'Per-slot reminder toggles, calendar feed (.ics), weekly sheet and doctor note.' },
    { id: 'DESK1', show: 'D1', to: 'DESK1', group: 'Desktop · 1440 × 900', label: 'Results dashboard', desktop: true, note: 'Map and stack side by side. Bars are the default on desktop.' },
    { id: 'DESK2', show: 'D2', to: 'DESK2', label: 'Calendar month', desktop: true, note: 'Month grid with the selected day beside it.' },
    { id: 'DESK3', show: 'D3', to: 'DESK3', label: 'Printable weekly sheet', desktop: true, note: 'Fridge-friendly. Prints one week per page.' },
    { id: 'X1', to: 'STOP_SLEEP', group: 'Edge states (section 9)', label: 'Stop card: snoring', note: 'Snoring or gasping on A2 stops the sleep branch and points to a sleep-apnea check.' },
    { id: 'X2', to: 'STOP_JOINT', label: 'Stop card: physio referral', note: 'Swelling, locking or giving way on B9 stops joint supplements.' },
    { id: 'X3', to: 'F28', label: 'Over budget', note: 'Same answers with a $60 budget. The optimizer offers to drop the lowest-value item or switch to budget picks.' },
    { id: 'X4', to: 'F27', label: 'Low confidence', note: 'Four “Not sure” answers. Results still show, trimmed to the core 3, with a bloodwork banner.' },
    { id: 'X5', to: 'F28', label: 'Iron unlocked by a lab value', note: 'Ferritin 18 µg/L entered. Iron becomes a dosed card and Skin & hair coverage rises.' },
    { id: 'X6', to: 'F28', label: 'Pregnancy library', note: 'B6 answered yes. Ashwagandha is hidden and a pregnancy-safe banner shows.' }
  ];
  var FRAME = {};
  var groupName = '';
  FRAMES.forEach(function (f) { if (f.group) groupName = f.group; else f.group = groupName; FRAME[f.id] = f; });
  SS.FRAMES = FRAMES;

  var DESKTOP = { DESK1: 1, DESK2: 1, DESK3: 1 };

  /* ------------------------------------------------------------------ */
  /* State */
  function freshUi() {
    return {
      whyOpen: false, railPop: null, sheet: null, pssStep: 0, pssAnim: false, reviewOpen: null, lastDiff: null,
      expanded: null, areaFilter: null, mapMode: 'radar', deskMapMode: 'bars', calDate: null, calMonth: null,
      animateMap: false, pulse: false, focusSearch: false, timers: [], countFlash: false, rescoreDraft: null
    };
  }
  function freshState(prev) {
    return {
      device: prev ? prev.device : 'mobile', frame: null, frameCard: null, history: [],
      prefill: prev ? prev.prefill : true,
      answers: {}, committed: {}, removed: {}, stopped: {}, labs: { ferritin: null, b12: null, vitd: null }, labsEarly: false,
      railOrder: [], railKnown: {}, optim: { dropped: {}, budget: {} }, taken: {}, feel: {}, rescore: null,
      reminders: {}, moments: prev ? prev.moments : {}, analysisDone: false, lastToast: null, lastMobile: 'F27', log: null,
      ui: freshUi()
    };
  }
  SS.state = freshState();
  E.seedTaken(SS.state);

  var PER_SCREEN = ['whyOpen', 'railPop', 'reviewOpen', 'lastDiff', 'expanded', 'pssAnim', 'sheet', 'focusSearch'];

  /* ------------------------------------------------------------------ */
  /* Screen definitions */
  function screenDef(frame) {
    if (SS.CARD[frame]) return SS.intake.card(frame);
    switch (frame) {
      case 'F01': return SS.intake.welcome();
      case 'F02': return SS.intake.privacy();
      case 'STOP_SLEEP': return SS.intake.stop('sleep');
      case 'STOP_JOINT': return SS.intake.stop('joints');
      case 'F25': return SS.results.review();
      case 'F26': return SS.results.analysis();
      case 'F27': return SS.results.map();
      case 'F28': return SS.results.stack();
      case 'F32': return SS.calendar.today();
      case 'F33': return SS.calendar.month();
      case 'F34': return SS.calendar.exportScreen();
    }
    return SS.intake.welcome();
  }

  function appbarHtml(def) {
    if (def.appbar === 'intake') return SS.intake.appbar();
    if (def.appbar === 'back') return '<header class="appbar"><button type="button" class="icon-btn" data-act="back" aria-label="Back">' + icon('back', 20) + '</button></header>';
    if (def.appbar === 'results') {
      return '<header class="appbar appbar-results">' +
        (def.back ? '<button type="button" class="icon-btn" data-act="back" aria-label="Back">' + icon('back', 20) + '</button>' : '<span class="logo logo-sm">' + icon('sparkle', 14) + 'StackSense</span>') +
        '<span class="appbar-title">' + esc(def.back ? def.title : '') + '</span>' +
        (def.back ? '<span class="icon-btn" aria-hidden="true"></span>' : '<button type="button" class="icon-btn icon-btn-quiet" data-act="go" data-arg="F34" aria-label="Reminders and export">' + icon('bell', 18) + '</button>') + '</header>';
    }
    return '';
  }

  function tabbarHtml(def) {
    if (!def.tab) return '';
    var tabs = [['F27', 'map', 'Map', 'radar'], ['F28', 'stack', 'Stack', 'list'], ['F32', 'today', 'Today', 'today'], ['F33', 'month', 'Plan', 'calendar']];
    return '<nav class="tabbar" aria-label="Results">' + tabs.map(function (t) {
      var on = def.tab === t[1];
      return '<button type="button" class="' + (on ? 'is-on' : '') + '" data-act="tab" data-arg="' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(t[3], 20) + '<span>' + t[2] + '</span></button>';
    }).join('') + '</nav>';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering */
  var $ = function (id) { return document.getElementById(id); };
  var currentDef = null;

  function clearTimers() { (SS.state.ui.timers || []).forEach(clearTimeout); SS.state.ui.timers = []; }

  app.go = function (frame, opts) {
    opts = opts || {};
    var st = SS.state;
    if (frame === st.frame && !opts.force) { app.refresh(); return; }
    clearTimers();
    ui.closeSheet(true);
    if (st.frame && !opts.noHistory) st.history.push(st.frame);
    PER_SCREEN.forEach(function (k) { st.ui[k] = freshUi()[k]; });
    if (frame === 'B11' && st.frame !== 'B11') st.ui.pssStep = 0;
    if (frame === 'C1') st.ui.focusSearch = false;
    st.frame = frame;
    st.frameCard = SS.CARD[frame] ? frame : null;
    if (DESKTOP[frame]) st.device = 'desktop';
    else { st.device = 'mobile'; if (/^F(2[7-9]|3[0-4])$/.test(frame)) st.lastMobile = frame; }
    render(opts.dir || 'fwd');
  };

  function render(dir) {
    var st = SS.state;
    document.body.setAttribute('data-device', st.device);
    $('deviceWrap').hidden = st.device !== 'mobile';
    $('deskWrap').hidden = st.device !== 'desktop';
    if (st.device === 'desktop') { renderDesktop(); }
    else renderMobile(dir);
    app.updatePanels();
    fit();
    try { if (history.replaceState) history.replaceState(null, '', '#' + currentFrameId()); } catch (e) { /* sandboxed */ }
  }

  function renderMobile(dir) {
    var st = SS.state, def = currentDef = screenDef(st.frame);
    var screen = $('screen');
    screen.setAttribute('data-kind', def.kind);
    $('appbarSlot').innerHTML = appbarHtml(def);
    var vp = $('viewport');
    var old = vp.querySelector('.view:not(.is-leaving)');
    var view = document.createElement('div');
    view.className = 'view';
    view.innerHTML = def.body();
    var animate = old && !SS.reducedMotion() && dir !== 'none';
    if (animate) view.classList.add(dir === 'back' ? 'from-left' : 'from-right');
    vp.appendChild(view);
    if (old) {
      if (animate) {
        old.classList.add('is-leaving', dir === 'back' ? 'to-right' : 'to-left');
        setTimeout(function () { old.remove(); }, 230);
        void view.offsetWidth;
        view.classList.remove('from-left', 'from-right');
      } else old.remove();
    }
    $('dockSlot').innerHTML = def.dock ? def.dock() : '';
    $('tabSlot').innerHTML = tabbarHtml(def);
    if (def.mount) def.mount(view);
    if (def.appbar === 'intake') SS.intake.settleRail();
  }

  function renderDesktop() {
    var st = SS.state, desk = $('desk');
    var cols = Array.prototype.map.call(desk.querySelectorAll('.desk-col'), function (c) { return c.scrollTop; });
    desk.innerHTML = SS.desktop.render(st.frame);
    desk.querySelectorAll('.desk-col').forEach(function (c, i) { if (cols[i]) c.scrollTop = cols[i]; });
    SS.desktop.mount(desk, st.frame);
  }

  /** Re-render the current screen in place (no slide), keeping scroll. */
  app.refresh = function () {
    var st = SS.state;
    if (st.device === 'desktop') { renderDesktop(); app.updatePanels(); return; }
    var def = currentDef = screenDef(st.frame);
    var view = $('viewport').querySelector('.view:not(.is-leaving)');
    if (!view) { renderMobile('none'); return; }
    var sc = view.scrollTop;
    view.innerHTML = def.body();
    view.scrollTop = sc;
    $('appbarSlot').innerHTML = appbarHtml(def);
    $('dockSlot').innerHTML = def.dock ? def.dock() : '';
    $('tabSlot').innerHTML = tabbarHtml(def);
    if (def.mount) def.mount(view);
    if (def.appbar === 'intake') SS.intake.settleRail();
    app.updatePanels();
  };

  app.refreshDock = function () { if (currentDef && currentDef.dock) $('dockSlot').innerHTML = currentDef.dock(); app.updatePanels(); };

  app.moment = function (key) {
    var st = SS.state;
    if (st.moments[key]) return;
    st.moments[key] = true;
    app.updatePanels();
    var el = document.querySelector('[data-moment="' + key + '"]');
    if (el) { el.classList.add('is-flash'); setTimeout(function () { el.classList.remove('is-flash'); }, 1200); }
  };

  app.log = function (msg) { SS.state.log = msg; app.updatePanels(); };

  app.setDevice = function (dev, frame) {
    var st = SS.state;
    if (dev === 'desktop') {
      if (!st.analysisDone) completeIntake();
      app.go(frame || 'DESK1');
    } else app.go(frame || st.lastMobile || 'F27');
  };

  /* ------------------------------------------------------------------ */
  /* Jumping straight to a frame: replay Maya's answers up to that point. */
  function commitMayaUntil(cardId) {
    var st = SS.state, stopIdx = cardId ? SS.CARD[cardId].index : SS.CARDS.length;
    SS.CARDS.forEach(function (c) {
      if (c.index >= stopIdx) return;
      st.answers[c.id] = JSON.parse(JSON.stringify(c.maya));
      st.committed[c.id] = true;
    });
    var sig = E.signals(st);
    st.railOrder = []; st.railKnown = {};
    ['sleep_onset', 'stress_arousal', 'low_iron_risk', 'caffeine_late', 'afternoon_crash', 'hair_shedding', 'b12_risk', 'omega3_gap', 'low_dietary_creatine', 'exercise_soreness', 'endurance_load', 'stress_moderate', 'vitamin_d_risk', 'med_contraceptive']
      .forEach(function (id) { if (sig[id]) { st.railOrder.push(id); st.railKnown[id] = sig[id].tag; } });
  }

  function completeIntake() {
    commitMayaUntil(null);
    var st = SS.state;
    st.analysisDone = true;
    st.history = ['F25'];
  }

  app.jump = function (fid) {
    var f = FRAME[fid];
    if (!f) return;
    var prev = SS.state;
    clearTimers();
    ui.closeSheet(true);
    document.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
    var st = SS.state = freshState(prev);
    E.seedTaken(st);
    var target = f.to;
    if (SS.CARD[target]) {
      commitMayaUntil(target);
      st.history = ['F01', 'F02'].concat(SS.CARDS.filter(function (c) { return c.index < SS.CARD[target].index; }).map(function (c) { return c.id; }));
    } else if (target === 'STOP_SLEEP') {
      commitMayaUntil('A2');
      st.answers.A2 = { picks: ['falling', 'snoring'] }; st.committed.A2 = true;
      st.history = ['F01', 'F02', 'A1', 'A2'];
    } else if (target === 'STOP_JOINT') {
      commitMayaUntil('B9');
      st.answers.B9 = { picks: ['after', 'swelling'], follow: { lasts: 'Eases within a day' } }; st.committed.B9 = true;
      st.history = ['F01', 'F02', 'B8', 'B9'];
    } else if (['F01', 'F02'].indexOf(target) >= 0) {
      st.history = target === 'F02' ? ['F01'] : [];
    } else {
      completeIntake();
      if (target === 'F25' || target === 'F26') { st.analysisDone = false; st.history = ['D3']; }
    }
    if (fid === 'X3') st.answers.D1 = { amount: 60 };
    if (fid === 'X4') ['A4', 'B5', 'B10', 'B12'].forEach(function (id) { st.answers[id] = { notSure: true }; });
    if (fid === 'X5') st.labs = { ferritin: 18, b12: null, vitd: null };
    if (fid === 'X6') st.answers.B6 = { pick: 'yes' };
    if (fid === 'F06b') {
      delete st.railKnown.low_iron_risk;
      st.ui.pulse = true;
    }
    if (fid === 'F10b') st.ui.whyOpen = true;
    if (fid === 'F29') st.ui.expanded = 'magnesium';
    if (target === 'F27') st.ui.animateMap = true;
    if (fid === 'F19b') st.answers.C1 = { meds: ['coc'], query: '' };
    if (f.desktop) st.ui.animateMap = true;

    /* go() would reset per-screen UI; set the frame directly and render. */
    var keep = { whyOpen: st.ui.whyOpen, expanded: st.ui.expanded };
    st.frame = null;
    app.go(target, { noHistory: true, dir: 'none' });
    st.ui.whyOpen = keep.whyOpen; st.ui.expanded = keep.expanded;
    if (keep.whyOpen || keep.expanded) app.refresh();

    if (fid === 'F06b') { ui.toast('Restless legs can be linked to iron. We’ll look into that.', { ms: 4000 }); app.moment('iron'); }
    if (fid === 'F19b') app.moment('sjw');
    if (fid === 'F25b') ACT['sig-remove']('hair_shedding');
    if (fid === 'F30') ACT['product-sheet']('d3k2');
    if (fid === 'F31') { ACT['excluded'](); app.moment('collagen'); }
    st.jumpedFrom = fid;
    app.updatePanels();
  };

  function currentFrameId() {
    var st = SS.state;
    if (st.jumpedFrom && FRAME[st.jumpedFrom] && FRAME[st.jumpedFrom].to === st.frame && st.jumpedFrom.charAt(0) === 'X') return st.jumpedFrom;
    if (st.ui.sheet === 'product') return 'F30';
    if (st.ui.sheet === 'excluded') return 'F31';
    if (st.frame === 'F28' && st.ui.expanded) return 'F29';
    if (st.frame === 'F25' && Object.keys(st.removed).length) return 'F25b';
    if (st.frame === 'B4' && st.ui.whyOpen) return 'F10b';
    if (st.frame === 'C1' && st.answers.C1 && (st.answers.C1.meds || []).some(function (id) { return SS.MED[id].cls === 'hormonal'; })) return 'F19b';
    if (st.frame === 'STOP_SLEEP') return 'X1';
    if (st.frame === 'STOP_JOINT') return 'X2';
    for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].to === st.frame && !FRAMES[i].overlay && FRAMES[i].id.charAt(0) !== 'X') return FRAMES[i].id;
    return st.frame;
  }
  app.currentFrameId = currentFrameId;

  /* ------------------------------------------------------------------ */
  /* Viewer panels */
  function navHtml() {
    var cur = currentFrameId(), out = '', g = null;
    FRAMES.forEach(function (f) {
      if (f.group !== g) {
        if (g !== null) out += '</ul></div>';
        g = f.group;
        out += '<div class="nav-group"><p class="nav-group-title">' + esc(g) + '</p><ul>';
      }
      out += '<li><button type="button" class="nav-item' + (cur === f.id ? ' is-on' : '') + '" data-act="jump" data-arg="' + f.id + '"' + (cur === f.id ? ' aria-current="true"' : '') + '>' +
        '<span class="nav-id">' + (f.show || f.id) + '</span><span class="nav-label">' + esc(f.label) + '</span></button></li>';
    });
    return out + '</ul></div>';
  }

  function controlsHtml() {
    var st = SS.state;
    return '<div class="viewer-controls">' +
      '<div class="seg-toggle seg-toggle-sm" role="tablist" aria-label="Device">' +
      '<button type="button" role="tab" class="' + (st.device === 'mobile' ? 'is-on' : '') + '" aria-selected="' + (st.device === 'mobile') + '" data-act="device" data-arg="mobile">' + icon('phone', 16) + 'Phone</button>' +
      '<button type="button" role="tab" class="' + (st.device === 'desktop' ? 'is-on' : '') + '" aria-selected="' + (st.device === 'desktop') + '" data-act="device" data-arg="desktop">' + icon('desktop', 16) + 'Desktop</button></div>' +
      '<div class="vc-row"><span class="vc-label">Pre-fill Maya’s answers<small>Tap Continue to follow her path</small></span>' +
      '<button type="button" class="switch' + (st.prefill ? ' is-on' : '') + '" role="switch" aria-checked="' + st.prefill + '" data-act="prefill" aria-label="Pre-fill Maya’s answers"><span></span></button></div>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-act="restart">' + icon('restart', 16) + 'Restart from Welcome</button></div>';
  }

  function notesHtml() {
    var st = SS.state, fid = currentFrameId(), f = FRAME[fid] || {};
    var card = SS.CARD[st.frame];
    var note = f.note || (card ? card.spec : '');
    var maya = card ? mayaAnswerText(card) : '';
    return '<div class="notes"><p class="panel-eyebrow">This frame</p><h2 class="notes-title"><span class="nav-id">' + esc(f.show || fid) + '</span>' + esc(f.label || '') + '</h2>' +
      (maya ? '<p class="notes-maya"><b>Maya answers</b>' + esc(maya) + '</p>' : '') +
      (note ? '<p class="notes-body"><b>What it changes</b>' + esc(note) + '</p>' : '') +
      (f.wire ? '<p class="notes-body"><b>Interactions</b>' + esc(f.wire) + '</p>' : '') + '</div>';
  }

  function mayaAnswerText(card) {
    var m = card.maya;
    var label = function (id) { var o = (card.options || []).filter(function (x) { return x.id === id; })[0]; return o ? o.label : id; };
    switch (card.type) {
      case 'rank': return m.ranked.map(function (id, i) { return (i + 1) + ' ' + label(id); }).join(', ');
      case 'multi': return m.picks.map(label).join('; ') + (m.follow ? ' (' + Object.keys(m.follow).map(function (k) { return m.follow[k]; }).join(', ').toLowerCase() + ')' : '');
      case 'single': case 'scale': return label(m.pick) + (m.follow && m.follow.years ? ', ' + m.follow.years + ' years' : '');
      case 'time': return SS.fmt.time12(m.mins);
      case 'energy': return 'Low start, peak 10 am, crash 2–4 pm';
      case 'body': return 'Both knees';
      case 'training': return m.runs + ' runs, ~' + m.km + ' km/week; half-marathon on 13 Dec';
      case 'pss': return 'Total 9 / 16; main source: work';
      case 'meds': return 'Combined oral contraceptive';
      case 'budget': return '$' + m.amount;
      case 'pills': return 'Up to ' + m.max + ' pills; powders OK';
      case 'day': return '7:00 · 7:30 · 12:30 · 19:00 · 23:00; runs Tue/Thu/Sat';
    }
    return '';
  }

  function engineHtml() {
    var st = SS.state, sig = E.signals(st), stack = E.stack(st, sig);
    var ids = Object.keys(sig);
    return '<div class="engine"><p class="panel-eyebrow">Engine, live</p>' +
      '<div class="eng-stats"><span><b>' + E.confidence(st) + '%</b>confidence</span><span><b>' + ids.length + '</b>signals</span><span><b>' + stack.items.length + (stack.locked ? '+1' : '') + '</b>in stack</span><span><b>' + SS.fmt.money(stack.monthly) + '</b>/month</span></div>' +
      (ids.length ? '<ul class="eng-sigs">' + ids.map(function (id) {
        var s = sig[id];
        return '<li><code>' + id + '</code><span>' + (s.level ? esc(s.level) + (s.locked ? ', locked' : '') : '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted">No signals yet. Answer a card to see them appear.</p>') +
      (st.log ? '<p class="eng-log">' + icon('external', 12) + esc(st.log) + '</p>' : '') + '</div>';
  }

  function momentsHtml() {
    var m = SS.state.moments;
    var rows = [
      ['iron', 'Restless legs → iron path', 'A3 toast, then iron locked at B7'],
      ['collagen', 'Vegetarian → collagen excluded', 'Struck through on the analysis screen'],
      ['sjw', 'Birth control → St John’s wort blocked', 'Live interaction check on C1']
    ];
    return '<div class="moments"><p class="panel-eyebrow">Demo success test</p><ul>' + rows.map(function (r) {
      return '<li data-moment="' + r[0] + '" class="' + (m[r[0]] ? 'is-seen' : '') + '"><span class="mo-check">' + icon('check', 12) + '</span><span><b>' + r[1] + '</b><small>' + r[2] + '</small></span></li>';
    }).join('') + '</ul></div>';
  }

  app.updatePanels = function () {
    var left = $('panelNav'), right = $('panelRight'), drawer = $('drawerBody');
    var nav = navHtml();
    if ($('panelControls')) $('panelControls').innerHTML = controlsHtml();
    if (left) {
      var sc = left.scrollTop;
      left.innerHTML = nav;
      left.scrollTop = sc;
      var on = left.querySelector('.nav-item.is-on');
      if (on && (on.offsetTop < left.scrollTop || on.offsetTop > left.scrollTop + left.clientHeight - 40)) left.scrollTop = on.offsetTop - 120;
    }
    if (right) right.innerHTML = notesHtml() + momentsHtml() + engineHtml();
    if (drawer && document.body.classList.contains('drawer-open')) drawer.innerHTML = controlsHtml() + momentsHtml() + '<nav class="drawer-nav">' + nav + '</nav>';
  };

  /* ------------------------------------------------------------------ */
  /* Viewer actions */
  ACT.go = function (f) { app.go(f); };
  ACT.tab = function (f) { var st = SS.state; if (f !== 'F28') st.ui.areaFilter = null; app.go(f, { noHistory: true, dir: 'none' }); };
  ACT.back = function () {
    var st = SS.state;
    if (st.frameCard === 'B11' && st.ui.pssStep > 0) { st.ui.pssStep--; st.ui.pssAnim = false; app.refresh(); return; }
    var prev = st.history.pop();
    if (!prev) return;
    if (prev === 'F26') prev = st.history.pop() || 'F25';
    app.go(prev, { noHistory: true, dir: 'back' });
  };
  ACT.jump = function (fid) { closeDrawer(); app.jump(fid); };
  ACT.device = function (d) { closeDrawer(); app.setDevice(d); };
  ACT.prefill = function () { SS.state.prefill = !SS.state.prefill; app.updatePanels(); };
  ACT.restart = function () { closeDrawer(); app.jump('F01'); };
  ACT['close-sheet'] = function () { ui.closeSheet(); };
  ACT.drawer = function () {
    document.body.classList.toggle('drawer-open');
    app.updatePanels();
  };
  function closeDrawer() { document.body.classList.remove('drawer-open'); }

  /* Event delegation for every data-act element. */
  function dispatch(el, ev) {
    var name = el.getAttribute('data-act'), fn = ACT[name];
    if (!fn) return;
    if (el.tagName !== 'A') ev.preventDefault();
    if (el.hasAttribute('disabled')) return;
    fn(el.getAttribute('data-arg'), el, ev);
  }
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-act]');
    if (el) { dispatch(el, ev); return; }
    var st = SS.state;
    if (st.ui.railPop && !ev.target.closest('.rail')) { st.ui.railPop = null; app.refresh(); }
  });
  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if ((ev.key === 'Enter' || ev.key === ' ') && t && t.getAttribute && t.getAttribute('data-act') && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
      dispatch(t, ev); return;
    }
    if (ev.key === 'Escape') { if (SS.state.ui.sheet) ui.closeSheet(); closeDrawer(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || SS.state.ui.sheet) return;
    if (ev.altKey || ev.metaKey || ev.ctrlKey) return;
    if (ev.key === 'ArrowRight' && SS.state.device === 'mobile') {
      var b = document.querySelector('#dockSlot .btn-primary:not([disabled])');
      if (b) { ev.preventDefault(); b.click(); }
    } else if (ev.key === 'ArrowLeft' && SS.state.device === 'mobile' && !t.closest('.rank-list')) {
      ev.preventDefault(); ACT.back();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Fit the 390 x 844 phone and the 1440 x 900 desktop frame to the stage. */
  function fit() {
    var stage = $('stage');
    if (!stage) return;
    var narrow = window.innerWidth <= 560;
    document.body.classList.toggle('is-narrow', narrow);
    var w = stage.clientWidth - 32, h = stage.clientHeight - 32;
    if (SS.state.device === 'mobile') {
      var s = narrow ? 1 : Math.min(1, h / 868, w / 414);
      document.documentElement.style.setProperty('--phone-scale', s.toFixed(4));
    } else {
      var ds = Math.min(1, w / 1440, Math.max(h, 400) / 900);
      if (narrow) ds = Math.min(1, (window.innerWidth - 16) / 1440);
      document.documentElement.style.setProperty('--desk-scale', ds.toFixed(4));
    }
  }
  window.addEventListener('resize', fit);

  /* Printing: copy one node into #printRoot so only it prints. */
  app.printNode = function (node) {
    if (!node) return;
    var root = $('printRoot');
    root.innerHTML = '';
    root.appendChild(node.cloneNode(true));
    document.body.classList.add('is-printing');
    try { window.print(); } catch (e) { /* not allowed here */ }
  };
  window.addEventListener('afterprint', function () { document.body.classList.remove('is-printing'); var r = $('printRoot'); if (r) r.innerHTML = ''; });
  window.addEventListener('beforeprint', function () {
    var r = $('printRoot');
    if (r && !r.innerHTML && SS.state.frame === 'DESK3') { var n = document.getElementById('weeklySheet'); if (n) { r.appendChild(n.cloneNode(true)); document.body.classList.add('is-printing'); } }
  });

  /* ------------------------------------------------------------------ */
  /* Boot */
  function boot() {
    var hash = '';
    try { hash = (location.hash || '').replace('#', ''); } catch (e) { /* ignore */ }
    if (hash && FRAME[hash]) app.jump(hash);
    else app.go('F01', { noHistory: true, dir: 'none' });
    fit();
  }
  window.addEventListener('hashchange', function () {
    var h = '';
    try { h = (location.hash || '').replace('#', ''); } catch (e) { return; }
    if (h && FRAME[h] && h !== currentFrameId()) app.jump(h);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.SS = window.SS || {});
