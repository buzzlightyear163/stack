// Coins to look for floors on top of (people already stack by hand on StonkFun)
export const SEEDS = [
  '5wsjHxT5nW5jQuVupXUNnYszF3WoWCfGGk9LMcsCJzY8', // STANK
];
// Other LaunchLab platforms where coins get paired against coins (StonkFun configs)
export const PLATFORMS = [
  '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7',
  '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt',
];
// Always traced, even if they fall out of the latest lists
export const FEATURED = ['H3gXgvf2kza3vz3WhP3KoKdprhiu7oW6Q1ARXLy5Erhf'];
// STACK's own LaunchLab platform config (platformInfo.pubKey) — fill in when it exists
export const PLATFORM_ID = process.env.STACK_PLATFORM_ID || '';
export const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
