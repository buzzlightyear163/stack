// STACK data layer — runs as Vercel functions (and in plain browsers for testing).
// Towers are traced from real data:
//   coin → its quote token (Raydium LaunchLab `mintB`, or its Raydium pool on DexScreener) → … → SOL
// Value locked in a floor = value of the floor-below tokens sitting in that floor's pools.

export const SOL = 'So11111111111111111111111111111111111111112';
export const GROUND = new Map([
  [SOL, 'SOL'],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'],
  ['USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', 'USD1'],
]);
const STABLE = new Set([...GROUND.keys()].filter((m) => m !== SOL));

const RAY = 'https://launch-mint-v1.raydium.io';
const RAY_HIST = 'https://launch-history-v1.raydium.io';
const DS = 'https://api.dexscreener.com';

const MIN_CHILD_LIQ = 300; // ignore dust pools when looking for floors built on a coin
const MIN_TOP_LOCKED = 50; // ignore towers whose top floor is empty

export const isMint = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

const memo = new Map();
async function getJSON(url, { ttl = 30_000, timeout = 6000 } = {}) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const v = await r.json();
  memo.set(url, { t: Date.now(), v });
  if (memo.size > 800) memo.delete(memo.keys().next().value);
  return v;
}
const safe = (p, fallback) => p.catch(() => fallback);
const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const liq = (p) => Number(p?.liquidity?.usd) || 0;
const byLiq = (a, b) => liq(b) - liq(a);

// ---------- sources ----------
export async function rayList(sort, size = 100) {
  const j = await getJSON(`${RAY}/get/list?sort=${sort}&size=${size}&includeNsfw=false`);
  return j?.data?.rows || [];
}
export async function rayByMints(mints) {
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const j = await getJSON(`${RAY}/get/by/mints?ids=${mints.slice(i, i + 30).join(',')}`);
    out.push(...(j?.data?.rows || []));
  }
  return out;
}
export async function rayTrades(poolId, limit = 20) {
  const j = await getJSON(`${RAY_HIST}/trade?poolId=${poolId}&limit=${limit}`, { ttl: 4000 });
  return j?.data?.rows || [];
}
export async function tokenPairs(mint) {
  const j = await getJSON(`${DS}/token-pairs/v1/solana/${mint}`);
  return Array.isArray(j) ? j : [];
}

// ---------- context ----------
export function createCtx() {
  return { rows: new Map(), rowMiss: new Set(), pairs: new Map(), base: new Map(), solUsd: null };
}
function addPairs(ctx, mint, pairs) {
  ctx.pairs.set(mint, pairs);
  // also index each pair under the other token, so lookups work both ways
  for (const p of pairs) {
    for (const m of [p.baseToken?.address, p.quoteToken?.address]) {
      if (!m || m === mint || GROUND.has(m)) continue;
      const k = `_${m}`;
      if (!ctx.pairs.has(k)) ctx.pairs.set(k, []);
      ctx.pairs.get(k).push(p);
    }
  }
}
function pairsOf(ctx, mint) {
  const seen = new Set();
  const all = [...(ctx.pairs.get(mint) || []), ...(ctx.pairs.get(`_${mint}`) || [])];
  return all.filter((p) => (seen.has(p.pairAddress) ? false : seen.add(p.pairAddress)));
}
export async function ensurePairs(ctx, mints) {
  const need = [...new Set(mints)].filter((m) => m && !GROUND.has(m) && !ctx.pairs.has(m));
  await Promise.all(need.map(async (m) => addPairs(ctx, m, await safe(tokenPairs(m), []))));
}
export async function ensureRows(ctx, mints) {
  const need = [...new Set(mints)].filter((m) => m && !GROUND.has(m) && !ctx.rows.has(m) && !ctx.rowMiss.has(m));
  if (!need.length) return;
  const rows = await safe(rayByMints(need), []);
  for (const r of rows) ctx.rows.set(r.mint, r);
  for (const m of need) if (!ctx.rows.has(m)) ctx.rowMiss.add(m);
}
function computeSolUsd(ctx) {
  let best = null;
  for (const [k, ps] of ctx.pairs) {
    if (k.startsWith('_')) continue;
    for (const p of ps) {
      if (p.quoteToken?.address !== SOL) continue;
      const pu = num(p.priceUsd), pn = num(p.priceNative);
      if (!pu || !pn) continue;
      if (!best || liq(p) > liq(best)) best = p;
    }
  }
  if (best) ctx.solUsd = num(best.priceUsd) / num(best.priceNative);
}
async function ensureSolUsd(ctx) {
  computeSolUsd(ctx);
  if (ctx.solUsd) return;
  // Raydium SOL/USDC pool as a fallback price source
  const j = await safe(getJSON(`${DS}/latest/dex/pairs/solana/58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`, { ttl: 60_000 }), null);
  const p = j?.pairs?.[0] || j?.pair;
  if (p?.baseToken?.address === SOL) ctx.solUsd = num(p.priceUsd);
}
function usdPrice(ctx, mint) {
  if (mint === SOL) return ctx.solUsd;
  if (STABLE.has(mint)) return 1;
  const own = pairsOf(ctx, mint).filter((p) => p.baseToken?.address === mint).sort(byLiq);
  if (own[0]) return num(own[0].priceUsd);
  const row = ctx.rows.get(mint);
  if (row?.marketCap && row?.supply) return row.marketCap / row.supply;
  return null;
}

