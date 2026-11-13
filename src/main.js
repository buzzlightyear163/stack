import '@fontsource/barlow-condensed/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';

import { STACK } from './config.js';
import {
  getSnapshot, fetchTowers, fetchTower, fetchLastBuy, isMint,
  fmtUsd, fmtAmt, fmtPct, fmtAge, tk, short, SOL_MINT,
} from './data.js';
import { drawTower, miniTower, fillFor } from './tower.js';
import { initWallet, getWallet, connectWallet } from './wallet.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  live: false,
  towers: [],
  stats: null,
  tallest: null,
  current: null, // tower on the drawing
  pinned: false, // user picked a tower to view
  drawing: null,
  sort: 'tallest',
  build: { tower: null, base: null },
  lb: { key: null, h1: null, buy: null, at: null, mode: null },
};

// ---------------------------------------------------------------- drawing
function showOnDrawing(t, { pinned = false } = {}) {
  state.current = t;
  state.pinned = pinned;
  state.drawing = drawTower($('tower'), t);
  const top = t.layers[t.layers.length - 1];
  $('tower-name').textContent = tk(top.symbol);
  $('tb-tower').textContent = tk(top.symbol);
  $('drawing-kicker').textContent = pinned ? 'Tower' : 'Tallest tower';
  $('back-tallest').hidden = !pinned;
  const chain = [...t.layers].sort((a, b) => b.level - a.level).map((l) => tk(l.symbol));
  $('tower-desc').textContent = `Tower ${chain.join(' on ')}: ${t.layers.length} layers, ${fmtUsd(state.drawing.total)} locked.`;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('is-current', c.dataset.id === t.id));
  restartLastBuy();
}
$('back-tallest').addEventListener('click', () => state.tallest && showOnDrawing(state.tallest));

function setLive(mode) {
  const label = { live: 'LIVE', snapshot: `SNAPSHOT · ${getSnapshot().takenAt}`, loading: 'LOADING' }[mode];
  $('live-state').textContent = label;
  $('live-sq').classList.toggle('is-off', mode !== 'live');
}

// ---------------------------------------------------------------- last buy → cascade
let lbTimer = null;
let lbAgeTimer = null;

function renderLastBuy() {
  const { buy, mode, h1, at } = state.lb;
  const t = state.current;
  const top = t?.layers[t.layers.length - 1];
  const below = t?.layers[t.layers.length - 2];
  const text = $('lastbuy-text');
  const tag = $('lastbuy-tag');
  text.replaceChildren();
  const add = (s, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = s;
    text.appendChild(span);
  };
  if (mode === 'buy' && buy) {
    tag.textContent = 'Last buy';
    const p = buy.pay;
    if (p?.symbol === 'SOL') add(`${fmtAmt(p.amount)} SOL into `);
    else if (p) add(`${fmtAmt(p.amount)} ${tk(p.symbol)}${p.sol ? ` (≈${fmtAmt(p.sol)} SOL)` : ''} into `);
    else add('Buy into ');
    add(tk(top?.symbol), 'tk');
    add(' → ', 'ar');
    if (buy.verified && buy.layers) add(`cascaded through ${buy.layers} layer${buy.layers === 1 ? '' : 's'}`);
    else add(`on top of ${tk(below?.symbol)}`);
  } else if (mode === 'counts') {
    tag.textContent = at ? 'Last buy' : 'Buys 1h';
    if (at) {
      add('New buy into ');
      add(tk(top?.symbol), 'tk');
      add(' → ', 'ar');
      add(`${t.layers.length - 1} floors above ${tk(t.layers[0].symbol)}`);
    } else {
      add(`${h1 ?? 0} buys into `);
      add(tk(top?.symbol), 'tk');
      add(' in the last hour');
    }
  } else if (mode === 'none') {
    tag.textContent = 'Last buy';
    add('No buys read yet on ');
    add(tk(top?.symbol), 'tk');
  } else {
    tag.textContent = 'Last buy';
    add('Reading the top floor…');
  }
  const age = mode === 'buy' ? buy?.at : at;
  $('lastbuy-age').textContent = age ? fmtAge(Date.now() - age) : '';
}

async function pollLastBuy() {
  const t = state.current;
  if (!t || !state.live) return;
  const id = t.id;
  try {
    const r = await fetchLastBuy(id);
    if (state.current?.id !== id) return;
    const lb = state.lb;
    if (r.buy?.txid) {
      const fresh = lb.key && lb.key !== r.buy.txid && r.buy.at >= (lb.buy?.at || 0);
      lb.key = r.buy.txid;
      lb.buy = r.buy;
      lb.mode = 'buy';
      if (fresh) state.drawing?.pulse();
    } else if (r.counts?.h1 != null) {
      const grew = lb.h1 != null && r.counts.h1 > lb.h1;
      if (grew) {
        lb.at = Date.now();
        state.drawing?.pulse();
      }
      lb.h1 = r.counts.h1;
      if (lb.mode !== 'buy') lb.mode = 'counts';
    } else if (!lb.mode) {
      lb.mode = 'none';
    }
    renderLastBuy();
  } catch {
    /* keep the last good state */
  }
}

