// Token Radar v4 — a token-launch radar for the make.fun token-radar-01 bounty.
//
// The value model, stated in full on the dashboard:
//   1. SIZE CURVE, fitted on this snapshot. log10(market cap) = A + B * log10(TVL),
//      ordinary least squares on the traded comps that carry a listing date
//      (95 of the 128 traded comps; the same set the time-split test uses).
//      A small protocol is not worth a flat multiple of its TVL: value grows
//      sub-linearly with size (B is near 0.46, not 1).
//   2. CATEGORY EFFECT. Each category's mean log-residual from the curve,
//      shrunk toward zero with 4 pseudo-comps; categories with fewer than
//      2 traded comps get no effect. A category is never a hardcoded list
//      of names: it is measured from the snapshot's own traded comps.
//   3. GROWTH. 1 + 0.5 * (7-day TVL change), clamped to 0.60..1.60.
//      No growth figure reported means no tilt (factor 1).
//   4. BREADTH. +3% per extra chain, at most 4 extra chains.
//   5. NO SEASONING. An age factor was tested on the time split and dropped:
//      it did not improve out-of-sample misses, so age is shown (days with
//      no token) but never priced.
//   6. IMPLIED VALUE IS A BAND. The point value is the curve's estimate;
//      the band is P25..P75 of the leave-one-out residuals, so the board
//      shows how wide the honest range is instead of pretending precision.
//   7. FARM VERDICTS ARE NETTED TO DOLLARS on a $1,000 plan: the $1,000
//      slice is your share of TVL times the implied value times the
//      community's share of a launch — about 10% of supply is what
//      airdrops typically put to the community, so a farmer's slice is
//      their pro-rata share of that 10%, not of the whole value. Costs:
//      gas is $3 per chain the plan actually farms (the main chain and
//      one more, at most 2), protocol fees are 0.3% of the plan, and the
//      FARM means the plan clears $10 net and $5 per hands-on hour; THIN
//      means it clears $0; otherwise SKIP.
//
// The board ranks pre-token protocols (no token recorded) outside the
// set-aside groups: exchanges, bridges, liquid staking / restaking,
// CDP and stablecoin issuers, versioned names and wrapped / staked
// products. Every watchlist protocol is on the board.
//
// Node 22, standard library only. Reads the snapshot, writes board.json,
// dashboard/data.js, copies dashboard/ and screenshots/ to the output
// directory, and writes dossier.json with buildDossier.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

type Json = Record<string, unknown>;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  mcap: number | null;
  listedAt: string | null;
  hasToken: boolean;
}

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  band_lo_usd: number;
  band_hi_usd: number;
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  slice_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  watchlist: boolean;
  days_no_token: number | null;
}

// --- model constants (stated on the dashboard, not tuned per protocol) ---
const SHRINK_PSEUDO = 4; // pseudo-comps shrinking each category effect to zero
const GROWTH_HALF = 0.5; // half the 7-day TVL change flows into value
const GROWTH_LO = 0.6;
const GROWTH_HI = 1.6;
const BREADTH_PER_CHAIN = 0.03;
const BREADTH_MAX_CHAINS = 4;
const PLAN_USD = 1000; // the farm plan every verdict is netted on
const CAPTURE_RATE = 0.1; // about 10% of a launch's supply typically goes to the community
const GAS_PER_CHAIN_USD = 3;
const FARM_CHAINS_MAX = 2; // the plan farms the main chain and one more, at most
const FEE_RATE = 0.003; // 0.3% of the plan
const TBILL_RATE = 0.04; // 4% a year, forgone while farming
const FARM_DAYS = 90;
const FARM_NET_MIN = 10; // dollars net to call a farm worth doing
const FARM_PER_HOUR_MIN = 5; // dollars per hands-on hour
const MAX_IMPLIED_USD = 100_000_000_000_000;

// Categories whose tokens, if they existed, would not be a launch to farm:
// exchanges, bridges, liquid staking / restaking, CDPs and stablecoins.
const SET_ASIDE = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
  'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CDP',
  'Algo-Stables', 'Stablecoin Issuer', 'Stablecoin Wrapper',
  'Dual-Token Stablecoin', 'Reserve Currency', 'Staking Pool', 'Token Locker',
]);

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

function isSetAside(p: Protocol): boolean {
  if (p.category !== null && SET_ASIDE.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_LEAD.test(p.name)) return true;
  return false;
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = process.env.MAKEFUN_INPUT ?? '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i];
  }
  return { input, output };
}