// What is this coin built on?
function baseOf(ctx, mint) {
  const row = ctx.rows.get(mint);
  if (row?.mintB?.address) return row.mintB.address;
  // not a LaunchLab coin: it sits on whatever its deepest pool is paired against
  const own = pairsOf(ctx, mint).filter((p) => p.baseToken?.address === mint).sort(byLiq);
  return own[0]?.quoteToken?.address || null;
}

export async function resolveAll(ctx, mints, depth = 8) {
  let frontier = [...new Set(mints)];
  for (let d = 0; d < depth && frontier.length; d++) {
    frontier = frontier.filter((m) => m && !GROUND.has(m) && !ctx.base.has(m));
    if (!frontier.length) break;
    await ensureRows(ctx, frontier);
    await ensurePairs(ctx, frontier);
    const next = [];
    for (const m of frontier) {
      const b = baseOf(ctx, m);
      ctx.base.set(m, b);
      if (b && !GROUND.has(b) && !ctx.base.has(b)) next.push(b);
    }
    frontier = next;
  }
  await ensureSolUsd(ctx);
}

export function chainFrom(ctx, top, max = 10) {
  const chain = [top];
  let cur = top;
  for (let i = 0; i < max; i++) {
    const b = GROUND.has(cur) ? null : ctx.base.get(cur);
    if (!b || chain.includes(b)) return null;
    chain.push(b);
    if (GROUND.has(b)) return chain;
    cur = b;
  }
  return null;
}

export function floorInfo(ctx, mint, base) {
  const row = ctx.rows.get(mint);
  const own = pairsOf(ctx, mint).filter((p) => p.baseToken?.address === mint);
  const home = own.filter((p) => p.quoteToken?.address === base).sort(byLiq);
  const hp = home[0];
  const graduated = row ? Number(row.finishingRate) >= 100 : true;

  // base tokens sitting in this floor's pools, in USD
  let locked = 0;
  for (const p of home) {
    const q = num(p.liquidity?.quote), pu = num(p.priceUsd), pn = num(p.priceNative);
    if (q && pu && pn) locked += q * (pu / pn);
  }
  const baseUsd = usdPrice(ctx, base);
  if (!locked && row && !graduated) {
    const decB = row.mintB?.decimals ?? 9;
    const raised = (Number(row.finishingRate) / 100) * (Number(row.totalFundRaisingB) / 10 ** decB);
    locked = baseUsd ? raised * baseUsd : 0;
  }

  let priceUsd = hp ? num(hp.priceUsd) : null;
  let priceNative = hp ? num(hp.priceNative) : null;
  if (!hp && row?.marketCap && row?.supply) {
    priceUsd = row.marketCap / row.supply;
    priceNative = baseUsd ? priceUsd / baseUsd : null;
  }
  const created = row?.createAt || (own.length ? Math.min(...own.map((p) => p.pairCreatedAt || Infinity)) : null);

  return {
    mint,
    symbol: row?.symbol || hp?.baseToken?.symbol || own[0]?.baseToken?.symbol || '?',
    name: row?.name || hp?.baseToken?.name || '',
    img: row?.imgUrl || hp?.info?.imageUrl || null,
    base,
    locked: locked || null,
    change24h: hp?.priceChange?.h24 ?? null,
    vol24: home.length ? home.reduce((s, p) => s + (Number(p.volume?.h24) || 0), 0) : row ? num(row.volumeU) : null,
    mcap: hp?.marketCap ?? hp?.fdv ?? row?.marketCap ?? null,
    priceUsd,
    priceNative, // price in the floor below
    pair: hp?.pairAddress || (row ? (graduated ? row.migrateAmmId : row.poolId) : null) || null,
    poolId: row?.poolId || null,
    launchlab: !!row,
    graduated,
    progress: row ? Math.min(100, Number(row.finishingRate) || 0) : null,
    platform: row?.platformInfo?.pubKey || null,
    buysH1: hp?.txns?.h1?.buys ?? null,
    buysM5: hp?.txns?.m5?.buys ?? null,
    createdAt: Number.isFinite(created) ? created : null,
  };
}

