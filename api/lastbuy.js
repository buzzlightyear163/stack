import { lastBuy, isMint } from './_lib.js';
import { RPC_URL } from './_config.js';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  const mint = String(req.query.mint || '').trim();
  if (!isMint(mint)) return res.status(400).json({ error: 'bad_mint' });
  try {
    const data = await lastBuy(mint, RPC_URL);
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=20');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'lastbuy_unavailable', message: String(e?.message || e) });
  }
}
