import { assignRoles, candidateRoles } from './roles';
import { availableFor, fearlessActive, gamesRemainingAfter, getOrder, lockedFor, other, replay } from './rules';
import type { Champion, Match, Role, StatsPack, Team, TeamId } from './types';

export type FactorKey =
  | 'meta'
  | 'proficiency'
  | 'counter'
  | 'synergy'
  | 'compFit'
  | 'flex'
  | 'deny'
  | 'exposure'
  | 'scarcity'
  | 'lookahead';

export type Weights = Record<FactorKey, number> & { threat: number };

export const DEFAULT_WEIGHTS: Weights = {
  meta: 1,
  proficiency: 1.5,
  counter: 1,
  synergy: 0.6,
  compFit: 0.8,
  flex: 0.4,
  deny: 0.6,
  exposure: 0.4,
  scarcity: 0.5,
  lookahead: 0.5,
  threat: 0.5,
};

export const FACTOR_LABELS: Record<FactorKey | 'threat', string> = {
  meta: '版本强度',
  proficiency: '熟练度',
  counter: '克制',
  synergy: '协同',
  compFit: '阵容完整性',
  flex: '翻转价值',
  deny: '抢夺',
  exposure: '暴露风险',
  scarcity: '稀缺成本',
  lookahead: '前瞻',
  threat: '针对我方',
};

export const ROLE_LABELS: Record<Role, string> = {
  top: '上单',
  jungle: '打野',
  mid: '中单',
  bot: 'ADC',
  support: '辅助',
};

export interface ScoreContext {
  match: Match;
  gameIndex: number;
  champions: Champion[];
  stats: StatsPack | null;
  teams: Record<TeamId, Team | undefined>;
  weights: Weights;
  /** When a player's pool has entries, only consider champions in it for that role. */
  strictPool: boolean;
}

export interface Reason {
  text: string;
  tone: 'good' | 'bad' | 'info';
}

export interface Recommendation {
  champion: string;
  role?: Role;
  player?: string;
  total: number;
  /** Weighted contribution of each factor (negative for costs). */
  parts: Partial<Record<FactorKey | 'threat', number>>;
  reasons: Reason[];
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const stars = (n: number) => '★'.repeat(n);
const ENGAGE_ROLES = new Set(['VANGUARD', 'CATCHER', 'DIVER']);

export function isEngage(c: Champion) {
  return c.roles.some((r) => ENGAGE_ROLES.has(r)) || (c.control >= 3 && c.toughness >= 2);
}
export const isFrontline = (c: Champion) => c.toughness >= 3;

/**
 * Adds the roles a champion is actually played in at pro level (e.g. Naafiri jungle,
 * Kai'Sa top) to its usual positions, so role filtering does not hide real flex picks.
 */
export function withProPositions(c: Champion, stats: StatsPack | null): Champion {
  const s = stats?.champions[c.id];
  if (!s || s.picks < 2) return c;
  const extra = (Object.entries(s.roles) as [Role, number][])
    .filter(([r, n]) => !c.positions.includes(r) && n >= 2 && n >= s.picks * 0.1)
    .map(([r]) => r);
  return extra.length ? { ...c, positions: [...c.positions, ...extra] } : c;
}

interface TeamState {
  picks: string[];
  roles: Record<string, Role>;
  team?: Team;
  overrides: Partial<Record<string, Role>>;
}

class Scorer {
  readonly byId: Record<string, Champion>;
  readonly view;
  readonly state: Record<TeamId, TeamState>;
  readonly maxPresence: number;
  readonly remaining: number;
  private availCache: Partial<Record<TeamId, Set<string>>> = {};

  constructor(readonly ctx: ScoreContext) {
    this.byId = Object.fromEntries(ctx.champions.map((c) => [c.id, withProPositions(c, ctx.stats)]));
    const game = ctx.match.games[ctx.gameIndex];
    this.view = replay(game, getOrder(ctx.match.orderId));
    const mk = (t: TeamId): TeamState => {
      const overrides = game.roleOverrides[t] ?? {};
      return {
        picks: this.view.picks[t],
        roles: assignRoles(this.view.picks[t], this.byId, ctx.teams[t], overrides),
        team: ctx.teams[t],
        overrides,
      };
    };
    this.state = { ally: mk('ally'), enemy: mk('enemy') };
    this.maxPresence = Math.max(0.01, ...Object.values(ctx.stats?.champions ?? {}).map((s) => s.presence));
    this.remaining = gamesRemainingAfter(ctx.match, ctx.gameIndex);
  }

