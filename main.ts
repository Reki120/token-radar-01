// Token Radar — a program that ranks pre-token protocols by implied launch value.
//
// Run it (Node 22+, standard library only):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//
// It reads the sealed DefiLlama snapshot, scores every protocol that records no
// token, writes the ranked board to /output/board.json, writes the dashboard's
// data beside the page as /output/data.js, copies dashboard/ and screenshots/ to
// /output, and writes /output/dossier.json with the vendored make.fun library.
//
// THE MODEL (everything below is derived from the snapshot's own figures; no
// protocol name is ever hardcoded, and nothing is fetched from the network):
//
//   implied = TVL x categoryMultiple x growth x age x breadth x 0.80
//
//   categoryMultiple — the median mcap/TVL of the protocols in the same category
//     whose token already trades (at least 3 such protocols, else the global
//     median over all live tokens). Each live ratio is first capped at the 90th
//     percentile of all live ratios, so one micro-TVL token with a huge market
//     cap (one live prediction market sits at 400x) cannot set a category's
//     multiple. A lending protocol is priced like lending protocols, not like
//     a bridge.
//   growth — 1 + clamp(change_7d, -50, +200) / 200, so a protocol growing 20%
//     in a week scores 1.10 and one shrinking 20% scores 0.90; missing data is 1.
//   age — 1 + 0.12 x min(years listed with no token, 4). A protocol that has run
//     for years without issuing a token has more value waiting on a launch.
//   breadth — 1 + 0.04 x ln(number of chains). More chains, more surface.
//   0.80 — a pre-token discount: no circulating supply exists yet, so the launch
//     is worth less than the same TVL with a token already trading.
//
// ELIGIBILITY (the house's own pre-token test, from the snapshot guide, minus
// the TVL floor): a protocol is ranked only if it records no token AND is not a
// product of a token that already trades — its category is not Bridge, Canonical
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name does
// not start with an exchange's name, carries no whole word wrapped/staked/
// staking, and does not end in a version marker. The 144 protocols that fail
// the test (Bybit, WBTC, Binance staked ETH, …) are set aside with their reason,
// listed in data.js, never ranked: a centralised exchange is not a launch.
// The board is the complete eligible set (198 here), not a top-N cut.
//
// The board holds EVERY protocol that records no token (342 in this snapshot),
// not a top-N cut: the watchlist's 40 are the floor, the other 302 are the early
// finds the radar exists to surface. Protocols whose token already trades are
// never ranked; the strongest of them are listed in data.js as the live
// comparators the multiples were calibrated from, so a reader can check the math.
//
// Farm plans are built from the protocol's own record — its category, its chains,
// its TVL band — never from a list of names. Every step names the protocol, the
// chain, a concrete action, a size and a cost, and the last step states plainly
// that a launch is never guaranteed.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// --- small helpers ---------------------------------------------------------

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// --- snapshot ---------------------------------------------------------------

interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as Snap;
if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) fail('snapshot has no protocols/watchlist arrays');
const AS_OF = new Date(`${snap.as_of}T00:00:00Z`).getTime();
const hasToken = (p: Proto): boolean => p.gecko_id !== null || p.symbol !== null;
const preToken = snap.protocols.filter((p) => !hasToken(p));
const watch = new Set(snap.watchlist);

