// Token Radar v4 dashboard. Data comes from data.js (written by main.ts).
// Farm steps are rendered from one template using each row's own chains and
// category — the same template main.ts uses for board.json, so the page and
// the board file always agree.
(function () {
  var M = window.RADAR_MODEL || {};
  var ROWS = window.RADAR_ROWS || [];
  var COMPS = window.RADAR_COMPS || [];
  var $ = function (id) { return document.getElementById(id); };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(c) { return c === null || c === undefined ? '—' : (c > 0 ? '+' : '') + c.toFixed(1) + '%'; }
  function days(d) { return d === null || d === undefined ? '—' : d + 'd'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Columns: 0 rank, 1 slug, 2 name, 3 category, 4 chains, 5 tvl, 6 chg, 7 implied,
  // 8 lo, 9 hi, 10 slice, 11 net, 12 perHour, 13 verdict, 14 watchlist, 15 days.
  $('meta').textContent = M.board_rows + ' protocols ranked · watchlist ' + M.watchlist_covered +
    '/40 covered · snapshot ' + M.as_of + ' · verdicts FARM ' + M.verdicts.farm +
    ' / THIN ' + M.verdicts.thin + ' / SKIP ' + M.verdicts.skip;
  $('formula').textContent = 'Implied value = 10^(' + M.curve_a + ' + ' + M.curve_b +
    ' × log10 TVL) × category effect × (1 + 0.5 × 7-day change, clamped 0.60–1.60) × (1 + 3% per extra chain, max 4). ' +
    'Curve fitted on ' + M.comps_n + ' traded comps from this snapshot; the flat median multiple on the same comps is ' +
    M.flat_multiple + '× TVL. Category effects are shrunk toward zero with 4 pseudo-comps; categories with fewer than 2 traded comps get none.';
  $('validation').textContent = 'Out-of-sample, leave-one-out median miss ×' + M.loo_median_miss +
    ' (within 3×: ' + Math.round(M.loo_within_3x * 100) + '%) against ×' + M.loo_flat_median_miss +
    ' (' + Math.round(M.loo_flat_within_3x * 100) + '%) for one flat multiple. Time split — fit on listings before 2024 (' +
    M.split_train_n + ' comps), tested on ' + M.split_test_n + ' listings from 2024: curve ×' +
    M.split_curve_median_miss + ' vs flat ×' + M.split_flat_median_miss + '. Bands are P25–P75 of the leave-one-out ' +
    'residuals (×' + M.band_lo_factor + ' to ×' + M.band_hi_factor + ' around the point value).';

  var top5 = ROWS.slice(0, 5).map(function (r) {
    return '<div class="card"><b>#' + r[0] + ' ' + esc(r[2]) + '</b><span class="v">' + money(r[7]) +
      '</span><small>band ' + money(r[8]) + ' – ' + money(r[9]) + ' · ' + esc(r[3] || 'no category') +
      ' · ' + esc(r[13]) + '</small></div>';
  }).join('');
  $('top5').innerHTML = top5;

  var cats = [];
  ROWS.forEach(function (r) { if (r[3] && cats.indexOf(r[3]) < 0) cats.push(r[3]); });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option'); o.textContent = c; $('cat').appendChild(o);
  });

  function stepsFor(r) {
    var first = (r[4] && r[4][0]) || 'its main chain';
    var second = (r[4] && r[4][1]) || first;
    var cat = (r[3] || 'protocol').toLowerCase();
    return [
      'Bridge $1000 to ' + first + ' and hold it in a wallet you control, so the funds are ready to use on ' + r[2] + ' without a second bridge.',
      'Deposit the $1000 into ' + r[2] + ' on ' + first + ' through its ' + cat + ' pools, keeping the position open for the full 90-day farm.',
      'Use the position at least weekly on ' + r[2] + ': add or adjust a small amount each week so the activity is steady rather than a single deposit.',
      'If ' + r[2] + ' runs on a second chain, repeat a smaller deposit on ' + second + ' as well, since activity on more than one chain is part of how this farm is read.',
      'Track the position weekly, note any points or quests ' + r[2] + ' announces, and exit only after the 90-day window, because leaving early cuts the farm short.'
    ];
  }

  function showDetail(r) {
    var lo = Math.log10(r[8]), hi = Math.log10(r[9]), v = Math.log10(r[7]);
    var left = ((v - lo) / (hi - lo)) * 100;
    var steps = stepsFor(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<h3>#' + r[0] + ' ' + esc(r[2]) + ' <span class="badge ' + r[13] + '">' + r[13] + '</span></h3>' +
      '<p class="muted">' + esc(r[3] || 'no category') + ' · TVL ' + money(r[5]) + ' · 7-day ' + pct(r[6]) +
      ' · ' + (r[4] || []).join(', ') + ' · no token for ' + days(r[15]) + (r[14] ? ' · on the watchlist' : '') + '</p>' +
      '<div class="bar"><i style="left:0;width:100%"></i><b style="left:calc(' + left.toFixed(1) + '% - 1px)"></b></div>' +
      '<p>Implied value <b>' + money(r[7]) + '</b> — band ' + money(r[8]) + ' to ' + money(r[9]) +
      ' (P25–P75 of leave-one-out residuals).</p>' +
      '<div class="kv"><div><small>$1,000 slice</small><b>' + money(r[10]) + '</b></div>' +
      '<div><small>Net of all costs</small><b>' + money(r[11]) + '</b></div>' +
      '<div><small>Net per hands-on hour</small><b>$' + r[12].toFixed(2) + '</b></div>' +
      '<div><small>Costs</small><b>$' + (r[10] - r[11]).toFixed(2) + '</b></div></div>' +
      '<h4>How to farm it</h4><ol class="steps">' + steps + '</ol>';
    document.querySelectorAll('#board tbody tr').forEach(function (tr) {
      tr.classList.toggle('sel', tr.dataset.slug === r[1]);
    });
  }

  function render() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, ver = $('verdict').value, watch = $('watch').checked, sort = $('sort').value;
    var list = ROWS.filter(function (r) {
      if (q && (r[2].toLowerCase().indexOf(q) < 0 && r[1].toLowerCase().indexOf(q) < 0 && String(r[3] || '').toLowerCase().indexOf(q) < 0)) return false;
      if (cat && r[3] !== cat) return false;
      if (ver && r[13] !== ver) return false;
      if (watch && !r[14]) return false;
      return true;
    });
    var key = { value: 7, tvl: 5, net: 11, perhour: 12, growth: 6 }[sort];
    list.sort(function (a, b) { return (b[key] === null ? -1e18 : b[key]) - (a[key] === null ? -1e18 : a[key]); });
    $('count').textContent = list.length + ' of ' + ROWS.length + ' shown';
    var html = list.map(function (r) {
      var chg = r[6] === null ? '<span class="muted">—</span>' :
        '<span class="' + (r[6] >= 0 ? 'pos' : 'neg') + '">' + pct(r[6]) + '</span>';
      return '<tr data-slug="' + esc(r[1]) + '"><td class="num">' + r[0] + '</td><td>' + esc(r[2]) +
        (r[14] ? ' ★' : '') + '</td><td>' + esc(r[3] || '—') + '</td><td class="num">' + money(r[5]) + '</td><td class="num">' + chg +
        '</td><td class="num">' + days(r[15]) + '</td><td class="num"><b>' + money(r[7]) + '</b><br><small class="muted">' +
        money(r[8]) + ' – ' + money(r[9]) + '</small></td><td class="num">' + money(r[10]) + '</td><td class="num">' +
        money(r[11]) + '</td><td class="num">$' + r[12].toFixed(2) + '</td><td><span class="badge ' + r[13] + '">' + r[13] + '</span></td></tr>';
    }).join('');
    document.querySelector('#board tbody').innerHTML = html;
    document.querySelectorAll('#board tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var r = ROWS.find(function (x) { return x[1] === tr.dataset.slug; });
        if (r) showDetail(r);
      });
    });
  }
  ['q', 'cat', 'verdict', 'watch', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
  if (ROWS[0]) showDetail(ROWS[0]);

  // Scatter: traded comps against the fitted curve, log-log.
  (function () {
    var svg = $('scatter'), W = 640, H = 360, P = 46;
    var xs = COMPS.map(function (p) { return p[0]; }), ys = COMPS.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
    var y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    function X(x) { return P + ((x - x0) / (x1 - x0)) * (W - 2 * P); }
    function Y(y) { return H - P - ((y - y0) / (y1 - y0)) * (H - 2 * P); }
    var a = M.curve_a, b = M.curve_b;
    var loF = Math.log10(M.band_lo_factor), hiF = Math.log10(M.band_hi_factor);
    function line(off) {
      var pts = [];
      for (var x = x0; x <= x1; x += 0.2) pts.push(X(x).toFixed(1) + ',' + Y(a + b * x + off).toFixed(1));
      return pts.join(' ');
    }
    var dots = COMPS.map(function (p) {
      return '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.6" fill="#58a6ff" opacity="0.75"/>';
    }).join('');
    svg.innerHTML =
      '<polygon points="' + line(hiF) + ' ' + line(loF).split(' ').reverse().join(' ') + '" fill="#58a6ff" opacity="0.12"/>' +
      '<polyline points="' + line(0) + '" fill="none" stroke="#3fb950" stroke-width="2"/>' +
      dots +
      '<text x="' + P + '" y="' + (H - 12) + '" fill="#8b949e" font-size="12">log10 TVL →</text>' +
      '<text x="12" y="' + (P - 8) + '" fill="#8b949e" font-size="12">log10 mcap</text>' +
      '<text x="' + P + '" y="20" fill="#e6edf3" font-size="13">Fitted curve (green) with P25–P75 band · ' + COMPS.length + ' traded comps</text>';
  })();
})();
