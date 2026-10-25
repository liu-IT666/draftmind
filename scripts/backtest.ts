/**
 * Backtests the recommender on historical pro drafts and optionally tunes the default weights.
 *
 *   npx vite-node scripts/backtest.ts -- [options]
 *
 *   --drafts FILE       drafts from pipeline/leaguepedia_drafts.py (default pipeline/data/drafts.json)
 *   --stats FILE        stats pack built only from games before the evaluated ones
 *                       (default pipeline/data/stats-train.json, see README)
 *   --from PATCH        evaluate games on this patch or later (default 26.17)
 *   --to PATCH          ... and on this patch or earlier
 *   --pools             give each team a hero pool derived from its drafts before --from
 *   --lookahead         re-rank picks with the opponent-reply search
 *   --tune              coordinate-descent the weights on the evaluated games and print them
 *   --weights JSON      evaluate with these weights (e.g. ones tuned on an earlier patch range)
 *   --json FILE         also write the metrics as JSON
 *
 * For every ban and pick in every evaluated game it asks the engine for a full ranking of the
 * acting team's options, with all earlier actions (and earlier games of the series under
 * fearless) applied, and records where the champion actually chosen landed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getOrder, newGame } from '../src/engine/rules';
import { DEFAULT_WEIGHTS, recommend, type ScoreContext, type Weights } from '../src/engine/scorer';
import type { Champion, FearlessMode, Game, Match, Role, StatsPack, Team, TeamId } from '../src/engine/types';
import { ROLES } from '../src/engine/types';

interface DraftSide {
  team: string;
  bans: (string | null)[];
  picks: string[];
  roles: (Role | null)[];
}
interface Draft {
  gameId: string;
  date: string;
  patch: string;
  tournament: string;
  firstPickSide: 'blue' | 'red';
  first: DraftSide;
  second: DraftSide;
  winner: 'first' | 'second' | null;
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const champions = JSON.parse(readFileSync('src/data/champions.json', 'utf8')).champions as Champion[];
const drafts = JSON.parse(readFileSync(opt('drafts', 'pipeline/data/drafts.json')!, 'utf8')).games as Draft[];
const stats = JSON.parse(readFileSync(opt('stats', 'pipeline/data/stats-train.json')!, 'utf8')) as StatsPack;

const patchKey = (p: string) => p.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
const from = patchKey(opt('from', '26.17')!);
const to = opt('to') ? patchKey(opt('to')!) : Infinity;
const inEval = (d: Draft) => d.patch && patchKey(d.patch) >= from && patchKey(d.patch) <= to;

/** Turns per-team ban/pick lists into the 20-step action log, given the tournament order. */
function actionsOf(d: Draft): (string | null)[] {
  const order = getOrder('tournament').steps;
  const idx = { F: { ban: 0, pick: 0 }, S: { ban: 0, pick: 0 } };
  return order.map((s) => {
    const side = s.team === 'F' ? d.first : d.second;
    const i = idx[s.team][s.type]++;
    return s.type === 'ban' ? side.bans[i] ?? null : side.picks[i];
  });
}

/** Series = games sharing a GameId apart from the trailing game number. */
function groupSeries(all: Draft[]): Draft[][] {
  const map = new Map<string, Draft[]>();
  for (const d of all) {
    const key = d.gameId.replace(/_\d+$/, '');
    map.set(key, [...(map.get(key) ?? []), d]);
  }
  return [...map.values()].map((g) => g.sort((a, b) => a.date.localeCompare(b.date)));
}

/** Hard fearless unless the same champion was picked twice in the series. */
function detectMode(series: Draft[]): FearlessMode {
  const seen = new Set<string>();
  for (const d of series) {
    for (const c of [...d.first.picks, ...d.second.picks]) {
      if (seen.has(c)) return 'normal';
      seen.add(c);
    }
  }
  return series.length > 1 ? 'hard' : 'normal';
}

function teamFromHistory(name: string, history: Draft[]): Team {
  const players = Object.fromEntries(ROLES.map((r) => [r, { name: '', pool: {} as Record<string, number> }])) as Team['players'];
  const counts: Record<Role, Record<string, number>> = { top: {}, jungle: {}, mid: {}, bot: {}, support: {} };
  for (const d of history) {
    for (const side of [d.first, d.second]) {
      if (side.team !== name) continue;
      side.picks.forEach((c, i) => {
        const r = side.roles[i];
        if (r) counts[r][c] = (counts[r][c] ?? 0) + 1;
      });
    }
  }
  for (const r of ROLES) {
    for (const [c, n] of Object.entries(counts[r])) players[r].pool[c] = Math.min(5, 2 + n);
  }
  return { id: name, name, players };
}

interface Case {
  ctx: ScoreContext;
  actual: string;
  type: 'ban' | 'pick';
}