  available(team: TeamId): Set<string> {
    return (this.availCache[team] ??= availableFor(this.ctx.match, this.ctx.gameIndex, team, Object.keys(this.byId)));
  }

  name(id: string) {
    const c = this.byId[id];
    return c ? c.titleZh : id;
  }

  pool(team: TeamId, role: Role) {
    return this.state[team].team?.players[role]?.pool ?? {};
  }

  meta(c: Champion, role: Role): { value: number; reason?: Reason } {
    const s = this.ctx.stats?.champions[c.id];
    if (!this.ctx.stats) return { value: 0.5 };
    if (!s) return { value: 0.1 };
    let value = 0.85 * (s.presence / this.maxPresence) + 0.15 * clamp((s.winRate - 0.4) / 0.2, 0, 1);
    if (s.picks >= 3) value *= 0.4 + 0.6 * ((s.roles[role] ?? 0) / s.picks);
    return {
      value,
      reason:
        value > 0.45
          ? { tone: 'info', text: `职业赛 BP 率 ${(s.presence * 100).toFixed(0)}%，胜率 ${(s.winRate * 100).toFixed(0)}%` }
          : undefined,
    };
  }

  /** null = this team has no pool data for the role, so proficiency is unknown. */
  proficiency(team: TeamId, c: Champion, role: Role): number | null {
    const pool = this.pool(team, role);
    if (Object.keys(pool).length === 0) return null;
    return (pool[c.id] ?? 0) / 5;
  }

  lanePartner(team: TeamId, role: Role): string | undefined {
    const st = this.state[team];
    return st.picks.find((p) => st.roles[p] === role);
  }

  counter(team: TeamId, c: Champion, role: Role): { value: number; reason?: Reason } {
    const opp = this.lanePartner(other(team), role);
    const m = opp && this.ctx.stats?.counters[c.id]?.[opp];
    if (!opp || !m) return { value: 0 };
    const value = clamp(m[0] * 5);
    return {
      value,
      reason:
        Math.abs(value) >= 0.1
          ? {
              tone: value > 0 ? 'good' : 'bad',
              text: `${value > 0 ? '对线克制' : '对线被克'}对方${ROLE_LABELS[role]} ${this.name(opp)}（${pct(m[0])}，${m[1]} 场）`,
            }
          : undefined,
    };
  }

  synergy(team: TeamId, c: Champion): { value: number; reason?: Reason } {
    const row = this.ctx.stats?.synergy[c.id];
    if (!row) return { value: 0 };
    let best: [string, number, number] | null = null;
    let sum = 0;
    let n = 0;
    for (const a of this.state[team].picks) {
      const s = row[a];
      if (!s) continue;
      sum += s[0];
      n++;
      if (!best || Math.abs(s[0]) > Math.abs(best[1])) best = [a, s[0], s[1]];
    }
    if (!n) return { value: 0 };
    const value = clamp((sum / n) * 5);
    return {
      value,
      reason:
        best && Math.abs(best[1]) >= 0.02
          ? {
              tone: best[1] > 0 ? 'good' : 'bad',
              text: `与 ${this.name(best[0])} ${best[1] > 0 ? '配合好' : '配合差'}（${pct(best[1])}，${best[2]} 场）`,
            }
          : undefined,
    };
  }

  compFit(team: TeamId, c: Champion): { value: number; reasons: Reason[] } {
    const mine = this.state[team].picks.map((p) => this.byId[p]).filter(Boolean);
    if (mine.length === 0) return { value: 0, reasons: [] };
    const reasons: Reason[] = [];
    let value = 0;
    const ap = mine.filter((x) => x.damage === 'ap').length;
    const ad = mine.length - ap;
    if (c.damage === 'ap' && ap === 0 && ad >= 2) {
      value += 0.6;
      reasons.push({ tone: 'good', text: '补足 AP 伤害' });
    } else if (c.damage === 'ad' && ad === 0 && ap >= 2) {
      value += 0.6;
      reasons.push({ tone: 'good', text: '补足 AD 伤害' });
    } else if (mine.length >= 3 && ((c.damage === 'ap' && ad === 0) || (c.damage === 'ad' && ap === 0))) {
      value -= 0.6;
      reasons.push({ tone: 'bad', text: `伤害类型单一（全 ${c.damage.toUpperCase()}）` });
    }
    if (!mine.some(isFrontline)) {
      if (isFrontline(c)) {
        value += 0.5;
        reasons.push({ tone: 'good', text: '补足前排' });
      } else if (mine.length >= 3) value -= 0.3;
    }
    if (!mine.some(isEngage)) {
      if (isEngage(c)) {
        value += 0.5;
        reasons.push({ tone: 'good', text: '补足开团' });
      } else if (mine.length >= 3) value -= 0.3;
    }
    return { value: clamp(value), reasons };
  }

