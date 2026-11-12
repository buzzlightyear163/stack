import { fmtUsd, fmtPct, tk } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
export const LEVEL_FILL = ['#0D1626', '#2E5A8C', '#4F86C6', '#7FB8EA', '#9FD8FF'];
const ACTIVE = '#EAF3FF';

export const fillFor = (level) => LEVEL_FILL[Math.min(level, LEVEL_FILL.length - 1)];
const isLight = (level) => level >= 3;

// Width of a floor ~ value locked in it, on a log scale ($1K … $10M) so small top floors stay readable.
export function widthShare(locked) {
  const v = Math.max(1, locked || 0);
  const t = (Math.log10(v) - 3) / 4;
  return Math.min(0.94, Math.max(0.28, 0.28 + 0.72 * t));
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function text(parent, x, y, str, cls, anchor = 'start') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor, 'dominant-baseline': 'middle' }, parent);
  t.textContent = str;
  return t;
}
function dimV(g, x, y1, y2) {
  el('line', { x1: x, y1, x2: x, y2, class: 'dim' }, g);
  el('line', { x1: x - 5, y1: y1 + 5, x2: x + 5, y2: y1 - 5, class: 'dim' }, g);
  el('line', { x1: x - 5, y1: y2 + 5, x2: x + 5, y2: y2 - 5, class: 'dim' }, g);
}
function dimH(g, x1, x2, y) {
  el('line', { x1, y1: y, x2, y2: y, class: 'dim' }, g);
  el('line', { x1: x1 - 5, y1: y + 5, x2: x1 + 5, y2: y - 5, class: 'dim' }, g);
  el('line', { x1: x2 - 5, y1: y + 5, x2: x2 + 5, y2: y - 5, class: 'dim' }, g);
}

/**
 * Flat facade elevation of a tower.
 * opts.openFloor: draw the dashed next floor on top. opts.openLabel: its text. opts.openActive: emphasise it.
 */