function buildCases(weights: Weights, usePools: boolean): Case[] {
  const history = drafts.filter((d) => d.patch && patchKey(d.patch) < from);
  const cases: Case[] = [];
  for (const series of groupSeries(drafts)) {
    if (!series.some(inEval)) continue;
    const allyName = series[0].first.team;
    const enemyName = series[0].second.team;
    const format = (series.length <= 1 ? 1 : series.length <= 3 ? 3 : 5) as Match['format'];
    const match: Match = { format, mode: detectMode(series), orderId: 'tournament', games: [], disabled: [] };
    const teams: Record<TeamId, Team | undefined> = usePools
      ? { ally: teamFromHistory(allyName, history), enemy: teamFromHistory(enemyName, history) }
      : { ally: undefined, enemy: undefined };
    series.forEach((d) => {
      const firstIsAlly = d.first.team === allyName;
      const firstPick: TeamId = firstIsAlly ? 'ally' : 'enemy';
      const allySide = firstIsAlly ? d.firstPickSide : d.firstPickSide === 'blue' ? 'red' : 'blue';
      const game: Game = newGame({ allySide, firstPick });
      const roles = (side: DraftSide) =>
        Object.fromEntries(side.picks.map((c, i) => [c, side.roles[i]]).filter(([, r]) => r)) as Record<string, Role>;
      game.roleOverrides = {
        [firstPick]: roles(d.first),
        [firstPick === 'ally' ? 'enemy' : 'ally']: roles(d.second),
      };
      game.winner = d.winner ? ((d.winner === 'first') === firstIsAlly ? 'ally' : 'enemy') : null;
      const actions = actionsOf(d);
      match.games.push(game);
      const gameIndex = match.games.length - 1;
      if (inEval(d)) {
        const order = getOrder('tournament').steps;
        actions.forEach((actual, i) => {
          if (actual) {
            const m: Match = JSON.parse(JSON.stringify(match));
            m.games[gameIndex].actions = actions.slice(0, i).map((champion) => ({ champion }));
            cases.push({
              ctx: { match: m, gameIndex, champions, stats, teams, weights, strictPool: false },
              actual,
              type: order[i].type,
            });
          }
        });
      }
      game.actions = actions.map((champion) => ({ champion }));
    });
  }
  return cases;
}

interface Metrics {
  n: number;
  top1: number;
  top5: number;
  top10: number;
  mrr: number;
  missing: number;
}

function evaluate(cases: Case[], weights: Weights, lookahead: boolean) {
  const acc = { ban: [] as number[], pick: [] as number[] };
  const base = { ban: [] as number[], pick: [] as number[] };
  for (const c of cases) {
    const r = recommend({ ...c.ctx, weights }, { limit: 1000, lookahead });
    const ids = r?.items.map((i) => i.champion) ?? [];
    const rank = ids.indexOf(c.actual);
    acc[c.type].push(rank < 0 ? Infinity : rank + 1);
    // Baseline: the same candidates ordered by pro presence only.
    const byPresence = [...ids].sort((a, b) => (stats.champions[b]?.presence ?? 0) - (stats.champions[a]?.presence ?? 0));
    const brank = byPresence.indexOf(c.actual);
    base[c.type].push(brank < 0 ? Infinity : brank + 1);
  }
  const summarize = (ranks: number[]): Metrics => ({
    n: ranks.length,
    top1: ranks.filter((r) => r <= 1).length / ranks.length,
    top5: ranks.filter((r) => r <= 5).length / ranks.length,
    top10: ranks.filter((r) => r <= 10).length / ranks.length,
    mrr: ranks.reduce((s, r) => s + (Number.isFinite(r) ? 1 / r : 0), 0) / ranks.length,
    missing: ranks.filter((r) => !Number.isFinite(r)).length,
  });
  return {
    pick: summarize(acc.pick),
    ban: summarize(acc.ban),
    baselinePick: summarize(base.pick),
    baselineBan: summarize(base.ban),
  };
}

const objective = (m: ReturnType<typeof evaluate>) => (m.pick.top5 + m.ban.top5) / 2 + (m.pick.mrr + m.ban.mrr) / 4;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function print(label: string, m: ReturnType<typeof evaluate>) {
  const row = (name: string, x: Metrics) =>
    `  ${name.padEnd(14)} n=${String(x.n).padStart(5)}  top1 ${pct(x.top1).padStart(6)}  top5 ${pct(x.top5).padStart(6)}  top10 ${pct(x.top10).padStart(6)}  MRR ${x.mrr.toFixed(3)}${x.missing ? `  (not ranked ${x.missing})` : ''}`;
  console.log(label);
  console.log(row('Pick', m.pick));
  console.log(row('Ban', m.ban));
  console.log(row('Pick 只看BP率', m.baselinePick));
  console.log(row('Ban 只看BP率', m.baselineBan));
}

const usePools = flag('pools');
const lookahead = flag('lookahead');
const evalGames = drafts.filter(inEval).length;
console.log(`drafts ${drafts.length}, evaluated games ${evalGames}, stats games ${stats.games}, pools ${usePools}, lookahead ${lookahead}`);
let weights: Weights = { ...DEFAULT_WEIGHTS, ...(opt('weights') ? JSON.parse(opt('weights')!) : {}) };
const cases = buildCases(weights, usePools);
const t0 = performance.now();
const before = evaluate(cases, weights, lookahead);
print(`${opt('weights') ? 'given' : 'default'} weights (${((performance.now() - t0) / 1000).toFixed(1)}s)`, before);
const out: Record<string, unknown> = { evaluatedGames: evalGames, usePools, lookahead, default: before };

if (flag('tune')) {
  const keys = (Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).filter((k) => k !== 'lookahead' || lookahead);
  const grid = [0, 0.25, 0.5, 1, 1.5, 2, 3];
  let best = objective(before);
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (const k of keys) {
      for (const v of grid) {
        if (v === weights[k]) continue;
        const trial = { ...weights, [k]: v };
        const score = objective(evaluate(cases, trial, lookahead));
        if (score > best + 1e-4) {
          best = score;
          weights = trial;
          improved = true;
          console.log(`  ${k} -> ${v}  objective ${best.toFixed(4)}`);
        }
      }
    }
    if (!improved) break;
  }
  const after = evaluate(cases, weights, lookahead);
  print('tuned weights', after);
  console.log(JSON.stringify(weights));
  out.tuned = after;
  out.weights = weights;
}
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(out, null, 2));
