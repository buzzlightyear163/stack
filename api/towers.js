import { discoverTowers } from './_lib.js';
import { SEEDS, FEATURED, PLATFORM_ID, PLATFORMS, STACK_MINT } from './_config.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const data = await discoverTowers({ seeds: [STACK_MINT, ...SEEDS], featured: FEATURED, platformId: PLATFORM_ID, platforms: PLATFORMS, stackMint: STACK_MINT });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=10');
    res.status(502).json({ error: 'towers_unavailable', message: String(e?.message || e) });
  }
}
