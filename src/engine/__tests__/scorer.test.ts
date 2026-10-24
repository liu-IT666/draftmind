import { describe, expect, it } from 'vitest';
import { candidateRoles } from '../roles';
import { newGame, newMatch } from '../rules';
import { DEFAULT_WEIGHTS, recommend, type ScoreContext } from '../scorer';
import type { Champion, Role, StatsPack, Team } from '../types';

function champ(id: string, positions: Role[], extra: Partial<Champion> = {}): Champion {
  return {
    id, key: 0, nameZh: id, titleZh: id, nameEn: id, positions, positionsGuessed: false,
    tags: [], roles: [], damage: 'ad', toughness: 1, control: 1, mobility: 1, ranged: false, search: [id],
    ...extra,
  };
}

const CHAMPS = [
  champ('TopA', ['top']),
  champ('TopB', ['top'], { toughness: 3, roles: ['VANGUARD'] }),
  champ('JgA', ['jungle']),
  champ('JgB', ['jungle']),
  champ('MidA', ['mid'], { damage: 'ap' }),
  champ('MidB', ['mid'], { damage: 'ap' }),
  champ('Flex', ['top', 'jungle', 'mid'], { damage: 'ap' }),
  champ('BotA', ['bot']),
  champ('BotB', ['bot']),
  champ('SupA', ['support']),
  champ('SupB', ['support']),
];

function team(name: string, pools: Partial<Record<Role, Record<string, number>>> = {}): Team {
  const p = (r: Role) => ({ name: `${name}-${r}`, pool: pools[r] ?? {} });
  return { id: name, name, players: { top: p('top'), jungle: p('jungle'), mid: p('mid'), bot: p('bot'), support: p('support') } };
}

function ctx(partial: Partial<ScoreContext> = {}): ScoreContext {
  return {
    match: newMatch(3, 'hard', { allySide: 'blue', firstPick: 'ally' }),
    gameIndex: 0,
    champions: CHAMPS,
    stats: null,
    teams: { ally: team('us'), enemy: team('them') },
    weights: DEFAULT_WEIGHTS,
    strictPool: true,
    ...partial,
  };
}

const at = (c: ScoreContext, actions: string[]) => {
  c.match.games[c.gameIndex].actions = actions.map((champion) => ({ champion }));
  return c;
};
const BANS = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];

describe('candidate roles', () => {
  it('lets a flex pick move to make room', () => {
    const byId = Object.fromEntries(CHAMPS.map((c) => [c.id, c]));
    expect(candidateRoles(byId.JgA, ['Flex'], byId)).toEqual(['jungle']);
    expect(candidateRoles(byId.JgA, ['Flex', 'TopA', 'MidA'], byId)).toEqual([]);
  });
});

describe('recommend', () => {
  it('recommends picks from the ally pool with proficiency reasons', () => {
    const c = at(ctx({ teams: { ally: team('us', { mid: { MidB: 5 } }), enemy: team('them') } }), BANS);
    c.match.mode = 'normal';
    const r = recommend(c)!;
    expect(r.type).toBe('pick');
    expect(r.team).toBe('ally');
    expect(r.items[0].champion).toBe('MidB');
    expect(r.items[0].role).toBe('mid');
    expect(r.items[0].player).toBe('us-mid');
    // Strict pool: MidA is not in the mid player's pool.
    expect(r.items.find((i) => i.champion === 'MidA')).toBeUndefined();
  });

  it('never recommends unavailable champions', () => {
    const c = at(ctx(), [...BANS, 'MidA']);
    const r = recommend(c, 50)!;
    expect(r.team).toBe('enemy');
    expect(r.items.map((i) => i.champion)).not.toContain('MidA');
  });

  it('bans what the enemy is best at', () => {
    const c = ctx({ teams: { ally: team('us'), enemy: team('them', { jungle: { JgB: 5, JgA: 1 } }) } });
    const r = recommend(c)!;
    expect(r.type).toBe('ban');
    expect(r.items[0].champion).toBe('JgB');
  });

  it('skips bans on champions the enemy already used up in hard fearless', () => {
    const c = ctx({ teams: { ally: team('us'), enemy: team('them', { jungle: { JgB: 5 } }) } });
    const g1 = c.match.games[0];
    g1.actions = [...BANS, 'TopA', 'JgB', 'MidA', 'BotA', 'SupA', 'x7', 'x8', 'x9', 'x10', 'Flex', 'BotB', 'SupB', 'TopB'].map(
      (champion) => ({ champion }),
    );
    g1.winner = 'enemy';
    c.match.games.push(newGame({ allySide: 'red', firstPick: 'ally' }));
    c.gameIndex = 1;
    const r = recommend(c, 50)!;
    expect(r.items.map((i) => i.champion)).not.toContain('JgB');
  });

  it('uses counter stats against the lane opponent', () => {
    const stats: StatsPack = {
      source: 'test', games: 100, champions: {},
      counters: { TopB: { TopA: [0.1, 20] } },
      synergy: {},
    };
    const c = at(ctx({ stats }), [...BANS, 'MidA', 'TopA']);
    // Next is enemy pick 2 of 2... step 8 is S (enemy), step 9 S, so go to step 10 (ally).
    c.match.games[0].actions.push({ champion: 'BotA' });
    const r = recommend(c, 20)!;
    expect(r.team).toBe('ally');
    const topB = r.items.find((i) => i.champion === 'TopB')!;
    expect(topB.parts.counter).toBeGreaterThan(0);
    expect(topB.reasons.some((x) => x.text.includes('对线克制'))).toBe(true);
  });

  it('charges a scarcity cost for spending a comfort pick early in hard fearless', () => {
    const pools = { mid: { MidB: 5 } };
    const hard = recommend(at(ctx({ teams: { ally: team('us', pools), enemy: team('them') } }), BANS), 50)!;
    const last = ctx({ teams: { ally: team('us', pools), enemy: team('them') } });
    last.match.format = 1;
    const bo1 = recommend(at(last, BANS), 50)!;
    const cost = (r: typeof hard) => r.items.find((i) => i.champion === 'MidB')!.parts.scarcity ?? 0;
    expect(cost(hard)).toBeLessThan(0);
    expect(cost(bo1)).toBe(0);
  });
});
