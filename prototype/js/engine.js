/* StackSense prototype: the rules engine.
 * answers -> signals -> stack -> Health Impact Map -> calendar.
 * Everything here is a pure function of SS.state, so any screen can ask
 * for the current picture and the review screen can recalculate live. */
(function (SS) {
  'use strict';

  var has = SS.has;

  /* ------------------------------------------------------------------ */
  /* Formatting and dates */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  var fmt = SS.fmt = {
    time24: function (m) { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ':' + pad(m % 60); },
    time12: function (m) {
      m = ((m % 1440) + 1440) % 1440;
      var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return h + ':' + pad(mm) + ' ' + ap;
    },
    date: function (d) { return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; },
    dateShort: function (d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; },
    month: function (d) { return MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear(); },
    monthShort: function (i) { return MONTHS[i]; },
    dayName: function (d) { return DAYS[d.getDay()]; },
    money: function (x) { return '$' + Math.round(x); },
    money2: function (x) { return '$' + x.toFixed(2); },
    pct: function (x) { return Math.round(x * 100) + '%'; },
    num: function (x) { return (Math.round(x * 10) / 10).toString(); },
    list: function (arr) {
      if (arr.length <= 1) return arr.join('');
      return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    }
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var dates = SS.dates = {
    add: function (d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; },
    key: function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    parse: function (k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); },
    same: function (a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); },
    index: function (d) { return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - SS.PLAN_START) / 86400000); },
    fromIndex: function (i) { return dates.add(SS.PLAN_START, i); },
    dayId: function (d) { return DAY_IDS[d.getDay()]; },
    DAY_IDS: DAY_IDS
  };

  /* ------------------------------------------------------------------ */
  /* Helpers on answers */
  SS.goalsOf = function (A) { return A && A.A1 && A.A1.ranked ? A.A1.ranked : []; };

  var SPOT_GROUPS = { knee: 'knee', hip: 'hip', ankle: 'ankle', shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', heel: 'heel', calf: 'calf', hamstring: 'hamstring', glute: 'glute' };
  function spotKinds(b8) {
    var kinds = {};
    ((b8 && b8.spots) || []).forEach(function (s) {
      var k = s.split('_')[0];
      kinds[k] = (kinds[k] || []).concat(s);
    });
    return kinds;
  }
  SS.spotsPlural = function (b8) {
    var kinds = spotKinds(b8), keys = Object.keys(kinds);
    if (keys.length !== 1) return 'joints';
    var k = keys[0], name = SPOT_GROUPS[k] || 'joint';
    if (k === 'neck' || k === 'upperback' || k === 'lowerback') return k === 'neck' ? 'neck' : 'back';
    return kinds[k].length > 1 ? name + 's' : (kinds[k][0].indexOf('_l') > 0 ? 'left ' : 'right ') + name;
  };
  SS.spotsLabel = function (b8) {
    var spots = (b8 && b8.spots) || [];
    if (!spots.length) return 'Nothing selected';
    var all = SS.BODY_SPOTS.front.concat(SS.BODY_SPOTS.back);
    var kinds = spotKinds(b8), parts = [];
    Object.keys(kinds).forEach(function (k) {
      if (kinds[k].length === 2) parts.push('Both ' + (SPOT_GROUPS[k] || k) + 's');
      else kinds[k].forEach(function (id) { var s = all.filter(function (x) { return x.id === id; })[0]; if (s) parts.push(s.label); });
    });
    return parts.join(', ');
  };

  var E = SS.engine = {};

  /** Committed, answered (not "Not sure") answers only. */
  E.answers = function (S) {
    var A = {};
    Object.keys(S.committed).forEach(function (id) {
      var a = S.answers[id];
      if (S.committed[id] && a && !a.notSure) A[id] = a;
    });
    return A;
  };

  E.pssScore = function (a) {
    if (!a || !a.items) return null;
    var items = SS.CARD.B11.items, s = 0;
    for (var i = 0; i < items.length; i++) {
      var v = a.items[i];
      if (v == null) return null;
      s += items[i].reverse ? 4 - v : v;
    }
    return s;
  };

  E.diet = function (A) { return A.B3 ? A.B3.pick : null; };
  E.isVeg = function (A) { var d = E.diet(A); return d === 'vegetarian' || d === 'vegan'; };

  var IRON_RANK = { raised: 1, high: 2, confirmed: 3 };
  var B2_TEXT = { breath: 'short of breath on stairs', cold: 'cold hands', hair: 'hair shedding', nails: 'brittle nails' };
  var HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  SS.ENERGY_HOURS = HOURS;

  function hourLabel(h) { return h === 12 ? 'noon' : (h % 12) + (h < 12 ? ' am' : ' pm'); }

  E.energyPattern = function (pts) {
    if (!pts) return null;
    var peakI = 1;
    for (var i = 1; i <= 3; i++) if (pts[i] > pts[peakI]) peakI = i;
    var dip = Math.min(pts[4], pts[5]);
    var mean = pts.reduce(function (a, b) { return a + b; }, 0) / pts.length;
    var parts = [];
    if (pts[0] <= 4) parts.push('low start');
    var crash = pts[peakI] - dip >= 3;
    if (crash) {
      parts.push('peak around ' + hourLabel(HOURS[peakI]));
      parts.push('crash 2–4 pm');
    } else if (mean < 4) parts.push('low all day');
    else parts.push('fairly steady');
    var txt = parts.join(', ');
    return { crash: crash, text: txt.charAt(0).toUpperCase() + txt.slice(1), lowAllDay: mean < 4 };
  };

  /* ------------------------------------------------------------------ */
  /* Signals */

  /** All signals the answers raise, before the user removes any on review. */
  E.signalsRaw = function (S) {
    var A = E.answers(S), sig = {}, stop = S.stopped || {};
    function add(id, card, text, extra) {
      var s = sig[id] || (sig[id] = { id: id, sources: [] });
      s.sources.push({ card: card, text: text });
      if (extra) {
        if (extra.level && (!s.level || IRON_RANK[extra.level] > IRON_RANK[s.level])) s.level = extra.level;
        Object.keys(extra).forEach(function (k) { if (k !== 'level') s[k] = extra[k]; });
      }
      return s;
    }

    /* Phase A: sleep */
    if (!stop.sleep) {
      if (has(A.A2, 'falling')) add('sleep_onset', 'A2', 'Falling asleep is the hardest part');
      if (has(A.A2, 'unrefreshed') && sig.sleep_onset) add('sleep_onset', 'A2', 'Waking unrefreshed');
      if (has(A.A3, 'racing')) {
        add('sleep_onset', 'A3', 'Racing thoughts when you lie down');
        add('stress_arousal', 'A3', 'Racing thoughts when you lie down');
      }
      if (A.A4 && A.A4.mins != null && A.A4.mins >= 14 * 60) add('caffeine_late', 'A4', 'Last caffeine at ' + fmt.time12(A.A4.mins), { mins: A.A4.mins });
    }
    if (has(A.A3, 'legs')) {
      var freq = (A.A3.follow && A.A3.follow.legsFreq) || 'Sometimes';
      if (freq !== 'Rarely') add('low_iron_risk', 'A3', 'Legs feel restless (' + freq.toLowerCase() + ')', { level: 'raised' });
    }

    /* Phase B: follow the signals */
    if (A.B1) {
      var pat = E.energyPattern(A.B1.points);
      if (pat && pat.crash) add('afternoon_crash', 'B1', pat.text);
    }
    if (A.B2) {
      var p = A.B2.picks || [];
      var syms = ['breath', 'cold', 'hair', 'nails'].filter(function (x) { return p.indexOf(x) >= 0; });
      if (syms.length) {
        var lvl = (syms.length >= 2 || sig.low_iron_risk) ? 'high' : 'raised';
        var t = syms.map(function (x) { return B2_TEXT[x]; }).join(', ');
        add('low_iron_risk', 'B2', t.charAt(0).toUpperCase() + t.slice(1), { level: lvl });
      }
      if (p.indexOf('hair') >= 0) add('hair_shedding', 'B2', 'More hair in the shower lately');
      if (p.indexOf('tingling') >= 0) add('b12_risk', 'B2', 'Tingling hands or feet');
      if (p.indexOf('wintermood') >= 0) add('vitamin_d_risk', 'B2', 'Low mood in winter');
    }
    if (A.B3 && (A.B3.pick === 'vegetarian' || A.B3.pick === 'vegan')) {
      var yrs = A.B3.follow && A.B3.follow.years;
      var dt = (A.B3.pick === 'vegan' ? 'Vegan' : 'Vegetarian') + (yrs ? ' for ' + yrs + (yrs === 1 ? ' year' : ' years') : '');
      add('b12_risk', 'B3', dt);
      add('omega3_gap', 'B3', dt);
      add('low_dietary_creatine', 'B3', dt);
    }
    if (sig.low_iron_risk && A.B5) {
      var opt = SS.CARD.B5.options.filter(function (o) { return o.id === A.B5.pick; })[0];
      if (opt && opt.level >= 3) add('low_iron_risk', 'B5', opt.label + ' periods', { level: 'high' });
    }
    if (sig.low_iron_risk && S.labs.ferritin == null && A.B7 && (A.B7.pick === 'notsure' || A.B7.pick === 'no')) {
      add('low_iron_risk', 'B7', A.B7.pick === 'no' ? 'No bloodwork in the last 12 months' : 'Not sure about recent bloodwork', { locked: true });
    }
    if (sig.low_iron_risk && S.labs.ferritin != null) {
      var f = S.labs.ferritin;
      if (f < 30) add('low_iron_risk', 'LAB', 'Ferritin ' + f + ' µg/L (low)', { level: 'confirmed', locked: false });
      else if (f < 50) add('low_iron_risk', 'LAB', 'Ferritin ' + f + ' µg/L (borderline)', { borderline: true, locked: false });
      else delete sig.low_iron_risk;
    }

    if (!stop.joints && A.B9) {
      var bp = A.B9.picks || [];
      var lasts = (A.B9.follow && A.B9.follow.lasts) || '';
      var trainingPattern = bp.indexOf('after') >= 0 || bp.indexOf('during') >= 0 || bp.indexOf('morning') >= 0;
      if (trainingPattern && bp.indexOf('swelling') < 0 && lasts !== 'Longer') {
        add('exercise_soreness', 'B8', SS.spotsLabel(A.B8));
        var when = bp.filter(function (x) { return x !== 'always'; }).map(function (x) {
          return SS.CARD.B9.options.filter(function (o) { return o.id === x; })[0].label.toLowerCase();
        }).join(', ');
        add('exercise_soreness', 'B9', when.charAt(0).toUpperCase() + when.slice(1) + (lasts ? '; ' + lasts.toLowerCase() : ''));
      }
    }
    if (A.B10 && (A.B10.runs >= 2 || A.B10.km >= 15)) {
      var ev = A.B10.hasEvent && A.B10.date ? '; ' + E.eventName(A.B10).toLowerCase() + ' on ' + fmt.dateShort(dates.parse(A.B10.date)) : '';
      add('endurance_load', 'B10', A.B10.runs + ' runs, ~' + A.B10.km + ' km a week' + ev, { runs: A.B10.runs });
    }
    var score = E.pssScore(A.B11);
    if (score != null && score > 8) {
      add('stress_moderate', 'B11', 'Stress score ' + score + ' of 16; main source: ' + (A.B11.source || 'not given').toLowerCase(), { score: score, source: A.B11.source });
    }
    if (A.B12 && (A.B12.pick === 'u15' || A.B12.pick === '15')) {
      add('vitamin_d_risk', 'B12', (A.B12.pick === 'u15' ? 'Under 15 min' : '15–30 min') + ' outside at midday; Toronto, 43.7° N in October');
    }

    /* Phase C: safety */
    var meds = (A.C1 && A.C1.meds) || [];
    var horm = meds.filter(function (id) { return SS.MED[id] && SS.MED[id].cls === 'hormonal'; });
    if (horm.length) add('med_contraceptive', 'C1', horm.map(function (id) { return SS.MED[id].name; }).join(', '));

    /* Decorate with labels, tags and the phrase used in "Why you" lines. */
    Object.keys(sig).forEach(function (id) {
      var s = sig[id], m = SS.SIGNAL_META[id];
      s.label = m.label; s.tag = m.tag; s.area = m.area;
      if (id === 'low_iron_risk') {
        if (s.level === 'confirmed') { s.tag = 'Low ferritin'; s.label = 'Low iron (ferritin confirmed)'; }
        else if (s.borderline) { s.tag = 'Ferritin borderline'; s.label = 'Borderline iron'; }
        else if (s.locked) { s.tag = 'Iron: test first'; s.label = 'Possible low iron · test first'; }
        else if (s.level === 'high') { s.tag = 'Low iron risk: high'; s.label = 'Low iron risk: high'; }
      }
      if (id === 'stress_moderate' && s.score >= 13) { s.label = 'High stress'; s.tag = 'High stress'; }
      s.phrase = phraseFor(id, s, A);
    });
    return sig;
  };

  function phraseFor(id, s, A) {
    switch (id) {
      case 'sleep_onset': return 'slow to fall asleep';
      case 'stress_arousal': return 'racing thoughts at night';
      case 'caffeine_late': return 'last caffeine at ' + fmt.time12(s.mins);
      case 'afternoon_crash': return 'tired in the afternoon';
      case 'low_iron_risk': return 'restless legs and breathless on stairs';
      case 'hair_shedding': return 'more hair in the shower';
      case 'b12_risk': case 'omega3_gap': case 'low_dietary_creatine':
        var y = A.B3 && A.B3.follow && A.B3.follow.years;
        return (A.B3 && A.B3.pick === 'vegan' ? 'vegan' : 'vegetarian') + (y ? ' ' + y + ' years' : '');
      case 'exercise_soreness': return 'sore ' + SS.spotsPlural(A.B8) + ' after long runs';
      case 'endurance_load': return 'running ' + s.runs + 'x a week';
      case 'stress_moderate': return 'stressed by ' + String(s.source || 'life').toLowerCase();
      case 'vitamin_d_risk': return 'under 15 min of daylight';
      case 'med_contraceptive': return 'on the pill';
    }
    return s.label.toLowerCase();
  }

  /** Signals after the user's removals on the review screen. */
  E.signals = function (S) {
    var sig = E.signalsRaw(S);
    Object.keys(S.removed).forEach(function (id) { if (S.removed[id]) delete sig[id]; });
    return sig;
  };

  E.eventName = function (b10) {
    return { '5k': '5K race', '10k': '10K race', half: 'Half-marathon', full: 'Marathon', other: 'Event' }[b10.eventType] || 'Event';
  };

  /* ------------------------------------------------------------------ */
  /* Flow: which card comes next */
  E.isShown = function (card, S) {
    if (S.stopped.sleep && (card.id === 'A3' || card.id === 'A4')) return false;
    if (S.labsEarly && (card.id === 'B7' || card.id === 'B5')) return false;
    if (!card.show) return true;
    return !!card.show(E.answers(S), E.signals(S));
  };

  E.nextCard = function (S, afterId) {
    var start = afterId ? SS.CARD[afterId].index + 1 : 0;
    for (var i = start; i < SS.CARDS.length; i++) {
      if (E.isShown(SS.CARDS[i], S)) return SS.CARDS[i].id;
    }
    return null;
  };

  /** Ring value: resolved weight. Skipped (not applicable) cards count as resolved; "Not sure" counts half. */
  E.confidence = function (S) {
    var last = -1;
    SS.CARDS.forEach(function (c, i) { if (S.committed[c.id]) last = i; });
    var total = 0;
    for (var i = 0; i <= last; i++) {
      var c = SS.CARDS[i], a = S.answers[c.id];
      if (S.committed[c.id]) total += a && a.notSure ? c.weight / 2 : c.weight;
      else total += c.weight;
    }
    return Math.min(99, Math.round(total));
  };

  E.notSureCount = function (S) {
    return SS.CARDS.filter(function (c) { return S.committed[c.id] && S.answers[c.id] && S.answers[c.id].notSure; }).length;
  };

  /** Branch toast after committing a card, if the answer opened a new path. */
  E.branchToast = function (cardId, before, after, S) {
    var A = E.answers(S);
    var GOAL_WORDS = { sleep: 'sleep', energy: 'energy', joints: 'joints & recovery', mood: 'mood', focus: 'focus', performance: 'training', skin: 'skin & hair', immunity: 'immunity', heart: 'heart health' };
    if (cardId === 'A1' && A.A1 && A.A1.ranked.length > 1) {
      var w = A.A1.ranked.map(function (g) { return GOAL_WORDS[g]; });
      return { text: 'We’ll start with ' + w[0] + ', then ' + w.slice(1).join(', then ') + '.', key: 'goals' };
    }
    if (cardId === 'A3' && after.low_iron_risk && !before.low_iron_risk) {
      return { text: 'Restless legs can be linked to iron. We’ll look into that.', key: 'iron', moment: 'iron', emphasis: 'Restless legs' };
    }
    if (cardId === 'B2' && after.low_iron_risk && after.low_iron_risk.level === 'high' && (!before.low_iron_risk || before.low_iron_risk.level !== 'high')) {
      return { text: 'These can all point to low iron. Iron risk is now high.', key: 'ironhigh' };
    }
    if (cardId === 'B3' && E.isVeg(A)) {
      return { text: 'Because you said <em>' + (A.B3.pick === 'vegan' ? 'vegan' : 'vegetarian') + '</em>, we’ll check B12 and iron next.', key: 'veg', html: true };
    }
    if (cardId === 'B7' && after.low_iron_risk && after.low_iron_risk.locked) {
      return { text: 'Iron needs a blood test first. We’ll prepare a note for your doctor.', key: 'ironlock' };
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* Products */
  E.products = function (suppId, S) {
    var A = E.answers(S), list = SS.PRODUCTS[suppId] || [];
    var veg = E.isVeg(A);
    var avoid = (A.C3 && A.C3.picks) || [];
    var powdersOk = !A.D2 || A.D2.powders !== false;
    var res = { best: null, alt: null, others: [], filtered: [], swapped: null, budgetPick: false };
    var ok = [];
    list.forEach(function (p) {
      var reason = null;
      if (p.filtered && !(p.id === 'gen-crecap' && !powdersOk)) reason = p.filtered;
      if (!reason && p.animal && veg) reason = 'Fish-derived; you told us you’re vegetarian';
      if (!reason && p.contains) {
        if (p.contains.indexOf('gelatin') >= 0 && avoid.indexOf('gelatin') >= 0) reason = 'Gelatin-based; you avoid gelatin';
        if (p.contains.indexOf('soy') >= 0 && avoid.indexOf('soy') >= 0) reason = 'Contains soy';
      }
      if (!reason && p.contains && p.contains.indexOf('gelatin') >= 0 && veg) reason = 'Gelatin-based; you told us you’re vegetarian';
      if (!reason && p.form === 'powder' && !powdersOk) reason = 'Powder; you said no powders';
      if (reason) res.filtered.push({ p: p, reason: reason }); else ok.push(p);
    });
    if (ok[0] && ok[0].unavailable) { res.swapped = ok[0]; ok = ok.slice(1); }
    res.best = ok[0] || null;
    res.alt = ok[1] || null;
    res.others = ok.slice(2);
    if (S.optim.budget[suppId] && res.alt && res.alt.price < res.best.price) {
      var b = res.best; res.best = res.alt; res.alt = b; res.budgetPick = true;
    }
    return res;
  };

  function dosesPerMonth(freq) {
    return { daily: 30.4, mwf: 13, alt: 15.2, cycle: 30.4 * 56 / 70 }[freq] || 30.4;
  }

  /* ------------------------------------------------------------------ */
  /* Needs and the stack */
  E.needs = function (S, sig) {
    var A = E.answers(S), need = {};
    SS.AREAS.forEach(function (a) { need[a.id] = 0; });
    SS.NEED_RULES.forEach(function (r) { if (sig[r.sig]) need[r.area] += r.v; });
    SS.goalsOf(A).forEach(function (g, i) {
      var area = SS.GOAL_AREA[g];
      if (area === 'sleep' && S.stopped.sleep) return;
      if (area === 'joints' && S.stopped.joints) return;
      need[area] += 2.5 * (SS.GOAL_WEIGHTS[i] || 0.5);
    });
    Object.keys(need).forEach(function (k) { need[k] = Math.min(10, need[k]); });
    return need;
  };

  var EVIDENCE_FACTOR = { Strong: 1, Moderate: 0.85, Emerging: 0.7 };

  function itemImpact(supp, need) {
    var v = 0;
    Object.keys(supp.contrib).forEach(function (a) { v += supp.contrib[a] * (need[a] || 0) / 10; });
    return v * (EVIDENCE_FACTOR[supp.evidence] || 0.8);
  }

  function whyLine(supp, sig) {
    var seen = {}, phrases = [];
    supp.support.forEach(function (id) {
      var s = sig[id];
      if (s && !seen[s.phrase]) { seen[s.phrase] = 1; phrases.push(s.phrase); }
    });
    return phrases.slice(0, 3);
  }

  E.ironStatus = function (S, sig) {
    var f = S.labs.ferritin;
    if (f != null) {
      if (f < 30) return sig.low_iron_risk ? 'dosed' : 'none';
      if (f < 50) return 'borderline';
      return 'normal';
    }
    return sig.low_iron_risk ? 'locked' : 'none';
  };

  /**
   * The full picture for the current answers: items, locked, excluded,
   * lifestyle tips, cost, pill load and optimizer suggestions.
   */
  E.stack = function (S, sig) {
    sig = sig || E.signals(S);
    var A = E.answers(S);
    var need = E.needs(S, sig);
    var veg = E.isVeg(A);
    var preg = A.B6 && A.B6.pick === 'yes';
    var cond = (A.C2 && A.C2.picks) || [];
    var medCls = ((A.C1 && A.C1.meds) || []).map(function (id) { return SS.MED[id] && SS.MED[id].cls; });
    var items = [], excluded = [], dropped = [], trimmed = [], tips = [];

    /* What the engine considered and removed, in the order the spec shows it. */
    if (veg && (sig.exercise_soreness || sig.hair_shedding || sig.endurance_load)) {
      excluded.push({ id: 'collagen', name: 'Collagen peptides', reason: 'Animal-derived; you told us you’re vegetarian.', card: 'B3', kind: 'diet', short: 'animal-derived' });
    }
    if ((sig.stress_moderate || sig.stress_arousal) && (medCls.indexOf('hormonal') >= 0 || medCls.indexOf('ssri') >= 0)) {
      var hormonal = medCls.indexOf('hormonal') >= 0;
      excluded.push({
        id: 'sjw', name: 'St John’s wort', kind: 'safety', card: 'C1',
        reason: hormonal ? 'Interacts with your birth control: it can make the pill less reliable.' : 'Interacts with your antidepressant.',
        short: hormonal ? 'interacts with your birth control' : 'interacts with your antidepressant'
      });
    }
    if (sig.sleep_onset && sig.stress_arousal) {
      excluded.push({ id: 'melatonin', name: 'Melatonin', reason: 'Your issue is racing thoughts, not body clock timing.', card: 'A3', kind: 'fit', short: 'your issue is racing thoughts, not timing', told: 'Racing thoughts when you lie down' });
    }

    function blockFor(id) {
      if (id === 'ashwagandha') {
        if (preg) return { reason: 'Not recommended in pregnancy or while breastfeeding.', card: 'B6' };
        if (cond.indexOf('thyroid') >= 0) return { reason: 'Can change thyroid hormone levels.', card: 'C2' };
        if (cond.indexOf('liverkidney') >= 0) return { reason: 'Rare liver injury reports; not advised with liver disease.', card: 'C2' };
        if (medCls.indexOf('thyroid') >= 0) return { reason: 'Can interfere with your thyroid medicine.', card: 'C1' };
        if (cond.indexOf('autoimmune') >= 0) return { reason: 'Can stimulate the immune system; check with your doctor first.', card: 'C2' };
      }
      if (id === 'curcumin') {
        if (cond.indexOf('gallstones') >= 0) return { reason: 'Can make gallstones worse.', card: 'C2' };
        if (cond.indexOf('bleeding') >= 0 || medCls.indexOf('thinner') >= 0) return { reason: 'Adds to the effect of blood thinners.', card: cond.indexOf('bleeding') >= 0 ? 'C2' : 'C1' };
        if (cond.indexOf('surgery') >= 0) return { reason: 'Stop at least 2 weeks before surgery (bleeding risk).', card: 'C2' };
      }
      if (id === 'creatine' && cond.indexOf('liverkidney') >= 0) return { reason: 'Not advised with kidney disease unless your doctor agrees.', card: 'C2' };
      return null;
    }

    function makeItem(supp) {
      var prod = E.products(supp.id, S);
      var p = prod.best;
      var units = p ? (p.units || (p.form === 'powder' ? 1 : supp.units)) : supp.units;
      if (p && p.id === 'gen-crecap') units = 5;
      var form = p ? p.form : supp.form;
      var monthly = p ? p.price * dosesPerMonth(supp.freq) : 0;
      return {
        id: supp.id, supp: supp, prod: prod, product: p, units: units, form: form,
        isPill: ['capsule', 'softgel', 'tablet'].indexOf(form) >= 0,
        monthly: monthly, impact: itemImpact(supp, need), why: whyLine(supp, sig),
        note: supp.id === 'omega3' && veg ? 'Algae, not fish oil: you told us you’re vegetarian.' : null
      };
    }

    SS.SUPP_ORDER.forEach(function (id) {
      var supp = SS.SUPPS[id];
      if (!supp.primary.some(function (x) { return !!sig[x]; })) return;
      var block = blockFor(id);
      if (block) { excluded.push({ id: id, name: supp.name, reason: block.reason, card: block.card, kind: 'safety', short: block.reason.replace(/\.$/, '').toLowerCase() }); return; }
      if (S.optim.dropped[id]) { dropped.push(makeItem(supp)); return; }
      items.push(makeItem(supp));
    });

    var iron = E.ironStatus(S, sig), locked = null;
    if (iron === 'dosed') items.push(makeItem(SS.SUPPS.iron));
    else if (iron === 'locked') locked = { id: 'iron', name: 'Iron', reason: 'Needs a blood test first', sources: sig.low_iron_risk.sources };
    else if (iron === 'borderline') excluded.push({ id: 'iron', name: 'Iron', reason: 'Ferritin ' + S.labs.ferritin + ' µg/L is borderline. Food first, then retest in 3 months.', card: 'LAB', kind: 'fit', short: 'borderline ferritin' });
    else if (iron === 'normal') excluded.push({ id: 'iron', name: 'Iron', reason: 'Your ferritin (' + S.labs.ferritin + ' µg/L) is normal, so iron would not help.', card: 'LAB', kind: 'fit', short: 'ferritin is normal' });

    items.sort(function (a, b) { return b.impact - a.impact; });

    var lowConfidence = E.notSureCount(S) >= 4;
    if (lowConfidence && items.length > 3) { trimmed = items.slice(3); items = items.slice(0, 3); }

    if (sig.caffeine_late) {
      var bed = E.slotTimes(S).bed, cut = bed - 8 * 60;
      if (sig.caffeine_late.mins > cut) {
        tips.push({ id: 'caffeine', area: 'sleep', title: 'Move your last coffee before ' + fmt.time12(cut), text: 'Caffeine needs about 8 hours to wear off. Your last one is at ' + fmt.time12(sig.caffeine_late.mins) + ' and you go to bed at ' + fmt.time24(bed) + '.', card: 'A4' });
      }
    }
    if (has(A.A3, 'phone')) tips.push({ id: 'phone', area: 'sleep', title: 'Phone away at wind-down', text: 'Your magnesium reminder doubles as a phone-down cue 90 minutes before bed.', card: 'A3' });

    var monthly = items.reduce(function (s, it) { return s + it.monthly; }, 0);
    var budget = A.D1 ? A.D1.amount : null;

    /* Pill load per weekday */
    var pillsByDay = [0, 0, 0, 0, 0, 0, 0], scoopsByDay = [0, 0, 0, 0, 0, 0, 0];
    items.forEach(function (it) {
      for (var d = 0; d < 7; d++) {
        if (it.supp.freq === 'mwf' && [1, 3, 5].indexOf(d) < 0) continue;
        if (it.isPill) pillsByDay[d] += it.units;
        else if (it.form === 'powder') scoopsByDay[d] += 1;
      }
    });
    var busiest = 0;
    for (var d = 1; d < 7; d++) if (pillsByDay[d] > pillsByDay[busiest]) busiest = d;
    var maxPills = pillsByDay[busiest], scoops = scoopsByDay[busiest];
    var pillLimit = A.D2 ? A.D2.max : null;

    /* Optimizer suggestions when over budget */
    var optimizer = null;
    if (budget != null && monthly > budget + 0.01 && items.length) {
      var low = items.slice().sort(function (a, b) { return a.impact / Math.max(a.monthly, 1) - b.impact / Math.max(b.monthly, 1); })[0];
      var swaps = items.filter(function (it) { return it.prod.alt && it.prod.alt.price < it.product.price && !it.prod.budgetPick; })
        .map(function (it) { return { id: it.id, save: (it.product.price - it.prod.alt.price) * dosesPerMonth(it.supp.freq) }; })
        .sort(function (a, b) { return b.save - a.save; }).slice(0, 3);
      optimizer = {
        over: monthly - budget,
        drop: { id: low.id, name: low.supp.short, save: low.monthly },
        swap: swaps.length ? { ids: swaps.map(function (s) { return s.id; }), save: swaps.reduce(function (s, x) { return s + x.save; }, 0) } : null
      };
    }

    return {
      items: items, locked: locked, excluded: excluded, dropped: dropped, trimmed: trimmed, tips: tips,
      monthly: monthly, budget: budget, maxPills: maxPills, scoops: scoops, busiestDay: busiest, pillLimit: pillLimit,
      lowConfidence: lowConfidence, optimizer: optimizer, need: need, iron: iron, pregnancy: !!preg,
      interactionsChecked: items.length * (items.length - 1) / 2 + items.length * ((A.C1 && A.C1.meds) || []).length
    };
  };

  /* ------------------------------------------------------------------ */
  /* Health Impact Map */
  E.impact = function (S, sig, stack) {
    sig = sig || E.signals(S);
    stack = stack || E.stack(S, sig);
    var need = stack.need;
    var areas = SS.AREAS.map(function (a) {
      var contributions = [], supply = 0;
      stack.items.forEach(function (it) {
        var v = it.supp.contrib[a.id] || 0;
        if (v > 0) { contributions.push({ id: it.id, v: v, supp: it.supp }); supply += v; }
      });
      var n = need[a.id];
      return { id: a.id, area: a, need: n, supply: supply, coverage: n > 0 ? Math.min(1, supply / n) : null, contributions: contributions };
    });
    var active = areas.filter(function (x) { return x.need > 0; });
    var met = active.filter(function (x) { return x.coverage >= 2 / 3 - 0.001; }).length;
    var gaps = active.filter(function (x) { return x.coverage < 0.5; }).map(function (x) {
      var reason = '';
      if ((x.id === 'skin' || x.id === 'energy') && stack.iron === 'locked') reason = 'Likely iron-related; unlocks after a ferritin test';
      else if (x.contributions.length === 0) reason = 'Nothing in your stack targets this yet';
      else reason = 'Partly covered; lifestyle changes matter most here';
      return { id: x.id, coverage: x.coverage, reason: reason };
    });
    return { areas: areas, active: active, met: met, gaps: gaps };
  };

  /* ------------------------------------------------------------------ */
  /* Calendar */
  E.slotTimes = function (S) {
    var d = (S.committed.D3 && S.answers.D3 && !S.answers.D3.notSure) ? S.answers.D3 : SS.CARD.D3.maya;
    return { wake: d.wake, breakfast: d.breakfast, lunch: d.lunch, dinner: d.dinner, bed: d.bed, winddown: d.bed - 90, runDays: d.runDays || [] };
  };

  SS.SLOTS = [
    { id: 'breakfast', label: 'Breakfast', icon: 'sun' },
    { id: 'lunch', label: 'Lunch', icon: 'meal' },
    { id: 'dinner', label: 'Dinner', icon: 'meal' },
    { id: 'winddown', label: 'Wind-down', icon: 'moon' }
  ];

  function itemActive(it, idx) {
    var s = it.supp, rel = idx - s.rampDay;
    if (rel < 0) return { on: false };
    var d = dates.fromIndex(idx).getDay();
    if (s.freq === 'mwf' && [1, 3, 5].indexOf(d) < 0) return { on: false };
    if (s.freq === 'alt' && rel % 2 !== 0) return { on: false };
    if (s.freq === 'cycle' && rel % 70 >= 56) {
      var restart = dates.fromIndex(idx - (rel % 70) + 70);
      return { on: true, off: true, offReason: 'Off-week (8 weeks on, 2 off). Restarts ' + fmt.date(restart) + '.' };
    }
    return { on: true, isNew: rel <= 2, startedToday: rel === 0 };
  }

  E.dayPlan = function (S, stack, date) {
    var idx = dates.index(date), times = E.slotTimes(S);
    var isRun = times.runDays.indexOf(dates.dayId(date)) >= 0;
    var A = E.answers(S);
    var slots = SS.SLOTS.map(function (sl) {
      var items = [];
      if (idx >= 0) stack.items.forEach(function (it) {
        if (it.supp.slot !== sl.id) return;
        var st = itemActive(it, idx);
        if (!st.on) return;
        items.push({ it: it, off: !!st.off, offReason: st.offReason, isNew: !!st.isNew, startedToday: !!st.startedToday, runNote: isRun && it.supp.runCue ? it.supp.runCue : null });
      });
      var cues = [];
      items.forEach(function (x) { if (!x.off && x.it.supp.cue && cues.indexOf(x.it.supp.cue) < 0 && x.it.supp.freq !== 'mwf') cues.push(x.it.supp.cue); });
      if (sl.id === 'breakfast') cues = cues.filter(function (c) { return c.indexOf('D3') >= 0; });
      return { id: sl.id, label: sl.label, icon: sl.icon, time: times[sl.id], items: items, cue: cues[0] || '' };
    }).filter(function (sl) { return sl.items.length > 0; });

    var events = [];
    if (idx === 2 && stack.iron === 'locked') events.push({ type: 'test', title: 'Book a ferritin + B12 blood test', sub: 'Doctor-request note attached' });
    if ([14, 28, 56].indexOf(idx) >= 0) events.push({ type: 'rescore', title: '60-second re-score', sub: 'Sleep, energy and knees' });
    if (A.B10 && A.B10.hasEvent && A.B10.date && dates.same(dates.parse(A.B10.date), date)) {
      events.push({ type: 'race', title: E.eventName(A.B10) + ' day', sub: 'Nothing new today. Keep your usual routine.' });
    }
    stack.items.forEach(function (it) {
      var rel = idx - it.supp.rampDay;
      if (rel === 0) events.push({ type: 'new', title: 'Start ' + it.supp.short, sub: 'New this week', supp: it.id });
      if (it.supp.freq === 'cycle' && rel > 0 && rel % 70 === 56) events.push({ type: 'off', title: it.supp.short + ' off-weeks start', sub: 'Restarts ' + fmt.date(dates.fromIndex(idx + 14)), supp: it.id });
      if (it.supp.freq === 'cycle' && rel > 0 && rel % 70 === 0) events.push({ type: 'new', title: it.supp.short + ' restarts', sub: 'Back on for 8 weeks', supp: it.id });
    });
    E.refills(S, stack).forEach(function (r) {
      if (r.remindIdx === idx) events.push({ type: 'refill', title: 'Refill ' + r.supp.short, sub: 'Runs out ' + fmt.date(r.runOut), supp: r.id, link: r.link });
    });
    return { date: date, key: dates.key(date), idx: idx, isRun: isRun, slots: slots, events: events };
  };

  /** When each container runs out, from bottle counts and doses. */
  E.refills = function (S, stack) {
    var out = [];
    stack.items.forEach(function (it) {
      if (!it.product) return;
      var servings = it.product.servings, used = 0;
      for (var idx = it.supp.rampDay; idx < it.supp.rampDay + 400; idx++) {
        var st = itemActive(it, idx);
        if (st.on && !st.off) used++;
        if (used >= servings) {
          var runOut = dates.fromIndex(idx + 1);
          out.push({ id: it.id, supp: it.supp, runOut: runOut, remindIdx: idx + 1 - 5, link: it.product.link });
          break;
        }
      }
    });
    return out;
  };

  E.dayProgress = function (S, plan) {
    var taken = S.taken[plan.key] || {}, total = 0, done = 0;
    plan.slots.forEach(function (sl) {
      if (sl.items.every(function (x) { return x.off; })) return;
      total++;
      if (taken[sl.id]) done++;
    });
    return { done: done, total: total };
  };

  E.streak = function (S, stack, today) {
    var n = 0, d = today;
    var p = E.dayPlan(S, stack, d), pr = E.dayProgress(S, p);
    if (!(pr.total && pr.done === pr.total)) d = dates.add(d, -1);
    for (var i = 0; i < 400; i++) {
      if (dates.index(d) < 0) break;
      var plan = E.dayPlan(S, stack, d), prog = E.dayProgress(S, plan);
      if (prog.total === 0 || prog.done < prog.total) break;
      n++;
      d = dates.add(d, -1);
    }
    return n;
  };

  /** Mark every slot taken from the plan start up to (not including) the demo day. One missed lunch keeps it real. */
  E.seedTaken = function (S) {
    S.taken = {};
    for (var i = 0; i < dates.index(SS.DEMO_TODAY); i++) {
      var k = dates.key(dates.fromIndex(i));
      S.taken[k] = { breakfast: true, lunch: true, dinner: true, winddown: true };
    }
    if (S.taken['2026-10-06']) S.taken['2026-10-06'].lunch = false;
  };

  /* ------------------------------------------------------------------ */
  /* Exports */
  function icsDate(d, mins) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(Math.floor(mins / 60)) + pad(mins % 60) + '00';
  }
  function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }

  E.ics = function (S, stack) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StackSense//Prototype//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:StackSense plan', 'X-WR-TIMEZONE:America/Toronto'];
    var uid = 0;
    function ev(start, mins, dur, title, desc, rrule) {
      lines.push('BEGIN:VEVENT', 'UID:stacksense-' + (++uid) + '@prototype', 'DTSTAMP:20261004T120000Z',
        'DTSTART;TZID=America/Toronto:' + icsDate(start, mins), 'DTEND;TZID=America/Toronto:' + icsDate(start, mins + dur),
        'SUMMARY:' + icsEsc(title));
      if (desc) lines.push('DESCRIPTION:' + icsEsc(desc));
      if (rrule) lines.push('RRULE:' + rrule);
      lines.push('END:VEVENT');
    }
    var times = E.slotTimes(S);
    SS.SLOTS.forEach(function (sl) {
      if (S.reminders[sl.id] === false) return;
      stack.items.filter(function (it) { return it.supp.slot === sl.id; }).forEach(function (it) {
        var start = dates.fromIndex(it.supp.rampDay);
        var rule = it.supp.freq === 'mwf' ? 'FREQ=WEEKLY;BYDAY=MO,WE,FR' : it.supp.freq === 'alt' ? 'FREQ=DAILY;INTERVAL=2' : 'FREQ=DAILY';
        if (it.supp.freq === 'cycle') rule = 'FREQ=DAILY;COUNT=56';
        ev(start, times[sl.id], 10, sl.label + ': ' + it.supp.short + ' (' + it.supp.amount + ')', it.supp.cue, rule);
      });
    });
    for (var i = 0; i < 90; i++) {
      var d = dates.fromIndex(i), plan = E.dayPlan(S, stack, d);
      plan.events.forEach(function (e) {
        if (e.type === 'new' || e.type === 'off') return;
        if (e.type === 'refill' && S.reminders.refills === false) return;
        if (e.type === 'rescore' && S.reminders.rescore === false) return;
        ev(d, 9 * 60, 15, e.title, e.sub);
      });
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  E.doctorNote = function (S, sig, stack) {
    var A = E.answers(S);
    var lines = [];
    lines.push('Patient: ' + SS.PERSONA.name + ', ' + SS.PERSONA.age + ', ' + SS.PERSONA.sex);
    lines.push('Prepared by StackSense on ' + fmt.date(new Date(2026, 9, 4)) + ' from a self-reported intake. Not a diagnosis.');
    lines.push('');
    lines.push('Request: ferritin, CBC and vitamin B12 testing.');
    lines.push('');
    lines.push('Why: answers that suggest possible low iron');
    var iron = sig.low_iron_risk;
    if (iron) iron.sources.forEach(function (s) { lines.push('  - ' + s.text); });
    if (sig.b12_risk) lines.push('  - ' + sig.b12_risk.sources[0].text + ' (B12 risk)');
    lines.push('');
    lines.push('Current medication: ' + (((A.C1 && A.C1.meds) || []).map(function (id) { return SS.MED[id].name; }).join(', ') || 'none reported'));
    lines.push('');
    lines.push('Supplements planned (starting ' + fmt.date(SS.PLAN_START) + '):');
    stack.items.forEach(function (it) { lines.push('  - ' + it.supp.name + ' ' + it.supp.dose + ', ' + it.supp.when.toLowerCase()); });
    lines.push('Iron is on hold until a ferritin result is available.');
    return lines.join('\n');
  };
})(window.SS = window.SS || {});
