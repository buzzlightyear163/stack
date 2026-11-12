// Client data: live from /api (Vercel functions), with a dated snapshot for the very first paint.

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Real values read on 12 Nov 2026 — only shown until /api answers (or if it can't).
export function getSnapshot() {
  return {
    source: 'snapshot',
    takenAt: '12 NOV',
    tower: {
      id: 'H3gXgvf2kza3vz3WhP3KoKdprhiu7oW6Q1ARXLy5Erhf',
      top: 'STINK',
      height: 4,
      totalLocked: 474700,
      layers: [
        { level: 0, mint: SOL_MINT, symbol: 'SOL', ground: true, priceUsd: 82.8 },
        { level: 1, mint: '6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx', symbol: 'STONK', locked: 429200, change24h: -11.5 },
        { level: 2, mint: '5wsjHxT5nW5jQuVupXUNnYszF3WoWCfGGk9LMcsCJzY8', symbol: 'STANK', locked: 39300, change24h: -49.7 },
        { level: 3, mint: 'H3gXgvf2kza3vz3WhP3KoKdprhiu7oW6Q1ARXLy5Erhf', symbol: 'STINK', locked: 6200, change24h: 33.6 },
      ],
    },
  };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export const fetchTowers = () => getJSON('/api/towers');
export const fetchTower = (mint) => getJSON(`/api/tower?mint=${encodeURIComponent(mint)}`);
export const fetchLastBuy = (mint) => getJSON(`/api/lastbuy?mint=${encodeURIComponent(mint)}`);

export const isMint = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');

// ---------- formatting ----------
export function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `$${Math.round(n)}`;
}
export function fmtAmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(2).replace(/\.?0+$/, '');
  if (a >= 0.001) return n.toFixed(3).replace(/\.?0+$/, '');
  return n.toPrecision(2);
}
export function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return '';
  const s = Math.abs(p) >= 100 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1);
  return `${p >= 0 ? '+' : '−'}${s}%`;
}
export function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export const tk = (sym) => (sym && !['SOL', 'USDC', 'USDT', 'USD1'].includes(sym) ? `$${sym}` : sym || '?');
export const short = (m) => (m ? `${m.slice(0, 4)}…${m.slice(-4)}` : '');
