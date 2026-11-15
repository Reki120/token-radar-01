// Token Radar dashboard: board, detail and filtered views over window.RADAR.
// Static, no network: every view renders from the data file beside this page.
(function () {
  var R = window.RADAR;
  var app = document.getElementById('app');
  var meta = document.getElementById('meta');
  var rows = R.rows;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(x) {
    if (x === null || x === undefined) return '—';
    var cls = x >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function age(a) { return a === null ? '—' : a.toFixed(1) + 'y'; }
  function chainList(r, full) {
    var list = full ? r.chains : r.chains.slice(0, 3);
    var s = list.join(', ');
    return r.chainCount > list.length ? esc(s) + ' +' + (r.chainCount - list.length) : esc(s);
  }

  meta.innerHTML = 'Snapshot <b>' + esc(R.meta.as_of) + '</b> · <b>' + R.meta.protocols +
    '</b> protocols · <b>' + R.meta.pre_token + '</b> record no token · <b>' +
    R.meta.eligible + '</b> pass the pre-token test · <b>' + R.meta.set_aside +
    '</b> set aside as products of tokens that already trade · <b>' +
    R.meta.watchlist + '</b> on the watchlist · global live mcap/TVL median <b>' +
    R.meta.global_multiple.toFixed(3) + '</b>';

  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var chains = [];
  rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  chains.sort();

  function parseHash() {
    var h = location.hash || '#/';
    var parts = h.slice(2).split('?');
    var path = parts[0] || '';
    var q = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) q[p[0]] = decodeURIComponent(p[1] || '');
    });
    return { path: path, q: q };
  }

  function sortRows(list, key) {
    var c = list.slice();
    if (key === 'tvl') c.sort(function (a, b) { return b.tvl - a.tvl; });
    else if (key === 'change') c.sort(function (a, b) { return (b.change || 0) - (a.change || 0); });
    else if (key === 'age') c.sort(function (a, b) { return (b.age || 0) - (a.age || 0); });
    else c.sort(function (a, b) { return a.rank - b.rank; });
    return c;
  }

  function boardView(q) {
    var f = {
      s: (q.s || '').toLowerCase(),
      cat: q.cat || '',
      chain: q.chain || '',
      wl: q.wl === '1',
      sort: q.sort || 'value',
    };
    var list = rows.filter(function (r) {
      if (f.s && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.s) < 0) return false;
      if (f.cat && r.category !== f.cat) return false;
      if (f.chain && r.chains.indexOf(f.chain) < 0) return false;
      if (f.wl && !r.watchlist) return false;
      return true;
    });
    list = sortRows(list, f.sort);
    var catOpts = '<option value="">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (f.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var html = '<section class="card"><h2>How the ranking works</h2>' +
      '<p class="formula">' + esc(R.model.formula) + '</p>' +
      '<p><b>Category multiple:</b> ' + esc(R.model.categoryMultiple) +
      ' <b>Growth:</b> ' + esc(R.model.growth) +
      ' <b>Age:</b> ' + esc(R.model.age) +
      ' <b>Breadth:</b> ' + esc(R.model.breadth) +
      ' <b>Discount:</b> ' + esc(R.model.discount) + '</p>' +
      '<p>' + esc(R.model.note) + '</p></section>' +
      '<section class="card"><div class="controls">' +
      '<input id="q" type="search" placeholder="Search a protocol…" value="' + esc(q.s || '') + '" aria-label="Search protocols">' +
      '<select id="cat" aria-label="Category">' + catOpts + '</select>' +
      '<select id="chain" aria-label="Chain">' + chainOpts + '</select>' +
      '<select id="sort" aria-label="Sort by">' +
      '<option value="value"' + (f.sort === 'value' ? ' selected' : '') + '>Sort: implied value</option>' +
      '<option value="tvl"' + (f.sort === 'tvl' ? ' selected' : '') + '>Sort: TVL</option>' +
      '<option value="change"' + (f.sort === 'change' ? ' selected' : '') + '>Sort: 7-day change</option>' +
      '<option value="age"' + (f.sort === 'age' ? ' selected' : '') + '>Sort: age</option></select>' +
      '<label><input id="wl" type="checkbox"' + (f.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '</div><p class="count">Showing <b>' + list.length + '</b> of ' + rows.length +
      ' pre-token protocols. Rank 1 is the most valuable launch.</p></section>' +
      '<section class="card"><table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th></tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="row" data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
          '<td><a href="#/protocol/' + esc(r.slug) + '">' + esc(r.name) + '</a> ' +
          (r.watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY</span>') + '</td>' +
          '<td>' + esc(r.category || '—') + '</td><td>' + chainList(r) + '</td>' +
          '<td class="num">' + money(r.tvl) + '</td><td class="num">' + pct(r.change) + '</td>' +
          '<td class="num">' + age(r.age) + '</td><td class="num"><b>' + money(r.value) + '</b></td></tr>';
      }).join('') + '</tbody></table></section>' +
      '<section class="card"><h2>How the multiples were set — live comparators</h2>' +
      '<p>The category multiples come from tokens that already trade. The strongest live tokens by market cap:</p>' +
      '<table class="comp"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
      R.live.map(function (p) {
        return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
          '<td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td>' +
          '<td class="num">' + p.ratio.toFixed(3) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p>Global median mcap/TVL across all live tokens: <b>' + R.meta.global_multiple.toFixed(3) +
      '</b>. When the model calibrates a category it caps each live ratio at the 90th percentile of live ratios (<b>' + R.meta.ratio_cap.toFixed(2) +
      'x</b>), so one micro-TVL token with a huge market cap cannot set a category; the table shows the raw ratios. These protocols are shown for calibration only — their tokens already trade, so they are never ranked on the board.</p></section>' +
      '<section class="card"><h2>Set aside — not launches</h2>' +
      '<p><b>' + R.meta.set_aside + '</b> protocols record no token but fail the pre-token test: they are bridges, exchanges, liquid-staking or wrapped products of a token that already trades, or versioned builds. The largest of them:</p>' +
      '<table class="comp"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why it is set aside</th></tr></thead><tbody>' +
      R.set_aside.map(function (p) {
        return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
          '<td class="num">' + money(p.tvl_usd) + '</td><td>' + esc(p.reason) + '</td></tr>';
      }).join('') + '</tbody></table></section>';
    app.innerHTML = html;
    var go = function () {
      var s = document.getElementById('q').value;
      var cat = document.getElementById('cat').value;
      var chain = document.getElementById('chain').value;
      var sort = document.getElementById('sort').value;
      var wl = document.getElementById('wl').checked ? '1' : '';
      var qs = [];
      if (s) qs.push('s=' + encodeURIComponent(s));
      if (cat) qs.push('cat=' + encodeURIComponent(cat));
      if (chain) qs.push('chain=' + encodeURIComponent(chain));
      if (sort !== 'value') qs.push('sort=' + sort);
      if (wl) qs.push('wl=1');
      location.hash = '#/' + (qs.length ? '?' + qs.join('&') : '');
    };
    document.getElementById('q').addEventListener('input', function () {
      clearTimeout(window.__rt);
      window.__rt = setTimeout(go, 400);
    });
    ['cat', 'chain', 'sort', 'wl'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', go);
    });
    app.querySelectorAll('tr.row').forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.tagName !== 'A') location.hash = '#/protocol/' + tr.getAttribute('data-slug');
      });
    });
  }

  function detailView(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { app.innerHTML = '<section class="card"><h2>Not on the board</h2><p>No pre-token protocol with that slug is in this snapshot.</p><p><a class="back" href="#/">← Back to the board</a></p></section>'; return; }
    var f = r.factors;
    var html = '<p><a class="back" href="#/">← Back to the board</a></p>' +
      '<section class="card"><p class="kicker" style="color:var(--acc);font-size:12px;font-weight:700;letter-spacing:.18em">RANK #' + r.rank +
      ' · ' + (r.watchlist ? 'ON THE WATCHLIST' : 'EARLY FIND — BELOW THE WATCHLIST FLOOR') + '</p>' +
      '<h2 style="font-size:26px;margin:4px 0">' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Uncategorised') + ' · ' + chainList(r, true) + (r.chainCount > 1 ? ' (' + r.chainCount + ' chains)' : '') + '</p>' +
      '<p class="big">' + money(r.value) + '</p><p>Implied launch value, by the model below.</p>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl) + '</div></div>' +
      '<div class="stat"><div class="k">7-day change</div><div class="v">' + pct(r.change) + '</div></div>' +
      '<div class="stat"><div class="k">Age, no token</div><div class="v">' + age(r.age) + '</div></div>' +
      '<div class="stat"><div class="k">Chains</div><div class="v">' + r.chainCount + '</div></div></div>' +
      '<h2>How the value is built</h2>' +
      '<table><tbody>' +
      '<tr><td>TVL × category multiple</td><td class="num">' + money(r.tvl) + ' × ' + f.catMult.toFixed(3) + ' = ' + money(f.base) + '</td></tr>' +
      '<tr><td>Growth factor</td><td class="num">× ' + f.growth.toFixed(3) + '</td></tr>' +
      '<tr><td>Age factor</td><td class="num">× ' + f.ageF.toFixed(3) + '</td></tr>' +
      '<tr><td>Chain-breadth factor</td><td class="num">× ' + f.breadth.toFixed(3) + '</td></tr>' +
      '<tr><td>Pre-token discount</td><td class="num">× 0.800</td></tr>' +
      '<tr><td><b>Implied value</b></td><td class="num"><b>' + money(r.value) + '</b></td></tr>' +
      '</tbody></table></section>' +
      '<section class="card"><h2>How to farm ' + esc(r.name) + '</h2>' +
      '<ol class="steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">No token is guaranteed. ' + esc(r.name) + ' records no token in this snapshot — farm the protocol because you would use it anyway, not because a launch is promised.</p></section>';
    app.innerHTML = html;
  }

  function render() {
    var h = parseHash();
    document.title = h.path.indexOf('protocol/') === 0
      ? 'Token Radar — protocol detail'
      : 'Token Radar — pre-token protocols ranked by implied launch value';
    if (h.path.indexOf('protocol/') === 0) detailView(h.path.slice(9));
    else boardView(h.q);
    app.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
  }
  window.addEventListener('hashchange', render);
  window.__shotReady = false;
  render();
})();