function restartLastBuy() {
  clearInterval(lbTimer);
  state.lb = { key: null, h1: null, buy: null, at: null, mode: null };
  renderLastBuy();
  if (!state.live) return;
  pollLastBuy();
  lbTimer = setInterval(pollLastBuy, 10_000);
}
lbAgeTimer = setInterval(() => {
  const { buy, mode, at } = state.lb;
  const a = mode === 'buy' ? buy?.at : at;
  if (a) $('lastbuy-age').textContent = fmtAge(Date.now() - a);
}, 1000);

// ---------------------------------------------------------------- towers
const SORTS = {
  tallest: (a, b) => b.height - a.height || (b.vol24 || 0) - (a.vol24 || 0) || b.totalLocked - a.totalLocked,
  growing: (a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity) || (b.vol24 || 0) - (a.vol24 || 0),
  newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
};

function renderCards() {
  const box = $('cards');
  if (!state.towers.length) {
    box.innerHTML = `<p class="empty mono">${state.live ? 'No towers right now.' : 'Couldn’t reach the tower data. Retrying…'}</p>`;
    return;
  }
  const list = [...state.towers].sort(SORTS[state.sort]).slice(0, 12);
  box.innerHTML = list
    .map((t) => {
      const top = t.layers[t.layers.length - 1];
      const below = t.layers[t.layers.length - 2];
      const chain = [...t.layers].reverse().map((l) => esc(tk(l.symbol))).join(' / ');
      const growth = t.growth != null
        ? `<span class="${t.growth >= 0 ? 'up' : 'down'}">${fmtPct(t.growth)}</span>`
        : top.launchlab && !top.graduated && top.progress != null ? `<span class="muted">curve ${Math.round(top.progress)}%</span>` : '<span class="muted">—</span>';
      return `
      <article class="card${state.current?.id === t.id ? ' is-current' : ''}" data-id="${esc(t.id)}" tabindex="0" aria-label="${esc(tk(top.symbol))} tower, ${t.height} layers">
        <div class="card-top">
          ${miniTower(t)}
          <div class="card-id">
            <span class="card-ticker mono">${esc(tk(top.symbol))}</span>
            <span class="card-on mono">on ${esc(tk(below?.symbol))}</span>
          </div>
          <span class="card-layers">${t.height} <small>layers</small></span>
        </div>
        <dl class="card-stats mono">
          <div><dt>Locked</dt><dd>${fmtUsd(t.totalLocked)}</dd></div>
          <div><dt>Top 24h</dt><dd>${growth}</dd></div>
          <div><dt>Vol 24h</dt><dd>${fmtUsd(t.vol24)}</dd></div>
        </dl>
        <p class="card-chain mono">${chain}</p>
        <div class="card-actions">
          <button type="button" class="btn btn-line btn-xs" data-act="view">View</button>
          <button type="button" class="btn btn-line btn-xs" data-act="build">Build on top</button>
        </div>
      </article>`;
    })
    .join('');
}

$('cards').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const t = state.towers.find((x) => x.id === card.dataset.id);
  if (!t) return;
  if (e.target.closest('[data-act="build"]')) {
    setFoundation(t.id, t);
    $('build').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  showOnDrawing(t, { pinned: t.id !== state.tallest?.id });
});
$('cards').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const card = e.target.closest('.card');
  const t = card && state.towers.find((x) => x.id === card.dataset.id);
  if (t) showOnDrawing(t, { pinned: t.id !== state.tallest?.id });
});
document.querySelectorAll('[data-sort]').forEach((b) =>
  b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('is-on', x === b));
    renderCards();
  })
);

// ---------------------------------------------------------------- signs
function renderSigns() {
  const s = state.stats;
  $('s-towers').textContent = s ? String(s.towers) : '—';
  $('s-tallest').textContent = s?.tallest ? `${s.tallest.height} layers` : '—';
  $('s-tallest-sub').textContent = s?.tallest ? tk(s.tallest.top) : ' ';
  $('s-locked').textContent = s ? fmtUsd(s.valueLocked) : '—';
  $('s-buyback').textContent = `${fmtAmt(STACK.boughtBackSol || 0)} SOL`;
}