export function towerFromChain(ctx, chain) {
  const ground = chain[chain.length - 1];
  const coins = chain.slice(0, -1).reverse(); // bottom → top
  const layers = [{ level: 0, mint: ground, symbol: GROUND.get(ground) || '?', ground: true, priceUsd: usdPrice(ctx, ground) }];
  coins.forEach((m, i) => layers.push({ level: i + 1, ...floorInfo(ctx, m, i === 0 ? ground : coins[i - 1]) }));
  const top = layers[layers.length - 1];
  return {
    id: top.mint,
    top: top.symbol,
    height: layers.length,
    layers,
    totalLocked: layers.reduce((s, l) => s + (l.locked || 0), 0),
    vol24: top.vol24,
    growth: top.change24h,
    createdAt: top.createdAt,
  };
}

// ---------- towers ----------
// tallest first; equal height → the most traded top floor, then the most value locked
export const byHeight = (x, y) => y.height - x.height || (y.vol24 || 0) - (x.vol24 || 0) || y.totalLocked - x.totalLocked;

export async function rayPlatform(platformId, size = 100) {
  const j = await getJSON(`${RAY}/get/list?sort=new&size=${size}&includeNsfw=false&platformId=${platformId}`);
  return j?.data?.rows || [];
}

export async function discoverTowers({ seeds = [], featured = [], platformId = '', platforms = [], stackMint = '' } = {}) {
  const ctx = createCtx();
  if (!platformId && stackMint) {
    await ensureRows(ctx, [stackMint]);
    platformId = ctx.rows.get(stackMint)?.platformInfo?.pubKey || '';
  }
  const lists = await Promise.all([
    safe(rayList('new'), []),
    safe(rayList('lastTrade'), []),
    ...[platformId, ...platforms].filter(Boolean).map((p) => safe(rayPlatform(p), [])),
  ]);
  for (const r of lists.flat()) ctx.rows.set(r.mint, r);

  // LaunchLab coins built on something other than SOL / stables
  const llBuilt = [...ctx.rows.values()]
    .filter((r) => r.mintB?.address && !GROUND.has(r.mintB.address))
    .sort((x, y) => (Number(y.marketCap) || 0) - (Number(x.marketCap) || 0));
  const stackCoins = platformId ? [...ctx.rows.values()].filter((r) => r.platformInfo?.pubKey === platformId) : [];
  const cands = new Set([...featured, ...stackCoins.map((r) => r.mint), ...llBuilt.slice(0, 30).map((r) => r.mint)]);

  // walk upward from known bases: coins whose Raydium pool is paired against them
  let level = [...new Set(seeds)];
  for (let d = 0; d < 3 && level.length; d++) {
    await ensurePairs(ctx, level);
    const next = [];
    for (const m of level) {
      const kids = pairsOf(ctx, m)
        .filter((p) => p.quoteToken?.address === m && p.baseToken?.address !== m && p.dexId === 'raydium' && liq(p) >= MIN_CHILD_LIQ)
        .sort(byLiq)
        .slice(0, d === 0 ? 14 : 5);
      for (const p of kids) {
        cands.add(p.baseToken.address);
        next.push(p.baseToken.address);
      }
    }
    level = [...new Set(next)].slice(0, 14);
  }

  await resolveAll(ctx, [...cands]);

  const all = [];
  for (const m of cands) {
    const c = chainFrom(ctx, m);
    if (c && c.length >= 3) all.push(towerFromChain(ctx, c));
  }
  const alive = all.filter((t) => (t.layers[t.layers.length - 1].locked || 0) >= MIN_TOP_LOCKED || t.layers[t.layers.length - 1].platform === platformId);
  const inner = new Set();
  alive.forEach((t) => t.layers.slice(1, -1).forEach((l) => inner.add(l.mint)));
  const seen = new Set();
  const towers = alive.filter((t) => !inner.has(t.id) && (seen.has(t.id) ? false : seen.add(t.id)));

  const floors = new Map();
  towers.forEach((t) => t.layers.forEach((l) => l.level > 0 && floors.set(l.mint, l.locked || 0)));
  const tallest = [...towers].sort(byHeight)[0] || null;

  return {
    updatedAt: Date.now(),
    solUsd: ctx.solUsd,
    platformId: platformId || null,
    towers,
    stats: {
      towers: towers.length,
      tallest: tallest ? { id: tallest.id, top: tallest.top, height: tallest.height } : null,
      valueLocked: [...floors.values()].reduce((s, v) => s + v, 0),
    },
  };
}