// A protocol that records no token can still be a product of one that trades.
// The house's pre-token test, checkable from the snapshot's own fields:
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
function exclusionReason(p: Proto): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category} — a product of a token that already trades`;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'named after an exchange whose token already trades';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product of a token that already trades';
  if (VERSION_TAIL.test(p.name)) return 'a versioned build of a protocol, not a fresh launch';
  return null;
}
const eligible = preToken.filter((p) => exclusionReason(p) === null);
const setAside = preToken
  .filter((p) => exclusionReason(p) !== null)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p)! }))
  .sort((a, b) => b.tvl_usd - a.tvl_usd);

// --- calibration: live mcap/TVL medians ------------------------------------

const live = snap.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
const liveRatios = live.map((p) => p.mcap_usd! / p.tvl_usd);
// Cap every live ratio at the 90th percentile of live ratios: a token with a
// few million of TVL and a billion-dollar market cap is an outlier, not a
// pricing rule. The cap is read off the snapshot, never hardcoded.
function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
}
const RATIO_CAP = percentile(liveRatios, 0.9);
const capped = (r: number): number => Math.min(r, RATIO_CAP);
const GLOBAL_MULT = median(liveRatios.map(capped));

const byCategory = new Map<string, number[]>();
for (const p of live) {
  const key = (p.category ?? 'Uncategorised').toLowerCase();
  const arr = byCategory.get(key) ?? [];
  arr.push(capped(p.mcap_usd! / p.tvl_usd));
  byCategory.set(key, arr);
}
function categoryMultiple(cat: string | null): { mult: number; n: number; pooled: boolean } {
  const arr = byCategory.get((cat ?? 'Uncategorised').toLowerCase());
  if (arr !== undefined && arr.length >= 3) return { mult: median(arr), n: arr.length, pooled: false };
  return { mult: GLOBAL_MULT, n: arr?.length ?? 0, pooled: true };
}

// --- scoring ----------------------------------------------------------------

interface Factors { base: number; catMult: number; growth: number; age: number; breadth: number; discount: number }
interface Scored {
  p: Proto; value: number; factors: Factors; ageYrs: number | null; amount: string; weeks: number;
}

function ageYears(p: Proto): number | null {
  if (!p.listed_at) return null;
  const t = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  if (!Number.isFinite(t) || t > AS_OF) return null;
  return (AS_OF - t) / (365.25 * 24 * 3600 * 1000);
}

function score(p: Proto): Scored {
  const cal = categoryMultiple(p.category);
  const growth = 1 + clamp(p.change_7d ?? 0, -50, 200) / 200;
  const yrs = ageYears(p);
  const age = 1 + 0.12 * Math.min(yrs ?? 0, 4);
  const breadth = 1 + 0.04 * Math.log(Math.max(1, p.chains.length));
  const discount = 0.8;
  const base = p.tvl_usd * cal.mult;
  const value = Math.max(1, Math.round(base * growth * age * breadth * discount));
  const amount = p.tvl_usd >= 5e8 ? '$500–$2,000' : p.tvl_usd >= 1e8 ? '$200–$1,000' : p.tvl_usd >= 2.5e7 ? '$100–$500' : '$50–$300';
  const weeks = (yrs ?? 0) >= 2 ? 8 : 6;
  return { p, value, factors: { base, catMult: cal.mult, growth, age, breadth, discount }, ageYrs: yrs, amount, weeks };
}

// --- farm plans: built from category, chains and TVL band -------------------

interface Play { core: string; detail: string; again: string; second: string }
const PLAYS: [string, Play][] = [
  ['dex', { core: 'Swap on', detail: 'swap a major pair, then provide liquidity to one of its pools', again: 'swap a different pair each week', second: 'provide liquidity to a second pool' }],
  ['lend', { core: 'Supply collateral to', detail: 'supply collateral and borrow a small amount against it', again: 'top up the collateral or adjust the borrow', second: 'supply on a second market the protocol lists' }],
  ['bridge', { core: 'Bridge assets with', detail: 'bridge a modest amount between two chains it supports', again: 'bridge back the other way in a later week', second: 'bridge a different asset' }],
  ['liquid staking', { core: 'Stake with', detail: 'stake and hold the receipt token it issues', again: 'stake a little more or restake the rewards', second: 'use the receipt token in a lending market' }],
  ['liquid restaking', { core: 'Restake with', detail: 'restake and hold the receipt token it issues', again: 'restake a little more each week', second: 'use the receipt token in a lending market' }],
  ['restaked', { core: 'Restake with', detail: 'restake and hold the receipt token it issues', again: 'restake a little more each week', second: 'use the receipt token in a lending market' }],
  ['yield', { core: 'Deposit into', detail: 'deposit into its highest-TVL vault', again: 'move part of the deposit to a second vault', second: 'harvest or compound the rewards weekly' }],
  ['rwa', { core: 'Use', detail: 'open a tokenised position through its app', again: 'add a second, smaller position', second: 'read the redemption terms before adding more' }],
  ['derivat', { core: 'Trade on', detail: 'open a small perpetual or options position', again: 'close and reopen with a different size', second: 'try a second market it lists' }],
  ['cdp', { core: 'Open a vault on', detail: 'lock collateral and mint a small amount of its stable asset', again: 'adjust the collateral ratio', second: 'repay part of the debt, then mint again' }],
  ['basis', { core: 'Trade on', detail: 'open a small basis position through its app', again: 'roll the position into the next week', second: 'try a second market it lists' }],
  ['farm', { core: 'Farm on', detail: 'deposit into its highest-TVL farm', again: 'move part of the deposit to a second farm', second: 'harvest or compound the rewards weekly' }],
];
const DEFAULT_PLAY: Play = { core: 'Use', detail: 'make a real transaction through its app — deposit, swap or stake, whichever it offers', again: 'repeat the core action with a different amount', second: 'try a second feature inside the app' };

function playFor(cat: string | null): Play {
  const c = (cat ?? '').toLowerCase();
  for (const [key, play] of PLAYS) if (c.includes(key)) return play;
  return DEFAULT_PLAY;
}

function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'on Ethereum mainnet a single transaction often costs $2–$15 in gas, so batch your actions and avoid peak hours';
  if (c === 'solana') return 'on Solana transactions usually cost a few cents, so small weekly actions stay cheap';
  if (c === 'tron') return 'on Tron transactions need bandwidth or energy, so budget a few TRX or freeze TRX for energy first';
  if (['base', 'arbitrum', 'optimism', 'zksync', 'polygon', 'bsc', 'binance', 'avalanche', 'ink', 'linea', 'scroll', 'blast', 'mode'].includes(c)) {
    return `on ${chain} transactions usually cost under $0.50, so small weekly actions stay cheap`;
  }
  return `check the current gas fee on ${chain} before each transaction and keep a little of its native token aside for fees`;
}

function farmSteps(s: Scored): string[] {
  const p = s.p;
  const play = playFor(p.category);
  const chain1 = p.chains[0] ?? 'its main chain';
  const chain2 = p.chains[1] ?? null;
  const cat = p.category ?? 'DeFi';
  const steps: string[] = [
    `${play.core} ${p.name} on ${chain1}: ${play.detail} with ${s.amount}. Do it from one wallet you control and keep the position open at least a week, so the activity is visible on-chain.`,
    `Come back to ${p.name} at least once a week for ${s.weeks} weeks and ${play.again}. ${cat} protocols reward repeat users over one-off visitors, so spread the activity instead of doing it all in one day.`,
    chain2 !== null
      ? `Use ${p.name} on ${chain2} as well and ${play.second}. A second chain shows breadth and can double the surface a future snapshot sees.`
      : `Try a second feature of ${p.name} and ${play.second}, so your wallet touches more than the one obvious action.`,
    `Check ${p.name}'s own docs and app for a points, quest or leaderboard page. If one exists, connect the same wallet, finish its listed tasks and track your points weekly; if there is no such page, skip this step rather than chasing rumours.`,
    `Budget gas: ${gasNote(chain1)}. Never deposit more than you can afford to lose, keep a record of every transaction hash, and know how to unwind the position — ${p.name} records no token, so a launch is never guaranteed and farming may pay nothing.`,
  ];
  for (const step of steps) {
    const n = step.trim().length;
    if (n < 20 || n > 600) fail(`farm step for ${p.slug} is ${n} chars (must be 20–600): ${step.slice(0, 80)}`);
  }
  return steps;
}