// ---------------------------------------------------------------- section A–A
function renderSection() {
  const t = state.tallest || state.current;
  const box = $('hops');
  if (!t) return;
  const coins = t.layers.filter((l) => l.level > 0).sort((a, b) => a.level - b.level);
  const ground = t.layers[0];
  const topNew = `$TOP`;
  $('aa-kicker').textContent = `1 ${ground.symbol} into ${topNew}`;
  let amt = 1;
  let sym = ground.symbol;
  let usd = ground.priceUsd || null;
  const rows = [];
  for (const l of coins) {
    const out = l.priceNative ? amt / l.priceNative : null;
    rows.push({ level: l.level, from: sym, to: tk(l.symbol), locked: amt, lockedUsd: usd ? amt * usd : null, out, outSym: l.symbol });
    if (out == null) { amt = null; break; }
    usd = l.priceUsd || null;
    amt = out;
    sym = tk(l.symbol);
  }
  const ok = amt != null && rows.length === coins.length;
  rows.push({ level: coins.length + 1, from: sym, to: topNew, locked: ok ? amt : null, lockedUsd: ok && usd ? amt * usd : null, out: null, outSym: null, isNew: true });

  box.innerHTML = rows
    .map((r) => `
      <li class="hop${r.isNew ? ' is-new' : ''}">
        <span class="hop-level" style="--lv:${r.isNew ? 'transparent' : fillFor(r.level)}">L${r.level}</span>
        <span class="hop-route mono">${esc(r.from)} <i>→</i> ${esc(r.to)}</span>
        <span class="hop-lock mono">${r.locked != null ? `${fmtAmt(r.locked)} ${esc(r.from)}` : '—'}<small>${r.lockedUsd != null ? `${fmtUsd(r.lockedUsd)} ` : ''}locked in L${r.level}</small></span>
        <span class="hop-out mono">${r.isNew ? 'your floor' : r.out != null ? `≈ ${fmtAmt(r.out)} ${esc(tk(r.outSym))}` : '—'}</span>
      </li>`)
    .join('');
  $('aa-note').textContent = `${tk(coins[coins.length - 1]?.symbol)} tower at current prices, before fees and price impact. One transaction, every floor bought on the way up.`;
}

// ---------------------------------------------------------------- build
const buildSvg = $('build-tower');

function renderBuild() {
  const t = state.build.tower;
  const ticker = ($('coin-ticker').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!t) {
    $('build-result').textContent = 'Pick a foundation';
    drawTower(buildSvg, { layers: [{ level: 0, symbol: 'SOL' }] }, { openLabel: `L1 · ${ticker ? '$' + ticker : 'YOUR COIN'}`, openActive: true });
    return;
  }
  const top = t.layers[t.layers.length - 1];
  const level = top.level + 1;
  const res = $('build-result');
  res.innerHTML = `Your coin will be <b>L${level}</b> on top of <b>${esc(tk(top.symbol))}</b>`;
  drawTower(buildSvg, t, { openLabel: `L${level} · ${ticker ? '$' + ticker : 'YOUR COIN'}`, openActive: true });
}

function renderChips() {
  const chips = [];
  if (STACK.mint) chips.push({ id: STACK.mint, label: '$STACK', sub: 'default' });
  [...state.towers].sort(SORTS.tallest).slice(0, 5).forEach((t) => {
    const top = t.layers[t.layers.length - 1];
    chips.push({ id: t.id, label: tk(top.symbol), sub: `L${top.level}` });
  });
  chips.push({ id: SOL_MINT, label: 'SOL', sub: 'L0' });
  $('base-chips').innerHTML = chips
    .map((c) => `<button type="button" class="chip mono${state.build.base === c.id ? ' is-on' : ''}" data-mint="${esc(c.id)}">${esc(c.label)} <small>${esc(c.sub)}</small></button>`)
    .join('');
}
$('base-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mint]');
  if (b) setFoundation(b.dataset.mint);
});

async function setFoundation(mint, known) {
  state.build.base = mint;
  $('base-msg').textContent = '';
  if (mint === SOL_MINT) {
    state.build.tower = { id: SOL_MINT, layers: [{ level: 0, mint: SOL_MINT, symbol: 'SOL', ground: true }] };
  } else {
    const local = known || state.towers.find((t) => t.id === mint);
    if (local) state.build.tower = local;
    else {
      $('base-msg').textContent = `Tracing ${short(mint)} down to the ground…`;
      try {
        const r = await fetchTower(mint);
        if (state.build.base !== mint) return;
        if (!r.tower) throw new Error('nf');
        state.build.tower = r.tower;
        $('base-msg').textContent = `${tk(r.tower.top)} sits ${r.tower.height - 1} floor${r.tower.height === 2 ? '' : 's'} above ${tk(r.tower.layers[0].symbol)}.`;
      } catch {
        if (state.build.base !== mint) return;
        if (mint === STACK.mint) {
          // $STACK sits on SOL; before its pool is indexed, draw it from what we know
          state.build.tower = {
            id: mint,
            layers: [
              { level: 0, mint: SOL_MINT, symbol: 'SOL', ground: true },
              { level: 1, mint, symbol: 'STACK' },
            ],
          };
          $('base-msg').textContent = '$STACK sits on SOL.';
        } else {
          state.build.tower = null;
          $('base-msg').textContent = 'Couldn’t find a pool for that CA. Check the address.';
        }
      }
    }
  }
  renderChips();
  renderBuild();
}