export function drawTower(svg, tower, opts = {}) {
  const { openFloor = true, openLabel, openActive = false } = opts;
  svg.replaceChildren();

  const W = 520;
  const signW = 40;
  const towerLeft = 70;
  const maxW = 300;
  const cx = towerLeft + maxW / 2;
  const top = 18;

  const coins = tower.layers.filter((l) => l.level > 0).sort((a, b) => b.level - a.level); // top → down
  const base = tower.layers.find((l) => l.level === 0) || { symbol: 'SOL' };
  const total = coins.reduce((s, l) => s + (l.locked || 0), 0);
  const topLevel = coins.length ? coins[0].level : 0;

  const floorH = Math.round(Math.min(100, Math.max(46, 330 / Math.max(1, coins.length))));
  const groundH = 58;
  const openH = Math.min(60, floorH);
  const widthOf = (l) => maxW * widthShare(l.locked);

  const openY = top;
  const firstFloorY = openFloor ? top + openH + 12 : top;
  const groundTopY = firstFloorY + coins.length * floorH;
  const groundY = groundTopY + groundH;
  const H = groundY + 78;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const gAxis = el('g', {}, svg);
  const gFloors = el('g', {}, svg);
  const gSigns = el('g', {}, svg);
  const gDims = el('g', {}, svg);
  const gPulse = el('g', {}, svg);

  el('line', { x1: cx, y1: openY - 8, x2: cx, y2: groundY + 18, class: 'axis' }, gAxis);

  if (openFloor) {
    const w = coins.length ? Math.max(widthOf(coins[0]) * 0.86, 120) : maxW * 0.6;
    el('rect', { x: cx - w / 2, y: openY, width: w, height: openH, class: `open-slab${openActive ? ' is-active' : ''}` }, gFloors);
    const label = openLabel || `L${topLevel + 1} · OPEN`;
    const lw = label.length * 6.8 + 14;
    el('rect', { x: cx - lw / 2, y: openY + openH / 2 - 9, width: lw, height: 18, fill: '#060B14' }, gFloors);
    text(gFloors, cx, openY + openH / 2 + 1, label, `open-t${openActive ? ' is-active' : ''}`, 'middle');
  }

  const floors = [];
  const signs = [];
  const drawSign = (level, cy, x2) => {
    const g = el('g', { class: 'sign', 'data-level': level }, gSigns);
    el('line', { x1: signW + 4, y1: cy, x2: x2 - 6, y2: cy, class: 'leader' }, g);
    el('rect', { x: 2, y: cy - 13, width: signW, height: 26, class: 'sign-box' }, g);
    text(g, 2 + signW / 2, cy + 1, `L${level}`, 'sign-t', 'middle');
    signs.push(g);
  };

  const twoLines = floorH >= 60;
  coins.forEach((l, i) => {
    const w = widthOf(l);
    const x = cx - w / 2;
    const fy = firstFloorY + i * floorH;
    const g = el('g', { class: `floor ${isLight(l.level) ? 'light' : 'dark'}`, 'data-level': l.level }, gFloors);
    const slab = el('rect', { x, y: fy, width: w, height: floorH, fill: fillFor(l.level), class: 'floor-slab' }, g);
    if (twoLines) {
      text(g, x + 12, fy + floorH / 2 - 8, tk(l.symbol), 'floor-t');
      text(g, x + 12, fy + floorH / 2 + 11, w < 130 ? fmtUsd(l.locked) : `${fmtUsd(l.locked)} locked`, 'floor-v');
    } else {
      text(g, x + 10, fy + floorH / 2 + 1, tk(l.symbol), 'floor-t');
      text(g, x + w - 10, fy + floorH / 2 + 1, fmtUsd(l.locked), 'floor-v', 'end');
    }
    if (l.change24h != null) {
      text(gDims, x + w + 8, fy + floorH / 2, fmtPct(l.change24h), `floor-v ${l.change24h >= 0 ? 'up' : 'down'}`);
    } else if (l.launchlab && !l.graduated && l.progress != null) {
      text(gDims, x + w + 8, fy + floorH / 2, `curve ${l.progress < 10 ? l.progress.toFixed(1) : Math.round(l.progress)}%`, 'note');
    }
    drawSign(l.level, fy + floorH / 2, x);
    floors.push({ level: l.level, g, slab, fill: fillFor(l.level) });
  });

  {
    const x = cx - maxW / 2;
    const g = el('g', { class: 'floor dark l0', 'data-level': 0 }, gFloors);
    const slab = el('rect', { x, y: groundTopY, width: maxW, height: groundH, fill: fillFor(0), class: 'floor-slab' }, g);
    text(g, x + 12, groundTopY + groundH / 2, base.symbol || 'SOL', 'floor-t');
    text(g, x + maxW - 12, groundTopY + groundH / 2, 'ground', 'floor-v', 'end');
    drawSign(0, groundTopY + groundH / 2, x);
    floors.push({ level: 0, g, slab, fill: fillFor(0) });
  }

  const gx1 = cx - maxW / 2 - 22;
  const gx2 = cx + maxW / 2 + 22;
  el('line', { x1: gx1, y1: groundY, x2: gx2, y2: groundY, class: 'ground' }, gDims);
  for (let hx = gx1 + 4; hx < gx2; hx += 9) {
    el('line', { x1: hx, y1: groundY + 2, x2: hx - 8, y2: groundY + 10, class: 'hatch' }, gDims);
  }

  // vertical dimension: layers
  const dimX = cx + maxW / 2 + 62;
  const towerTop = firstFloorY;
  const topW = coins.length ? widthOf(coins[0]) : maxW;
  el('line', { x1: cx + topW / 2 + 4, y1: towerTop, x2: dimX + 6, y2: towerTop, class: 'dim', 'stroke-dasharray': '1 3' }, gDims);
  el('line', { x1: cx + maxW / 2 + 4, y1: groundY, x2: dimX + 6, y2: groundY, class: 'dim', 'stroke-dasharray': '1 3' }, gDims);
  dimV(gDims, dimX, towerTop, groundY);
  const midY = (towerTop + groundY) / 2;
  text(gDims, dimX + 12, midY - 8, `${coins.length + 1} LAYERS`, 'dim-t');
  text(gDims, dimX + 12, midY + 9, `L0 → L${topLevel}`, 'dim-sub');

  // horizontal dimension: total locked
  const dimY = groundY + 34;
  el('line', { x1: cx - maxW / 2, y1: groundY + 12, x2: cx - maxW / 2, y2: dimY + 6, class: 'dim', 'stroke-dasharray': '1 3' }, gDims);
  el('line', { x1: cx + maxW / 2, y1: groundY + 12, x2: cx + maxW / 2, y2: dimY + 6, class: 'dim', 'stroke-dasharray': '1 3' }, gDims);
  dimH(gDims, cx - maxW / 2, cx + maxW / 2, dimY);
  const lockedLabel = `${fmtUsd(total)} LOCKED`;
  const lw = lockedLabel.length * 7 + 16;
  el('rect', { x: cx - lw / 2, y: dimY - 9, width: lw, height: 18, fill: '#060B14' }, gDims);
  text(gDims, cx, dimY + 1, lockedLabel, 'dim-t', 'middle');

  const seg = el('rect', { x: cx - 1.5, y: towerTop, width: 3, height: 26, class: 'pulse-seg', opacity: 0 }, gPulse);

  // hover: light a floor's path down to the ground
  const setPath = (level) => {
    floors.forEach((f) => f.g.classList.toggle('on-path', level != null && f.level <= level));
    signs.forEach((s) => s.classList.toggle('on-path', level != null && Number(s.dataset.level) <= level));
  };
  [...floors.map((f) => f.g), ...signs].forEach((node) => {
    node.addEventListener('mouseenter', () => setPath(Number(node.dataset.level)));
    node.addEventListener('mouseleave', () => setPath(null));
  });

  // cascade pulse: top → L0 in ~600 ms
  function pulse() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const n = floors.length;
    const step = Math.round(360 / Math.max(1, n - 1));
    floors.forEach((f, i) => {
      f.slab.animate([{ fill: f.fill }, { fill: ACTIVE, offset: 0.35 }, { fill: f.fill }], { duration: 240, delay: i * step, easing: 'ease-out' });
      const sign = signs.find((s) => Number(s.dataset.level) === f.level);
      sign?.querySelector('.sign-box').animate([{ fill: '#060B14' }, { fill: ACTIVE, offset: 0.35 }, { fill: '#060B14' }], { duration: 240, delay: i * step, easing: 'ease-out' });
    });
    const dy = groundY - towerTop - 26;
    seg.animate(
      [
        { transform: 'translateY(0px)', opacity: 1 },
        { transform: `translateY(${dy}px)`, opacity: 1, offset: 0.92 },
        { transform: `translateY(${dy}px)`, opacity: 0 },
      ],
      { duration: 600, easing: 'linear' }
    );
  }

  return { pulse, setPath, total, layers: coins.length + 1, topLevel };
}