  /** How much the other team wants this champion, judged from their pool and meta. */
  interest(team: TeamId, c: Champion): { value: number; role?: Role; stars: number } {
    const st = this.state[team];
    const roles = candidateRoles(c, st.picks, this.byId, st.team, st.overrides);
    let best = { value: 0, role: undefined as Role | undefined, stars: 0 };
    for (const r of roles) {
      const prof = this.proficiency(team, c, r);
      const m = this.meta(c, r).value;
      const v = prof === null ? m : 0.4 * m + 0.6 * prof;
      if (v > best.value) best = { value: v, role: r, stars: Math.round((prof ?? 0) * 5) };
    }
    return best;
  }

  exposure(team: TeamId, c: Champion, role: Role): { value: number; reason?: Reason } {
    const opp = other(team);
    if (this.lanePartner(opp, role)) return { value: 0 };
    const avail = this.available(opp);
    let worst: [string, number] | null = null;
    for (const [x, row] of Object.entries(this.ctx.stats?.counters ?? {})) {
      const m = row[c.id];
      if (!m || !avail.has(x) || x === c.id) continue;
      const xc = this.byId[x];
      if (!xc?.positions.includes(role) && !this.pool(opp, role)[x]) continue;
      if (!worst || m[0] > worst[1]) worst = [x, m[0]];
    }
    if (!worst || worst[1] <= 0) return { value: 0 };
    const value = clamp(worst[1] * 5, 0, 1);
    return {
      value,
      reason: value >= 0.25 ? { tone: 'bad', text: `后手可能被 ${this.name(worst[0])} 针对（${pct(worst[1])}）` } : undefined,
    };
  }

  scarcity(team: TeamId, c: Champion, role: Role): { value: number; reason?: Reason } {
    const { match, gameIndex } = this.ctx;
    if (!fearlessActive(match) || this.remaining === 0) return { value: 0 };
    const pool = this.pool(team, role);
    const s = pool[c.id] ?? 0;
    if (s < 4) return { value: 0 };
    const locked = lockedFor(match, gameIndex, team);
    const strongLeft = Object.entries(pool).filter(([id, st]) => st >= 4 && id !== c.id && !locked.has(id)).length;
    // Fewer strong options left and more games ahead make spending a comfort pick now costlier.
    const value = clamp(((s / 5) * this.remaining) / (this.remaining + strongLeft + 1), 0, 1);
    const player = this.state[team].team?.players[role]?.name || ROLE_LABELS[role];
    return {
      value,
      reason:
        value >= 0.3
          ? { tone: 'bad', text: `全局 BP：用掉后 ${player} 只剩 ${strongLeft} 个 4 星以上英雄，后面最多还有 ${this.remaining} 局` }
          : undefined,
    };
  }