$('base-use').addEventListener('click', () => {
  const v = $('base-ca').value.trim();
  if (!isMint(v)) {
    $('base-msg').textContent = 'That doesn’t look like a Solana CA.';
    return;
  }
  setFoundation(v);
});
$('base-ca').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('base-use').click();
  }
});
$('base-ca').addEventListener('paste', () => setTimeout(() => isMint($('base-ca').value.trim()) && $('base-use').click(), 0));
$('coin-ticker').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  renderBuild();
});
$('coin-img').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  const img = $('coin-img-preview');
  if (!f) {
    img.hidden = true;
    $('coin-img-name').textContent = 'PNG, JPG or GIF · square';
    return;
  }
  if (f.size > 4 * 1024 * 1024) {
    $('coin-img-name').textContent = 'Max 4 MB';
    e.target.value = '';
    return;
  }
  img.src = URL.createObjectURL(f);
  img.hidden = false;
  $('coin-img-name').textContent = f.name;
});

$('build-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('launch-msg');
  const name = $('coin-name').value.trim();
  const ticker = $('coin-ticker').value.trim();
  if (!state.build.tower) return (msg.textContent = 'Pick a foundation first.');
  if (!name) return (msg.textContent = 'Give your coin a name.');
  if (ticker.length < 2) return (msg.textContent = 'Ticker needs 2–10 letters.');
  if (!$('coin-img').files?.[0]) return (msg.textContent = 'Add an image.');
  if (!getWallet()) {
    msg.textContent = 'Connect a wallet to launch.';
    await connectWallet();
    if (!getWallet()) return;
  }
  const top = state.build.tower.layers[state.build.tower.layers.length - 1];
  msg.textContent = `$${ticker} on ${tk(top.symbol)} is ready. Launch transactions aren’t enabled on the site yet.`;
});

// ---------------------------------------------------------------- data
function applyTowers(data) {
  state.towers = data.towers || [];
  state.stats = data.stats || null;
  state.tallest = [...state.towers].sort(SORTS.tallest)[0] || null;
}

async function loadTowers(first = false) {
  try {
    const data = await fetchTowers();
    const wasLive = state.live;
    applyTowers(data);
    state.live = true;
    setLive('live');
    if (state.pinned && state.current) {
      const fresh = state.towers.find((t) => t.id === state.current.id);
      if (fresh) showOnDrawing(fresh, { pinned: true });
    } else if (state.tallest) {
      // only redraw when something changed, so a pulse isn't cut off
      if (!wasLive || state.tallest.id !== state.current?.id || JSON.stringify(state.tallest.layers.map((l) => l.locked)) !== JSON.stringify(state.current.layers.map((l) => l.locked))) {
        showOnDrawing(state.tallest);
      }
    }
    if (first && !state.build.base) setFoundation(STACK.mint || state.tallest?.id || SOL_MINT);
  } catch {
    if (first) {
      setLive('snapshot');
      renderLastBuy();
    }
  }
  renderCards();
  renderSigns();
  renderSection();
  renderChips();
}

// ---------------------------------------------------------------- CA
function initCA() {
  const boxes = document.querySelectorAll('[data-ca-box]');
  if (!STACK.mint) {
    boxes.forEach((b) => (b.hidden = true));
    return;
  }
  document.querySelectorAll('[data-ca]').forEach((c) => (c.textContent = STACK.mint));
  document.querySelectorAll('[data-ca-copy]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(STACK.mint);
      } catch {
        const t = document.createElement('textarea');
        t.value = STACK.mint;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        t.remove();
      }
      btn.textContent = 'Copied';
      btn.classList.add('is-done');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('is-done');
      }, 1400);
    })
  );
}

// ---------------------------------------------------------------- boot
initCA();
initWallet(document.querySelectorAll('[data-connect]'));
if (STACK.x) {
  const a = document.createElement('a');
  a.href = STACK.x; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'X';
  $('footer-links').appendChild(a);
}
const snap = getSnapshot();
setLive('loading');
showOnDrawing(snap.tower);
state.current = snap.tower;
renderSigns();
renderSection();
renderBuild();
loadTowers(true);
setInterval(() => loadTowers(false), 60_000);

if (new URLSearchParams(location.search).has('debug')) {
  window.__stack = { pulse: () => state.drawing?.pulse(), setPath: (l) => state.drawing?.setPath(l), state };
}