// Small facade sketch for tower cards (string SVG).
export function miniTower(tower) {
  const coins = tower.layers.filter((l) => l.level > 0).sort((a, b) => a.level - b.level); // bottom → top
  const W = 96, H = 72, maxW = 84, cx = W / 2;
  const gh = 7;
  const fh = Math.min(12, Math.floor((H - gh - 6) / Math.max(1, coins.length)));
  let y = H - 2 - gh;
  let out = `<svg class="mini" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
  out += `<rect x="${cx - maxW / 2}" y="${y}" width="${maxW}" height="${gh}" fill="${fillFor(0)}" stroke="#4F86C6" stroke-width="1"/>`;
  out += `<line x1="2" y1="${H - 1.5}" x2="${W - 2}" y2="${H - 1.5}" stroke="#7F93B3" stroke-width="1.5"/>`;
  for (const l of coins) {
    const w = maxW * widthShare(l.locked);
    y -= fh;
    out += `<rect class="mini-f" x="${(cx - w / 2).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${fh}" fill="${fillFor(l.level)}" stroke="#060B14" stroke-width="1"/>`;
  }
  out += `<rect x="${cx - 18}" y="${y - fh - 3}" width="36" height="${fh}" fill="none" stroke="rgba(159,216,255,.5)" stroke-dasharray="3 2"/>`;
  return out + '</svg>';
}
