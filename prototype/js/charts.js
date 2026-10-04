/* StackSense prototype: charts (radar, stacked bars, rings), all hand-built SVG/HTML. */
(function (SS) {
  'use strict';

  var C = SS.charts = {};
  var esc = function (s) { return SS.ui.esc(s); };

  function polar(cx, cy, r, deg) {
    var a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  C.arcPath = arcPath;

  /* ------------------------------------------------------------------ */
  /* Radar: dashed "Your need" outline, filled "Stack coverage". */
  C.radarGeom = function (size) {
    var w = size || 360, h = Math.round(w * 0.92);
    return { w: w, h: h, cx: w / 2, cy: h / 2 + 2, R: w * 0.3 };
  };

  C.radarPoints = function (g, values) {
    return values.map(function (v, i) {
      var p = polar(g.cx, g.cy, g.R * Math.min(10, Math.max(0, v)) / 10, -90 + i * 45);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
  };

  C.radar = function (impact, opts) {
    opts = opts || {};
    var g = C.radarGeom(opts.size);
    var areas = impact.areas;
    var need = areas.map(function (a) { return a.need; });
    var cov = areas.map(function (a) { return opts.empty ? 0 : Math.min(10, a.supply); });
    var out = [];
    out.push('<svg class="radar" viewBox="0 0 ' + g.w + ' ' + g.h + '" role="img" aria-label="Radar chart of need and stack coverage across eight body areas">');
    /* grid rings at 2.5 / 5 / 7.5 / 10 */
    out.push('<g class="radar-grid">');
    [2.5, 5, 7.5, 10].forEach(function (v) {
      out.push('<polygon points="' + C.radarPoints(g, [v, v, v, v, v, v, v, v]) + '" fill="none"/>');
    });
    for (var i = 0; i < 8; i++) {
      var p = polar(g.cx, g.cy, g.R, -90 + i * 45);
      out.push('<line x1="' + g.cx + '" y1="' + g.cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>');
    }
    out.push('</g>');
    out.push('<polygon class="radar-cov" points="' + C.radarPoints(g, cov) + '"/>');
    out.push('<polygon class="radar-need" points="' + C.radarPoints(g, need) + '"/>');
    out.push('<g class="radar-dots">');
    areas.forEach(function (a, i) {
      var p = polar(g.cx, g.cy, g.R * cov[i] / 10, -90 + i * 45);
      out.push('<circle data-i="' + i + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="' + a.area.color + '"' + (a.need > 0 ? '' : ' opacity="0"') + '/>');
    });
    out.push('</g>');
    /* labels */
    out.push('<g class="radar-labels">');
    areas.forEach(function (a, i) {
      var ang = -90 + i * 45;
      var p = polar(g.cx, g.cy, g.R + (opts.size && opts.size > 400 ? 34 : 24), ang);
      var anchor = Math.abs(Math.cos(ang * Math.PI / 180)) < 0.2 ? 'middle' : (Math.cos(ang * Math.PI / 180) > 0 ? 'start' : 'end');
      var dy = Math.sin(ang * Math.PI / 180) < -0.9 ? -8 : (Math.sin(ang * Math.PI / 180) > 0.9 ? 10 : 0);
      var pct = a.need > 0 ? SS.fmt.pct(a.coverage) : 'no need';
      var gap = a.need > 0 && a.coverage < 0.5;
      out.push('<g class="radar-label' + (gap ? ' is-gap' : '') + (a.need > 0 ? '' : ' is-idle') + '" data-act="area" data-arg="' + a.id + '" tabindex="0" role="button" aria-label="' + esc(a.area.name) + ', ' + pct + ' covered">' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '" text-anchor="' + anchor + '">' +
        '<tspan class="rl-name">' + esc(a.area.short) + '</tspan>' +
        '<tspan class="rl-val" x="' + p[0].toFixed(1) + '" dy="14" data-i="' + i + '">' + pct + '</tspan></text></g>');
    });
    out.push('</g>');
    /* tap wedges */
    out.push('<g class="radar-hits">');
    areas.forEach(function (a, i) {
      var ang = -90 + i * 45;
      var p0 = polar(g.cx, g.cy, g.R + 12, ang - 22.5), p1 = polar(g.cx, g.cy, g.R + 12, ang + 22.5);
      out.push('<path data-act="area" data-arg="' + a.id + '" d="M' + g.cx + ' ' + g.cy + ' L' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' A' + (g.R + 12) + ' ' + (g.R + 12) + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' Z" fill="transparent"/>');
    });
    out.push('</g></svg>');
    return out.join('');
  };

  /** Grow the coverage shape supplement by supplement (1.2 s total). */
  C.animateRadar = function (svg, impact, items, opts, onStep) {
    if (!svg) return;
    var g = C.radarGeom(opts && opts.size);
    var poly = svg.querySelector('.radar-cov');
    var dots = svg.querySelectorAll('.radar-dots circle');
    var vals = svg.querySelectorAll('.rl-val');
    var areaIds = impact.areas.map(function (a) { return a.id; });
    var steps = [areaIds.map(function () { return 0; })];
    var acc = areaIds.map(function () { return 0; });
    items.forEach(function (it) {
      acc = acc.map(function (v, i) { return v + (it.supp.contrib[areaIds[i]] || 0); });
      steps.push(acc.slice());
    });
    function draw(values) {
      var capped = values.map(function (v) { return Math.min(10, v); });
      poly.setAttribute('points', C.radarPoints(g, capped));
      dots.forEach(function (d, i) {
        var p = polar(g.cx, g.cy, g.R * capped[i] / 10, -90 + i * 45);
        d.setAttribute('cx', p[0].toFixed(1)); d.setAttribute('cy', p[1].toFixed(1));
      });
      vals.forEach(function (t, i) {
        var a = impact.areas[i];
        if (a.need > 0) t.textContent = SS.fmt.pct(Math.min(1, values[i] / a.need));
      });
    }
    if (SS.reducedMotion() || items.length === 0) { draw(steps[steps.length - 1]); if (onStep) onStep(null); return; }
    var per = 1200 / items.length, t0 = null, token = {};
    svg.__anim = token;
    function frame(ts) {
      if (svg.__anim !== token) return;
      if (t0 == null) t0 = ts;
      var el = ts - t0, k = Math.min(items.length - 1, Math.floor(el / per)), f = Math.min(1, (el - k * per) / per);
      var e = 1 - Math.pow(1 - f, 3);
      var from = steps[k], to = steps[k + 1];
      draw(from.map(function (v, i) { return v + (to[i] - v) * e; }));
      if (onStep) onStep(items[k]);
      if (el < 1200) requestAnimationFrame(frame);
      else { draw(steps[steps.length - 1]); if (onStep) onStep(null); }
    }
    draw(steps[0]);
    requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------------------ */
  /* Stacked bars: who contributes what, with a "need" marker per area. */
  C.bars = function (impact, items, opts) {
    opts = opts || {};
    var rows = impact.areas.filter(function (a) { return a.need > 0; });
    var order = SS.SUPP_ORDER.concat(['iron']);
    var out = ['<div class="bars' + (opts.wide ? ' bars-wide' : '') + (opts.animate ? ' is-animating' : '') + '">'];
    rows.forEach(function (a) {
      var gap = a.coverage < 0.5;
      var segs = a.contributions.slice().sort(function (x, y) { return order.indexOf(x.id) - order.indexOf(y.id); });
      var segHtml = segs.map(function (c, i) {
        var w = Math.min(c.v, 10) * 10;
        return '<span class="seg" style="width:' + w + '%;background:' + c.supp.color + ';--d:' + (order.indexOf(c.id) * 140) + 'ms" data-tip="' + esc(c.supp.short) + ' · +' + SS.fmt.num(c.v) + '"' + (i === segs.length - 1 ? ' data-last="1"' : '') + '></span>';
      }).join('');
      out.push(
        '<button type="button" class="bar-row' + (gap ? ' is-gap' : '') + '" data-act="area" data-arg="' + a.id + '">' +
        '<span class="bar-head"><span class="area-dot" style="background:' + a.area.color + '"></span>' +
        '<span class="bar-name">' + esc(a.area.name) + '</span>' +
        '<span class="bar-pct">' + SS.fmt.pct(a.coverage) + ' covered</span></span>' +
        '<span class="bar-track"><span class="bar-fill">' + segHtml + '</span>' +
        '<span class="bar-need" style="left:' + (Math.min(a.need, 10) * 10) + '%" title="Need ' + SS.fmt.num(a.need) + '"></span>' +
        '<span class="bar-pct-at" style="left:' + (Math.min(Math.max(a.need, a.supply), 10) * 10) + '%">' + SS.fmt.pct(a.coverage) + ' covered</span></span>' +
        '</button>');
    });
    out.push('<div class="bar-axis" aria-hidden="true"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span></div>');
    out.push('<p class="bar-axis-label">Projected benefit score (0 = none, 10 = fully addressed)</p>');
    out.push('</div>');
    return out.join('');
  };

  /** Colour follows the supplement, so charts always list them in one fixed order. */
  C.inChartOrder = function (items) {
    var order = SS.SUPP_ORDER.concat(['iron']);
    return items.slice().sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
  };

  C.barsLegend = function (items) {
    return '<div class="legend">' + C.inChartOrder(items).map(function (it) {
      return '<span class="legend-item"><span class="legend-sw" style="background:' + it.supp.color + '"></span>' + esc(it.supp.short) + '</span>';
    }).join('') + '<span class="legend-item"><span class="legend-need"></span>Need from your answers</span></div>';
  };

  C.radarLegend = function () {
    return '<div class="legend"><span class="legend-item"><span class="legend-dash"></span>Your need</span>' +
      '<span class="legend-item"><span class="legend-fill"></span>Stack coverage</span></div>';
  };

  /** Shared hover/focus tooltip for bar segments inside `root`. */
  C.bindTips = function (root) {
    if (!root) return;
    var tip = root.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; root.appendChild(tip); }
    root.addEventListener('pointerover', function (e) {
      var seg = e.target.closest && e.target.closest('[data-tip]');
      if (!seg || !root.contains(seg)) { tip.hidden = true; return; }
      tip.textContent = seg.getAttribute('data-tip');
      tip.hidden = false;
      var r = seg.getBoundingClientRect(), rr = root.getBoundingClientRect();
      var scale = rr.width / root.offsetWidth || 1;
      tip.style.left = ((r.left + r.width / 2 - rr.left) / scale) + 'px';
      tip.style.top = ((r.top - rr.top) / scale - 6) + 'px';
    });
    root.addEventListener('pointerleave', function () { tip.hidden = true; });
  };

  /* ------------------------------------------------------------------ */
  /* Rings */
  C.confidenceRing = function (pct, size) {
    var s = size || 44, r = s / 2 - 4, c = 2 * Math.PI * r;
    return '<svg class="conf-ring" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" class="ring-track"/>' +
      '<circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r + '" class="ring-fill" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct / 100)).toFixed(1) + '" transform="rotate(-90 ' + s / 2 + ' ' + s / 2 + ')"/>' +
      '<text x="50%" y="50%" dy="0.35em" text-anchor="middle">' + pct + '</text></svg>';
  };

  /** A ring split into one arc per slot; filled arcs are taken. */
  C.dayRing = function (segments, size, opts) {
    opts = opts || {};
    var s = size || 40, cx = s / 2, r = s / 2 - (opts.stroke || 4) / 2 - 1, n = segments.length;
    var out = ['<svg class="day-ring" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">'];
    if (n === 0) {
      out.push('<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" class="dr-empty" stroke-width="' + (opts.stroke || 4) + '"/>');
    } else {
      var gapDeg = n > 1 ? 14 : 0, span = 360 / n;
      segments.forEach(function (seg, i) {
        var a0 = -90 + i * span + gapDeg / 2, a1 = -90 + (i + 1) * span - gapDeg / 2;
        if (n === 1) { a0 = -90; a1 = 269.9; }
        out.push('<path d="' + arcPath(cx, cx, r, a0, a1) + '" class="dr-seg ' + (seg === 'done' ? 'is-done' : seg === 'off' ? 'is-off' : seg === 'miss' ? 'is-miss' : '') + '" stroke-width="' + (opts.stroke || 4) + '"/>');
      });
    }
    if (opts.label != null) out.push('<text x="50%" y="50%" dy="0.35em" text-anchor="middle">' + opts.label + '</text>');
    out.push('</svg>');
    return out.join('');
  };

  /** Energy curve path through the 9 control points (Catmull-Rom to Bézier). */
  C.smoothPath = function (pts) {
    if (pts.length < 2) return '';
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d;
  };
})(window.SS = window.SS || {});