function toProtocol(raw: Json): Protocol | null {
  const slug = typeof raw.slug === 'string' ? raw.slug : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  const tvl = typeof raw.tvl_usd === 'number' ? raw.tvl_usd : NaN;
  if (!slug || !name || !Number.isFinite(tvl)) return null;
  const chains = Array.isArray(raw.chains)
    ? (raw.chains as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const change = typeof raw.change_7d === 'number' ? raw.change_7d : null;
  const mcap = typeof raw.mcap_usd === 'number' ? raw.mcap_usd : null;
  return {
    slug,
    name,
    category: typeof raw.category === 'string' ? raw.category : null,
    chains,
    tvl,
    change7d: change,
    mcap,
    listedAt: typeof raw.listed_at === 'string' ? raw.listed_at : null,
    hasToken: raw.gecko_id != null || raw.symbol != null,
  };
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function categoryEffects(comps: Protocol[], a: number, b: number): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Unknown';
    const r = Math.log10(p.mcap as number) - (a + b * Math.log10(p.tvl));
    const list = byCat.get(key) ?? [];
    list.push(r);
    byCat.set(key, list);
  }
  const eff = new Map<string, number>();
  for (const [key, rs] of byCat) {
    if (rs.length < 2) {
      eff.set(key, 0);
    } else {
      const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
      eff.set(key, (rs.length / (rs.length + SHRINK_PSEUDO)) * mean);
    }
  }
  return eff;
}

function growthFactor(p: Protocol): number {
  if (p.change7d === null) return 1;
  return Math.min(GROWTH_HI, Math.max(GROWTH_LO, 1 + GROWTH_HALF * (p.change7d / 100)));
}

function breadthFactor(p: Protocol): number {
  return 1 + BREADTH_PER_CHAIN * Math.min(Math.max(p.chains.length - 1, 0), BREADTH_MAX_CHAINS);
}

function curveValue(p: Protocol, a: number, b: number, eff: Map<string, number>): number {
  if (p.tvl <= 0) return 0;
  const base = 10 ** (a + b * Math.log10(p.tvl));
  const cat = eff.get(p.category ?? 'Unknown') ?? 0;
  return base * 10 ** cat * growthFactor(p) * breadthFactor(p);
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000);
}