  pick(team: TeamId, c: Champion, opts: { forBan?: boolean } = {}): Recommendation | null {
    const st = this.state[team];
    const w = this.ctx.weights;
    let roles = candidateRoles(c, st.picks, this.byId, st.team, st.overrides);
    if (this.ctx.strictPool) {
      roles = roles.filter((r) => {
        const pool = this.pool(team, r);
        return Object.keys(pool).length === 0 || pool[c.id];
      });
    }
    let best: Recommendation | null = null;
    for (const role of roles) {
      const parts: Recommendation['parts'] = {};
      const reasons: Reason[] = [];
      const add = (k: FactorKey | 'threat', v: number, r?: Reason | Reason[]) => {
        parts[k] = v * (w[k] ?? 0) || 0;
        if (r) reasons.push(...(Array.isArray(r) ? r : [r]));
      };
      const meta = this.meta(c, role);
      add('meta', meta.value, meta.reason);
      const prof = this.proficiency(team, c, role);
      const player = st.team?.players[role]?.name;
      add(
        'proficiency',
        prof ?? 0.5,
        prof !== null && prof >= 0.6
          ? { tone: 'good', text: `${player || ROLE_LABELS[role]} 熟练度 ${stars(Math.round(prof * 5))}` }
          : prof !== null && prof === 0
            ? { tone: 'bad', text: `不在${player || ROLE_LABELS[role]}的英雄池里` }
            : undefined,
      );
      const ctr = this.counter(team, c, role);
      add('counter', ctr.value, ctr.reason);
      const syn = this.synergy(team, c);
      add('synergy', syn.value, syn.reason);
      const comp = this.compFit(team, c);
      add('compFit', comp.value, comp.reasons);
      const flexRoles = c.positions.length;
      const early = st.picks.length === 0 ? 1 : st.picks.length <= 2 ? 0.6 : 0.2;
      const flex = clamp((flexRoles - 1) / 2, 0, 1) * early;
      add(
        'flex',
        flex,
        flex >= 0.3 ? { tone: 'info', text: `可打 ${c.positions.map((p) => ROLE_LABELS[p]).join('/')}，隐藏分路` } : undefined,
      );
      if (!opts.forBan) {
        const opp = other(team);
        const it = this.interest(opp, c);
        const hardBonus = this.ctx.match.mode === 'hard' && fearlessActive(this.ctx.match) && this.remaining > 0 && it.stars >= 4;
        add(
          'deny',
          it.value * (hardBonus ? 1.5 : 1),
          it.stars >= 4 && it.role
            ? {
                tone: 'good',
                text: `抢走对方${ROLE_LABELS[it.role]}${this.state[opp].team?.players[it.role]?.name ? ' ' + this.state[opp].team!.players[it.role].name : ''}的 ${stars(it.stars)} 英雄${hardBonus ? '（硬全局：后面几局也拿不到）' : ''}`,
              }
            : undefined,
        );
        const exp = this.exposure(team, c, role);
        add('exposure', -exp.value, exp.reason);
        const sc = this.scarcity(team, c, role);
        add('scarcity', -sc.value, sc.reason);
      }
      const total = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
      if (!best || total > best.total) best = { champion: c.id, role, player: player || undefined, total, parts, reasons };
    }
    return best;
  }

