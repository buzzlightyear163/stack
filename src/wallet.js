// Minimal Solana wallet connect (Phantom / Solflare / Backpack — anything that injects window.solana-style providers)
let pubkey = null;
let buttons = [];

function provider() {
  return window.phantom?.solana || window.solflare || window.backpack || window.solana || null;
}

function paint() {
  const label = pubkey ? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}` : 'Connect wallet';
  buttons.forEach((b) => {
    b.textContent = label;
    b.classList.toggle('is-connected', !!pubkey);
    b.title = pubkey ? 'Click to disconnect' : '';
  });
}

export const getWallet = () => pubkey;

export async function connectWallet() {
  const p = provider();
  if (!p) {
    window.open('https://phantom.app/', '_blank', 'noopener');
    return null;
  }
  try {
    const r = await p.connect();
    pubkey = (r?.publicKey || p.publicKey)?.toString() || null;
  } catch {
    pubkey = null;
  }
  paint();
  return pubkey;
}

async function disconnect() {
  try { await provider()?.disconnect?.(); } catch { /* ignore */ }
  pubkey = null;
  paint();
}

export function initWallet(nodes) {
  buttons = [...nodes];
  buttons.forEach((b) => b.addEventListener('click', () => (pubkey ? disconnect() : connectWallet())));
  const p = provider();
  // reconnect silently if the wallet already trusts the site
  p?.connect?.({ onlyIfTrusted: true }).then((r) => {
    pubkey = (r?.publicKey || p.publicKey)?.toString() || null;
    paint();
  }).catch(() => {});
}