function farmSteps(p: Protocol, verdict: string): string[] {
  const first = p.chains[0] ?? 'its main chain';
  const second = p.chains[1] ?? first;
  const cat = (p.category ?? 'protocol').toLowerCase();
  return [
    `Bridge $${PLAN_USD} to ${first} and hold it in a wallet you control, so the funds are ready to use on ${p.name} without a second bridge.`,
    `Deposit the $${PLAN_USD} into ${p.name} on ${first} through its ${cat} pools, keeping the position open for the full ${FARM_DAYS}-day farm.`,
    `Use the position at least weekly on ${p.name}: add or adjust a small amount each week so the activity is steady rather than a single deposit.`,
    `If ${p.name} runs on a second chain, repeat a smaller deposit on ${second} as well, since activity on more than one chain is part of how this farm is read.`,
    `Track the position weekly, note any points or quests ${p.name} announces, and exit only after the ${FARM_DAYS}-day window, because leaving early cuts the farm short.`,
  ];
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const root = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(input, 'utf8')) as Json;
  const snapProtocols = Array.isArray(raw.protocols) ? raw.protocols : [];
  const watchlist: string[] = Array.isArray(raw.watchlist)
    ? (raw.watchlist as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const asOf = typeof raw.as_of === 'string' ? raw.as_of : '2026-11-14';
  const protocols: Protocol[] = [];
  const seenSlugs = new Set<string>();
  for (const item of snapProtocols) {
    if (item !== null && typeof item === 'object') {
      const p = toProtocol(item as Json);
      if (p && !seenSlugs.has(p.slug)) {
        seenSlugs.add(p.slug);
        protocols.push(p);
      }
    }
  }
  if (protocols.length === 0) throw new Error('snapshot holds no usable protocols');

  // --- fit: traded comps that carry a listing date (the time-split set).
  // If a snapshot carried too few dated comps to fit, fall back to all
  // traded comps rather than failing: the curve is the same fit, only the
  // set is wider. (The sealed snapshot has 95 dated comps, so the
  // fallback never fires on the real data.)
  const traded = protocols.filter((p) => p.mcap !== null && (p.mcap as number) > 0 && p.tvl > 0);
  let comps = traded.filter((p) => p.listedAt !== null);
  let fitFallback = false;
  if (comps.length < 10) {
    comps = traded;
    fitFallback = true;
  }
  if (comps.length < 10) throw new Error(`too few traded comps to fit: ${comps.length}`);
  const fit = ols(
    comps.map((p) => Math.log10(p.tvl)),
    comps.map((p) => Math.log10(p.mcap as number)),
  );
  const eff = categoryEffects(comps, fit.a, fit.b);
  const flat = median(comps.map((p) => (p.mcap as number) / p.tvl));

  // --- leave-one-out: refit without each comp, collect signed log residuals ---
  const looResiduals: number[] = [];
  const looMiss: number[] = [];
  const looFlatMiss: number[] = [];
  for (let i = 0; i < comps.length; i += 1) {
    const rest = comps.filter((_, j) => j !== i);
    const f = ols(
      rest.map((p) => Math.log10(p.tvl)),
      rest.map((p) => Math.log10(p.mcap as number)),
    );
    const e = categoryEffects(rest, f.a, f.b);
    const pred = curveValue(comps[i], f.a, f.b, e);
    const actual = comps[i].mcap as number;
    looResiduals.push(Math.log10(actual / pred));
    looMiss.push(10 ** Math.abs(Math.log10(pred / actual)));
    looFlatMiss.push(10 ** Math.abs(Math.log10((flat * comps[i].tvl) / actual)));
  }
  const looSorted = [...looResiduals].sort((x, y) => x - y);
  const bandLoFactor = 10 ** quantile(looSorted, 0.25);
  const bandHiFactor = 10 ** quantile(looSorted, 0.75);
  const looMedian = median(looMiss);
  const looFlatMedian = median(looFlatMiss);
  const looWithin3 = looMiss.filter((x) => x <= 3).length / looMiss.length;
  const looFlatWithin3 = looFlatMiss.filter((x) => x <= 3).length / looFlatMiss.length;

  // --- time split: fit on listings before 2024, test on listings from 2024 ---
  const train = comps.filter((p) => (p.listedAt as string) < '2024-01-01');
  const test = comps.filter((p) => (p.listedAt as string) >= '2024-01-01');
  let splitCurve = NaN;
  let splitFlat = NaN;
  if (train.length >= 10 && test.length >= 5) {
    const tf = ols(
      train.map((p) => Math.log10(p.tvl)),
      train.map((p) => Math.log10(p.mcap as number)),
    );
    const te = categoryEffects(train, tf.a, tf.b);
    const flatTrain = median(train.map((p) => (p.mcap as number) / p.tvl));
    splitCurve = median(
      test.map((p) => 10 ** Math.abs(Math.log10(curveValue(p, tf.a, tf.b, te) / (p.mcap as number)))),
    );
    splitFlat = median(
      test.map((p) => 10 ** Math.abs(Math.log10((flatTrain * p.tvl) / (p.mcap as number)))),
    );
  }

  // --- board: pre-token protocols outside the set-aside groups ---
  const watchSet = new Set(watchlist);
  const forgone = (PLAN_USD * TBILL_RATE * FARM_DAYS) / 365;
  const fee = PLAN_USD * FEE_RATE;
  // The watchlist is the floor, never the ceiling: every watchlist protocol
  // is board-eligible even when its category sits in the set-aside groups
  // (the watchlist's own rule only sets aside exchanges, bridges and
  // liquid staking / restaking, so e.g. a CDP on the watchlist stays on).
  const candidates = protocols.filter(
    (p) => !p.hasToken && (watchSet.has(p.slug) || !isSetAside(p)) && p.tvl > 0,
  );
  const rows: Row[] = [];
  for (const p of candidates) {
    const point = curveValue(p, fit.a, fit.b, eff);
    if (!(point > 0) || !Number.isFinite(point)) continue;
    const value = Math.min(MAX_IMPLIED_USD, Math.max(1, Math.round(point)));
    const slice = (PLAN_USD * value * CAPTURE_RATE) / p.tvl;
    const gas = GAS_PER_CHAIN_USD * Math.min(p.chains.length, FARM_CHAINS_MAX);
    const net = slice - gas - fee - forgone;
    const hours = 1 + 0.5 * Math.min(p.chains.length, FARM_CHAINS_MAX);
    const perHour = net / hours;
    const verdict: Row['verdict'] =
      net >= FARM_NET_MIN && perHour >= FARM_PER_HOUR_MIN ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      farm_steps: farmSteps(p, verdict),
      band_lo_usd: Math.max(1, Math.round(value * bandLoFactor)),
      band_hi_usd: Math.min(MAX_IMPLIED_USD, Math.round(value * bandHiFactor)),
      tvl_usd: p.tvl,
      change_7d: p.change7d,
      category: p.category,
      chains: p.chains,
      slice_usd: Math.round(slice * 100) / 100,
      net_usd: Math.round(net * 100) / 100,
      net_per_hour_usd: Math.round(perHour * 100) / 100,
      verdict,
      watchlist: watchSet.has(p.slug),
      days_no_token: p.listedAt ? daysBetween(p.listedAt, asOf) : null,
    });
  }
  rows.sort((x, y) => y.implied_value_usd - x.implied_value_usd || y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const missingWatch = watchlist.filter((s) => !rows.some((r) => r.slug === s));
  if (missingWatch.length > 0) throw new Error(`watchlist not covered: ${missingWatch.join(', ')}`);
  if (rows.length < 100) throw new Error(`board too small: ${rows.length} rows`);

  const counts = {
    farm: rows.filter((r) => r.verdict === 'FARM').length,
    thin: rows.filter((r) => r.verdict === 'THIN').length,
    skip: rows.filter((r) => r.verdict === 'SKIP').length,
  };
  const model = {
    curve_a: Math.round(fit.a * 1000) / 1000,
    curve_b: Math.round(fit.b * 1000) / 1000,
    comps_n: comps.length,
    fit_fallback_to_undated: fitFallback,
    flat_multiple: Math.round(flat * 10000) / 10000,
    band_lo_factor: Math.round(bandLoFactor * 100) / 100,
    band_hi_factor: Math.round(bandHiFactor * 100) / 100,
    loo_median_miss: Math.round(looMedian * 100) / 100,
    loo_flat_median_miss: Math.round(looFlatMedian * 100) / 100,
    loo_within_3x: Math.round(looWithin3 * 1000) / 1000,
    loo_flat_within_3x: Math.round(looFlatWithin3 * 1000) / 1000,
    split_train_n: train.length,
    split_test_n: test.length,
    split_curve_median_miss: Number.isFinite(splitCurve) ? Math.round(splitCurve * 100) / 100 : null,
    split_flat_median_miss: Number.isFinite(splitFlat) ? Math.round(splitFlat * 100) / 100 : null,
    as_of: asOf,
    capture_rate: CAPTURE_RATE,
    board_rows: rows.length,
    watchlist_covered: watchlist.length,
    verdicts: counts,
  };

  // --- write outputs ---
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows, model }, null, 2)}\n`, 'utf8');

  const dashSrc = join(root, 'dashboard');
  const dashOut = join(output, 'dashboard');
  if (!existsSync(join(dashSrc, 'index.html'))) throw new Error('dashboard/index.html missing from repo');
  cpSync(dashSrc, dashOut, { recursive: true });
  const dataLines = rows.map((r) =>
    JSON.stringify([
      r.rank, r.slug, r.name, r.category, r.chains.slice(0, 4), r.tvl_usd, r.change_7d,
      r.implied_value_usd, r.band_lo_usd, r.band_hi_usd, r.slice_usd, r.net_usd,
      r.net_per_hour_usd, r.verdict, r.watchlist ? 1 : 0, r.days_no_token,
    ]),
  );
  const scatter = comps.map((p) => [
    Math.round(Math.log10(p.tvl) * 1000) / 1000,
    Math.round(Math.log10(p.mcap as number) * 1000) / 1000,
  ]);
  const dataJs = [
    '// Board data, one compact row per line: [rank, slug, name, category, chains,',
    '// tvl_usd, change_7d, implied, band_lo, band_hi, slice, net, net_per_hour,',
    '// verdict, watchlist, days_no_token]. Farm steps are rendered from the',
    '// template in app.js using each row\'s own chains and category.',
    `window.RADAR_MODEL = ${JSON.stringify(model)};`,
    `window.RADAR_ROWS = [\n${dataLines.join(',\n')}\n];`,
    `window.RADAR_COMPS = ${JSON.stringify(scatter)};`,
    '',
  ].join('\n');
  writeFileSync(join(dashOut, 'data.js'), dataJs, 'utf8');

  const shotsSrc = join(root, 'screenshots');
  const shotsOut = join(output, 'screenshots');
  if (!existsSync(shotsSrc)) throw new Error('screenshots/ missing from repo');
  cpSync(shotsSrc, shotsOut, { recursive: true });

  writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65536 }), 'utf8');
  const top = rows[0];
  console.log(
    `token-radar v4: ${rows.length} rows, watchlist ${watchlist.length}/${watchlist.length}, ` +
      `curve log10(mcap) = ${model.curve_a} + ${model.curve_b} * log10(TVL) on ${comps.length} comps, ` +
      `LOO x${model.loo_median_miss} vs flat x${model.loo_flat_median_miss}, ` +
      `split x${model.split_curve_median_miss} vs flat x${model.split_flat_median_miss}, ` +
      `top ${top.slug} ${money(top.implied_value_usd)}, verdicts FARM ${counts.farm} / THIN ${counts.thin} / SKIP ${counts.skip}`,
  );
}

main();