  ban(team: TeamId, c: Champion): Recommendation | null {
    const opp = other(team);
    const theirs = this.pick(opp, c, { forBan: true });
    if (!theirs) return null;
    const threat = Math.max(0, this.counter(opp, c, theirs.role!).value);
    const parts = { ...theirs.parts, threat: threat * this.ctx.weights.threat };
    const total = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
    const oppPlayer = this.state[opp].team?.players[theirs.role!]?.name;
    const reasons: Reason[] = [
      { tone: 'info', text: `对方${ROLE_LABELS[theirs.role!]}${oppPlayer ? ' ' + oppPlayer : ''}可用` },
      ...theirs.reasons.map((r) => ({ ...r, tone: (r.tone === 'good' ? 'bad' : r.tone === 'bad' ? 'good' : 'info') as Reason['tone'] })),
    ];
    return { champion: c.id, role: theirs.role, player: oppPlayer, total, parts, reasons };
  }
}

export interface RecommendOptions {
  limit?: number;
  /** Re-rank the top picks by simulating the opponent's best reply (shallow search). */
  lookahead?: boolean;
  /** How many top candidates the lookahead re-ranks. */
  beam?: number;
}

export interface RecommendResult {
  team: TeamId;
  type: 'ban' | 'pick';
  items: Recommendation[];
}

function rankAll(ctx: ScoreContext): RecommendResult | null {
  const sc = new Scorer(ctx);
  const next = sc.view.next;
  if (!next) return null;
  const team = next.teamId;
  // A ban only matters if the opponent could still pick the champion.
  const pool = sc.available(next.type === 'ban' ? other(team) : team);
  const takenNow = sc.available(team);
  const items: Recommendation[] = [];
  for (const id of pool) {
    if (next.type === 'ban' && ctx.match.mode !== 'soft' && !takenNow.has(id)) continue;
    const c = sc.byId[id];
    const r = next.type === 'pick' ? sc.pick(team, c) : sc.ban(team, c);
    if (r) items.push(r);
  }
  items.sort((a, b) => b.total - a.total);
  return { team, type: next.type, items };
}

/** The context after one more action in the current game. */
export function withAction(ctx: ScoreContext, champion: string | null): ScoreContext {
  const match: Match = JSON.parse(JSON.stringify(ctx.match));
  match.games[ctx.gameIndex].actions.push({ champion });
  return { ...ctx, match };
}

/**
 * Best value the opponent can get from their next action after we take `champion`.
 * If we act again first (a double pick), our own greedy best is played before theirs.
 */
function opponentReply(ctx: ScoreContext, team: TeamId, champion: string): { value: number; champion?: string } | null {
  let next = withAction(ctx, champion);
  for (let guard = 0; guard < 3; guard++) {
    const r = rankAll(next);
    if (!r || r.items.length === 0) return null;
    if (r.team !== team) return { value: r.items[0].total, champion: r.items[0].champion };
    next = withAction(next, r.items[0].champion);
  }
  return null;
}

/**
 * Ranks candidates for the next step of the current game. For the enemy's turns this is a
 * prediction of what they are likely to do, using the enemy pool.
 *
 * With lookahead, the top `beam` picks are re-scored by how good the opponent's best reply
 * is afterwards: a pick that leaves the opponent a strong answer loses points relative to
 * the candidate that leaves them the weakest one.
 */
export function recommend(ctx: ScoreContext, opts: RecommendOptions | number = {}): RecommendResult | null {
  const { limit = 8, lookahead = false, beam = 10 } = typeof opts === 'number' ? { limit: opts } : opts;
  const r = rankAll(ctx);
  if (!r) return null;
  if (lookahead && r.type === 'pick' && ctx.weights.lookahead > 0) {
    const head = r.items.slice(0, beam);
    const replies = head.map((it) => opponentReply(ctx, r.team, it.champion));
    const values = replies.filter(Boolean).map((x) => x!.value);
    if (values.length > 1) {
      const best = Math.min(...values);
      head.forEach((it, i) => {
        const rep = replies[i];
        if (!rep) return;
        const penalty = (rep.value - best) * ctx.weights.lookahead;
        it.parts = { ...it.parts, lookahead: -penalty || 0 };
        it.total -= penalty;
        if (rep.champion) {
          const name = champLabel(ctx, rep.champion);
          it.reasons = [
            ...it.reasons,
            penalty < 0.05
              ? { tone: 'good', text: `对方后手应对空间最小（最佳回应 ${name}）` }
              : { tone: 'info', text: `对方可能回应 ${name}` },
          ];
        }
      });
      // Candidates outside the beam keep their greedy score minus the worst penalty seen,
      // so the re-ranked head cannot be overtaken by unexamined candidates for free.
      const worst = (Math.max(...values) - best) * ctx.weights.lookahead;
      r.items.slice(beam).forEach((it) => (it.total -= worst));
      r.items.sort((a, b) => b.total - a.total);
    }
  }
  return { ...r, items: r.items.slice(0, limit) };
}

function champLabel(ctx: ScoreContext, id: string) {
  return ctx.champions.find((c) => c.id === id)?.titleZh ?? id;
}

export interface PairRecommendation {
  champions: [string, string];
  roles: [Role | undefined, Role | undefined];
  players: [string | undefined, string | undefined];
  total: number;
  reasons: Reason[];
}

/**
 * When the acting team has two picks in a row (second-pick team's 2nd/3rd pick, first-pick
 * team's 4th/5th, ...), scores the two picks together: the second is evaluated with the
 * first already on the team, so synergy and comp needs between them count.
 */
export function recommendPairs(ctx: ScoreContext, limit = 5, beam = 10): PairRecommendation[] | null {
  const order = getOrder(ctx.match.orderId);
  const view = replay(ctx.match.games[ctx.gameIndex], order);
  const s1 = view.next;
  const s2 = order.steps[view.stepIndex + 1];
  if (!s1 || !s2 || s1.type !== 'pick' || s2.type !== 'pick' || s2.team !== s1.team) return null;
  const first = rankAll(ctx);
  if (!first) return null;
  const seen = new Set<string>();
  const pairs: PairRecommendation[] = [];
  for (const a of first.items.slice(0, beam)) {
    const second = rankAll(withAction(ctx, a.champion));
    for (const b of second?.items.slice(0, beam) ?? []) {
      const key = [a.champion, b.champion].sort().join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      const extra = b.reasons.filter((x) => x.text.includes(champLabel(ctx, a.champion)) || x.text.startsWith('补足'));
      // A flex first pick may move to make room for the second, so assign roles for both together.
      const roles = teamRoles(withAction(withAction(ctx, a.champion), b.champion))[first.team];
      const players = [roles[a.champion], roles[b.champion]].map((r) => (r && ctx.teams[first.team]?.players[r]?.name) || undefined);
      pairs.push({
        champions: [a.champion, b.champion],
        roles: [roles[a.champion], roles[b.champion]],
        players: [players[0], players[1]],
        total: a.total + b.total,
        reasons: extra,
      });
    }
  }
  pairs.sort((x, y) => y.total - x.total);
  return pairs.slice(0, limit);
}

/** Role assignment for display, shared with the UI. */
export function teamRoles(ctx: ScoreContext): Record<TeamId, Record<string, Role>> {
  const sc = new Scorer(ctx);
  return { ally: sc.state.ally.roles, enemy: sc.state.enemy.roles };
}
