import type { DraftOrder, FearlessMode, Game, GameSetup, Match, OrderSlot, Side, StepDef, TeamId } from './types';

const step = (team: OrderSlot, type: 'ban' | 'pick'): StepDef => ({ team, type });
const seq = (type: 'ban' | 'pick', teams: string): StepDef[] =>
  teams.split(' ').map((t) => step(t as OrderSlot, type));

/** Draft orders are data so that leagues or future rule changes only need a new entry. */
export const DRAFT_ORDERS: DraftOrder[] = [
  {
    id: 'tournament',
    name: '标准赛事 20 步',
    steps: [
      ...seq('ban', 'F S F S F S'),
      ...seq('pick', 'F S S F F S'),
      ...seq('ban', 'S F S F'),
      ...seq('pick', 'S F F S'),
    ],
  },
];

export function getOrder(id: string): DraftOrder {
  return DRAFT_ORDERS.find((o) => o.id === id) ?? DRAFT_ORDERS[0];
}

export const other = (t: TeamId): TeamId => (t === 'ally' ? 'enemy' : 'ally');

export function slotTeam(game: Game, slot: OrderSlot): TeamId {
  return slot === 'F' ? game.setup.firstPick : other(game.setup.firstPick);
}

export function sideOf(game: Game, team: TeamId): Side {
  const ally = game.setup.allySide;
  return team === 'ally' ? ally : ally === 'blue' ? 'red' : 'blue';
}

export interface DraftView {
  /** Index of the next step, or steps.length when the draft is complete. */
  stepIndex: number;
  next: (StepDef & { teamId: TeamId }) | null;
  bans: Record<TeamId, (string | null)[]>;
  picks: Record<TeamId, string[]>;
  complete: boolean;
}

/** Replays the action log of a game. Pure; undo is simply dropping the last action. */
export function replay(game: Game, order: DraftOrder): DraftView {
  const bans: DraftView['bans'] = { ally: [], enemy: [] };
  const picks: DraftView['picks'] = { ally: [], enemy: [] };
  game.actions.forEach((a, i) => {
    const s = order.steps[i];
    if (!s) return;
    const team = slotTeam(game, s.team);
    if (s.type === 'ban') bans[team].push(a.champion);
    else if (a.champion) picks[team].push(a.champion);
  });
  const stepIndex = Math.min(game.actions.length, order.steps.length);
  const s = order.steps[stepIndex];
  return {
    stepIndex,
    next: s ? { ...s, teamId: slotTeam(game, s.team) } : null,
    bans,
    picks,
    complete: !s,
  };
}

/** Whether fearless locking applies at all (it never does in a BO1). */
export function fearlessActive(match: Pick<Match, 'format' | 'mode'>): boolean {
  return match.mode !== 'normal' && match.format > 1;
}

/**
 * Champions a team cannot pick because of earlier games in the series.
 * hard: anything either team picked before is locked for both.
 * soft: a team only loses what it picked itself.
 * Bans in earlier games never lock.
 */
export function lockedFor(match: Match, gameIndex: number, team: TeamId): Set<string> {
  const locked = new Set<string>();
  if (!fearlessActive(match)) return locked;
  const order = getOrder(match.orderId);
  for (const g of match.games.slice(0, gameIndex)) {
    const v = replay(g, order);
    for (const t of ['ally', 'enemy'] as TeamId[]) {
      if (match.mode === 'hard' || t === team) v.picks[t].forEach((c) => locked.add(c));
    }
  }
  return locked;
}

/** Champions used up so far in the series, per team (for the pool-consumption view). */
export function seriesPicks(match: Match, gameIndex: number): Record<TeamId, string[]> {
  const order = getOrder(match.orderId);
  const out: Record<TeamId, string[]> = { ally: [], enemy: [] };
  for (const g of match.games.slice(0, gameIndex)) {
    const v = replay(g, order);
    out.ally.push(...v.picks.ally);
    out.enemy.push(...v.picks.enemy);
  }
  return out;
}

/** Available = All - Disabled - Bans(game) - Picks(game) - Locked(series, team). */
export function availableFor(
  match: Match,
  gameIndex: number,
  team: TeamId,
  allChampionIds: string[],
): Set<string> {
  const game = match.games[gameIndex];
  const v = replay(game, getOrder(match.orderId));
  const taken = new Set<string>([
    ...match.disabled,
    ...(v.bans.ally.filter(Boolean) as string[]),
    ...(v.bans.enemy.filter(Boolean) as string[]),
    ...v.picks.ally,
    ...v.picks.enemy,
    ...lockedFor(match, gameIndex, team),
  ]);
  return new Set(allChampionIds.filter((c) => !taken.has(c)));
}

/** Why a champion cannot be chosen right now, or null if it can. */
export function unavailableReason(
  match: Match,
  gameIndex: number,
  team: TeamId,
  champion: string,
): string | null {
  const game = match.games[gameIndex];
  const v = replay(game, getOrder(match.orderId));
  if (match.disabled.includes(champion)) return '本版本禁用';
  if (v.bans.ally.includes(champion) || v.bans.enemy.includes(champion)) return '本局已 Ban';
  if (v.picks.ally.includes(champion) || v.picks.enemy.includes(champion)) return '本局已选';
  if (lockedFor(match, gameIndex, team).has(champion)) return '全局 BP 已锁定';
  return null;
}

/** Games needed to win the series. */
export const winsNeeded = (format: number) => Math.ceil(format / 2);

export function seriesScore(match: Match): Record<TeamId, number> {
  const s = { ally: 0, enemy: 0 };
  match.games.forEach((g) => g.winner && s[g.winner]++);
  return s;
}

export function seriesOver(match: Match): boolean {
  const s = seriesScore(match);
  const n = winsNeeded(match.format);
  return s.ally >= n || s.enemy >= n;
}

/** Most games that can still follow the current one in the series (used for scarcity). */
export function gamesRemainingAfter(match: Match, gameIndex: number): number {
  const before = { ally: 0, enemy: 0 };
  match.games.slice(0, gameIndex).forEach((g) => g.winner && before[g.winner]++);
  const n = winsNeeded(match.format);
  // Each team can lose at most n-1 more games before the series ends.
  const maxTotal = before.ally + before.enemy + (n - before.ally) + (n - before.enemy) - 1;
  return Math.max(0, Math.min(match.format, maxTotal) - gameIndex - 1);
}

export function newGame(setup: GameSetup): Game {
  return { setup, actions: [], roleOverrides: {}, winner: null };
}

export function newMatch(format: Match['format'], mode: FearlessMode, setup: GameSetup): Match {
  return { format, mode, orderId: 'tournament', games: [newGame(setup)], disabled: [] };
}
