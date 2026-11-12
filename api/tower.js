import { towerFor, isMint } from './_lib.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  const mint = String(req.query.mint || '').trim();
  if (!isMint(mint)) return res.status(400).json({ error: 'bad_mint' });
  try {
    const data = await towerFor(mint);
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(data.tower ? 200 : 404).json(data);
  } catch (e) {
    res.status(502).json({ error: 'tower_unavailable', message: String(e?.message || e) });
  }
}