export async function towerFor(mint) {
  const ctx = createCtx();
  if (GROUND.has(mint)) {
    return { tower: { id: mint, top: GROUND.get(mint), height: 1, layers: [{ level: 0, mint, symbol: GROUND.get(mint), ground: true }], totalLocked: 0 } };
  }
  await resolveAll(ctx, [mint]);
  const c = chainFrom(ctx, mint);
  if (!c) return { tower: null };
  return { tower: towerFromChain(ctx, c), solUsd: ctx.solUsd };
}

// ---------- last buy ----------
async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(6000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// Read one transaction: what the signer paid, how much of the top coin they got, and how many floors it touched.
export async function readBuy(rpcUrl, sig, topMint, floorMints) {
  const tx = await rpc(rpcUrl, 'getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const signer = keys[0];
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const bal = (list, mint, owner) =>
    list.filter((b) => b.mint === mint && (!owner || b.owner === owner)).reduce((s, b) => s + (Number(b.uiTokenAmount?.uiAmount) || 0), 0);
  const got = bal(post, topMint, signer) - bal(pre, topMint, signer);
  if (!(got > 0)) return null;
  const lamports = (tx.meta.preBalances[0] - tx.meta.postBalances[0] - (tx.meta.fee || 0)) / 1e9;
  const wsol = bal(pre, SOL, signer) - bal(post, SOL, signer);
  const solSpent = Math.max(0, lamports) + Math.max(0, wsol);
  const touched = floorMints.filter((m) => {
    const owners = new Set([...pre, ...post].filter((b) => b.mint === m).map((b) => b.owner));
    return [...owners].some((o) => Math.abs(bal(post, m, o) - bal(pre, m, o)) > 0);
  });
  let pay = null;
  if (solSpent > 0.0005) pay = { amount: solSpent, symbol: 'SOL' };
  else {
    let best = null;
    for (const m of floorMints) {
      if (m === topMint) continue;
      const d = bal(pre, m, signer) - bal(post, m, signer);
      if (d > 0 && (!best || d > best.amount)) best = { amount: d, mint: m };
    }
    if (best) pay = best;
  }
  return { txid: sig, at: (tx.blockTime || 0) * 1000, got, pay, layers: touched.length, verified: true };
}

export async function lastBuy(topMint, rpcUrl) {
  const ctx = createCtx();
  await resolveAll(ctx, [topMint]);
  const chain = chainFrom(ctx, topMint);
  const base = ctx.base.get(topMint);
  const info = floorInfo(ctx, topMint, base);
  const floorMints = chain ? chain.slice(0, -1) : [topMint];
  const symOf = (m) => (GROUND.get(m) || ctx.rows.get(m)?.symbol || pairsOf(ctx, m).find((p) => p.baseToken?.address === m)?.baseToken?.symbol || '?');
  let buy = null;

  // coins still on the LaunchLab curve: Raydium's own trade feed
  if (info.launchlab && !info.graduated && info.poolId) {
    const t = (await safe(rayTrades(info.poolId, 20), [])).find((x) => x.side === 'buy');
    if (t) buy = { txid: t.txid, at: t.blockTime * 1000, got: t.amountA, pay: { amount: t.amountB, mint: base }, layers: null, verified: false };
  }
  // graduated coins: read the pool's latest transactions
  if (rpcUrl) {
    try {
      if (!buy && info.pair) {
        const sigs = await rpc(rpcUrl, 'getSignaturesForAddress', [info.pair, { limit: 8 }]);
        for (const s of (sigs || []).filter((x) => !x.err).slice(0, 5)) {
          const b = await readBuy(rpcUrl, s.signature, topMint, floorMints);
          if (b) { buy = b; break; }
        }
      } else if (buy && !buy.verified) {
        const b = await readBuy(rpcUrl, buy.txid, topMint, floorMints);
        if (b) buy = { ...buy, ...b };
      }
    } catch { /* RPC unavailable — fall back to buy counts */ }
  }
  if (buy?.pay?.mint) buy.pay.symbol = symOf(buy.pay.mint);
  if (buy?.pay && buy.pay.symbol !== 'SOL') {
    const usd = usdPrice(ctx, buy.pay.mint);
    if (usd && ctx.solUsd) buy.pay.sol = (buy.pay.amount * usd) / ctx.solUsd;
  }
  return {
    top: info.symbol,
    base: symOf(base),
    height: chain ? chain.length : null,
    buy,
    counts: { h1: info.buysH1, m5: info.buysM5 },
    at: Date.now(),
  };
}