// --- build the board ---------------------------------------------------------

const scored = eligible.map(score).sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : 1));
const board = scored.map((s, i) => ({
  slug: s.p.slug,
  name: s.p.name,
  rank: i + 1,
  implied_value_usd: s.value,
  farm_steps: farmSteps(s),
}));

// Gate self-checks, before anything is written.
if (board.length < 100 || board.length > 4000) fail(`board has ${board.length} rows (gate wants 100–4000)`);
for (const slug of snap.watchlist) {
  if (!board.some((r) => r.slug === slug)) fail(`watchlist slug ${slug} is missing from the board`);
}
for (let i = 1; i < board.length; i++) {
  if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) fail('board is not sorted by implied value');
}
if (new Set(board.map((r) => r.slug)).size !== board.length) fail('duplicate slug on the board');

// Live comparators: the strongest tokens already trading, so the reader can
// check the multiples the model calibrated from.
const liveTop = [...live]
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
  .slice(0, 12)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd! / p.tvl_usd }));

const radar = {
  meta: {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    protocols: snap.protocols.length,
    pre_token: preToken.length,
    eligible: eligible.length,
    set_aside: setAside.length,
    watchlist: snap.watchlist.length,
    global_multiple: GLOBAL_MULT,
    ratio_cap: Math.round(RATIO_CAP * 1000) / 1000,
    rows: board.length,
  },
  model: {
    formula: 'implied = TVL x categoryMultiple x growth x age x breadth x 0.80',
    categoryMultiple: 'Median mcap/TVL of live tokens in the same category (3+ live protocols), else the global median; each live ratio is capped at the 90th percentile of live ratios so one outlier cannot set a category.',
    growth: '1 + clamp(change_7d, -50, +200) / 200; missing data counts as 1.',
    age: '1 + 0.12 x min(years listed with no token, 4).',
    breadth: '1 + 0.04 x ln(number of chains).',
    discount: '0.80 pre-token discount: no circulating supply exists yet.',
    note: 'Every figure comes from the sealed snapshot. No protocol name is hardcoded and nothing is fetched. "Records no token" means DefiLlama records none — it is not proof a token does not exist.',
  },
  live: liveTop,
  set_aside: setAside.slice(0, 40),
  rows: scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    value: s.value,
    tvl: s.p.tvl_usd,
    category: s.p.category,
    chains: s.p.chains,
    chainCount: s.p.chains.length,
    change: s.p.change_7d,
    age: s.ageYrs === null ? null : Math.round(s.ageYrs * 10) / 10,
    watchlist: watch.has(s.p.slug),
    factors: {
      base: Math.round(s.factors.base),
      catMult: Math.round(s.factors.catMult * 1000) / 1000,
      growth: Math.round(s.factors.growth * 1000) / 1000,
      ageF: Math.round(s.factors.age * 1000) / 1000,
      breadth: Math.round(s.factors.breadth * 1000) / 1000,
    },
    steps: board[i]!.farm_steps,
  })),
};

// --- write the outputs -------------------------------------------------------

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view`);
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: bad name`);

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${preToken.length} pre-token, ${eligible.length} eligible, ${setAside.length} set aside, ${snap.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `token radar: rank 1 ${board[0]!.slug} ${money(board[0]!.implied_value_usd)}, rank ${board.length} ${board[board.length - 1]!.slug} ${money(board[board.length - 1]!.implied_value_usd)}\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard, ${shots.length} screenshots and dossier.json\n`,
);
