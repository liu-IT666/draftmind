import { describe, expect, it } from 'vitest';
import {
  availableFor,
  gamesRemainingAfter,
  getOrder,
  lockedFor,
  newGame,
  newMatch,
  replay,
  sideOf,
  unavailableReason,
} from '../rules';
import type { Match } from '../types';

const order = getOrder('tournament');
const ALL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];

function play(match: Match, gameIndex: number, champs: (string | null)[]) {
  match.games[gameIndex].actions = champs.map((champion) => ({ champion }));
}

describe('draft order', () => {
  it('has 20 steps, 10 bans and 10 picks split evenly', () => {
    expect(order.steps).toHaveLength(20);
    const count = (team: string, type: string) => order.steps.filter((s) => s.team === team && s.type === type).length;
    expect(count('F', 'ban')).toBe(5);
    expect(count('S', 'ban')).toBe(5);
    expect(count('F', 'pick')).toBe(5);
    expect(count('S', 'pick')).toBe(5);
  });

  it('gives the last pick of the draft to the second-pick team', () => {
    expect(order.steps[19]).toEqual({ team: 'S', type: 'pick' });
    expect(order.steps.slice(6, 12).map((s) => s.team).join('')).toBe('FSSFFS');
  });
});

describe('replay', () => {
  it('maps first-pick slot to the right team independently of side', () => {
    const m = newMatch(3, 'hard', { allySide: 'red', firstPick: 'ally' });
    const g = m.games[0];
    expect(sideOf(g, 'ally')).toBe('red');
    expect(replay(g, order).next).toMatchObject({ teamId: 'ally', type: 'ban' });
    play(m, 0, ['A']);
    expect(replay(g, order).next).toMatchObject({ teamId: 'enemy', type: 'ban' });
  });

  it('records skipped bans and supports undo by dropping the last action', () => {
    const m = newMatch(1, 'normal', { allySide: 'blue', firstPick: 'ally' });
    play(m, 0, [null, 'A', 'B']);
    let v = replay(m.games[0], order);
    expect(v.bans.ally).toEqual([null, 'B']);
    expect(v.bans.enemy).toEqual(['A']);
    m.games[0].actions.pop();
    v = replay(m.games[0], order);
    expect(v.bans.ally).toEqual([null]);
    expect(v.stepIndex).toBe(2);
  });

  it('is complete after 20 actions', () => {
    const m = newMatch(1, 'normal', { allySide: 'blue', firstPick: 'enemy' });
    play(m, 0, ALL.slice(0, 20));
    const v = replay(m.games[0], order);
    expect(v.complete).toBe(true);
    expect(v.picks.ally).toHaveLength(5);
    expect(v.picks.enemy).toHaveLength(5);
    // First pick of the draft (step 7) belongs to the first-pick team (enemy).
    expect(v.picks.enemy[0]).toBe('G');
  });
});

describe('fearless locking', () => {
  function seriesAfterOneGame(mode: Match['mode'], format: Match['format'] = 3) {
    const m = newMatch(format, mode, { allySide: 'blue', firstPick: 'ally' });
    play(m, 0, ALL.slice(0, 20));
    m.games[0].winner = 'ally';
    m.games.push(newGame({ allySide: 'red', firstPick: 'enemy' }));
    return m;
  }
  const g1 = replay(seriesAfterOneGame('normal').games[0], order);

  it('hard: both teams lose every champion picked earlier, bans do not lock', () => {
    const m = seriesAfterOneGame('hard');
    const all = [...g1.picks.ally, ...g1.picks.enemy];
    expect([...lockedFor(m, 1, 'ally')].sort()).toEqual(all.sort());
    expect([...lockedFor(m, 1, 'enemy')].sort()).toEqual(all.sort());
    expect(lockedFor(m, 1, 'ally').has('A')).toBe(false); // A was a ban
    expect(unavailableReason(m, 1, 'enemy', g1.picks.ally[0])).toBe('全局 BP 已锁定');
  });

  it('soft: a team only loses its own earlier picks', () => {
    const m = seriesAfterOneGame('soft');
    expect([...lockedFor(m, 1, 'ally')].sort()).toEqual([...g1.picks.ally].sort());
    expect(availableFor(m, 1, 'enemy', ALL).has(g1.picks.ally[0])).toBe(true);
    expect(availableFor(m, 1, 'ally', ALL).has(g1.picks.ally[0])).toBe(false);
  });

  it('normal mode and BO1 never lock', () => {
    expect(lockedFor(seriesAfterOneGame('normal'), 1, 'ally').size).toBe(0);
    expect(lockedFor(seriesAfterOneGame('hard', 1), 1, 'ally').size).toBe(0);
  });

  it('removes bans, picks and disabled champions from the current game', () => {
    const m = newMatch(1, 'normal', { allySide: 'blue', firstPick: 'ally' });
    m.disabled = ['V'];
    play(m, 0, ['A', 'B']);
    const av = availableFor(m, 0, 'ally', ALL);
    expect(av.has('A') || av.has('B') || av.has('V')).toBe(false);
    expect(av.size).toBe(ALL.length - 3);
  });
});

describe('games remaining', () => {
  it('counts the most games that can still follow', () => {
    const m = newMatch(5, 'hard', { allySide: 'blue', firstPick: 'ally' });
    expect(gamesRemainingAfter(m, 0)).toBe(4);
    m.games[0].winner = 'ally';
    m.games.push(newGame({ allySide: 'blue', firstPick: 'ally' }));
    m.games[1].winner = 'ally';
    m.games.push(newGame({ allySide: 'blue', firstPick: 'ally' }));
    // 2-0 in a BO5: game 3 could be followed by at most 2 more.
    expect(gamesRemainingAfter(m, 2)).toBe(2);
    expect(gamesRemainingAfter(newMatch(1, 'hard', { allySide: 'blue', firstPick: 'ally' }), 0)).toBe(0);
  });
});
