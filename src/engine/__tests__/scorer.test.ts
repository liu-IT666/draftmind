import { describe, expect, it } from 'vitest';
import { assignRoles, candidateRoles } from '../roles';
import { newGame, newMatch } from '../rules';
import { DEFAULT_WEIGHTS, recommend, recommendPairs, type ScoreContext } from '../scorer';
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

describe('role assignment', () => {
  it('prefers an assignment where every champion can play its role', () => {
    const cs = [
      champ('A', ['top', 'mid']),
      champ('B', ['jungle', 'top']),
      champ('C', ['mid', 'support']),
      champ('D', ['support', 'bot']),
      champ('E', ['jungle']),
    ];
    const byId = Object.fromEntries(cs.map((c) => [c.id, c]));
    // A top is worth a lot (5-star top laner), but then B keeps jungle and E (jungle only)
    // would be pushed to a lane it cannot play.
    const roles = assignRoles(['A', 'B', 'C', 'D', 'E'], byId, team('us', { top: { A: 5 } }));
    expect(roles).toEqual({ A: 'mid', B: 'top', C: 'support', D: 'bot', E: 'jungle' });
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

describe('pairs', () => {
  it('only applies when the acting team has two picks in a row', () => {
    // Step 7 is a single first pick for the first-pick team.
    expect(recommendPairs(at(ctx(), BANS))).toBeNull();
    // Steps 8-9 are the second-pick team's double pick.
    const pairs = recommendPairs(at(ctx(), [...BANS, 'MidA']), 3)!;
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.champions[0]).not.toBe(p.champions[1]);
      expect(p.champions).not.toContain('MidA');
      expect(p.roles[0]).not.toBe(p.roles[1]);
    }
  });

  it('scores the second pick with the first already on the team', () => {
    const stats: StatsPack = {
      source: 'test', games: 100, champions: {}, counters: {},
      synergy: { BotA: { SupA: [0.08, 40] }, SupA: { BotA: [0.08, 40] } },
    };
    const c = at(ctx({ stats }), [...BANS, 'MidA']);
    c.weights = { ...DEFAULT_WEIGHTS, flex: 0, compFit: 0 };
    const pairs = recommendPairs(c, 1)!;
    expect([...pairs[0].champions].sort()).toEqual(['BotA', 'SupA']);
  });
});

describe('pairs: seats', () => {
  it('scores each pick in the seat it ends up in and respects the strict pool', () => {
    // Flex and TopA are both 5-star picks for the top laner. Taking both would push Flex to
    // jungle, where the jungler does not play it, so the pair must not be offered.
    const c = at(
      ctx({
        match: newMatch(1, 'normal', { allySide: 'blue', firstPick: 'enemy' }),
        teams: {
          ally: team('us', { top: { Flex: 5, TopA: 5 }, jungle: { JgA: 3 }, mid: { MidA: 3 }, bot: { BotA: 3 }, support: { SupA: 3 } }),
          enemy: team('them'),
        },
        weights: { ...DEFAULT_WEIGHTS, flex: 0, deny: 0, compFit: 0 },
      }),
      [...BANS, 'SupB'],
    );
    const pairs = recommendPairs(c, 20)!;
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.find((p) => p.champions.includes('Flex') && p.champions.includes('TopA'))).toBeUndefined();
    for (const p of pairs) {
      expect(new Set(p.roles).size).toBe(2);
      p.champions.forEach((id, i) => expect(c.teams.ally!.players[p.roles[i]!].pool[id]).toBeGreaterThan(0));
    }
  });
});

describe('soft fearless', () => {
  it('gives no deny value for champions the opponent already used up', () => {
    const c = ctx({
      match: newMatch(3, 'soft', { allySide: 'blue', firstPick: 'ally' }),
      teams: { ally: team('us'), enemy: team('them', { jungle: { JgB: 5 } }) },
    });
    c.match.games[0].actions = [...BANS, 'MidA', 'JgB', 'TopA', 'BotA', 'SupA', 'MidB', 'x7', 'x8', 'x9', 'x10', 'Flex', 'SupB', 'BotB', 'TopB'].map(
      (champion) => ({ champion }),
    );
    c.match.games[0].winner = 'ally';
    c.match.games.push(newGame({ allySide: 'blue', firstPick: 'ally' }));
    c.gameIndex = 1;
    at(c, BANS);
    const jgb = recommend(c, 50)!.items.find((i) => i.champion === 'JgB')!;
    expect(jgb).toBeDefined();
    expect(jgb.parts.deny).toBe(0);
    expect(jgb.reasons.some((r) => r.text.startsWith('抢走'))).toBe(false);
  });
});

describe('lookahead', () => {
  it('prefers the pick that leaves the opponent the weaker reply', () => {
    // The enemy jungler is great on JgB only. Both junglers look equal to us, but taking
    // JgB also removes the enemy's best reply, so lookahead should rank it first.
    const c = at(
      ctx({ teams: { ally: team('us'), enemy: team('them', { jungle: { JgB: 5, JgA: 1 } }) } }),
      BANS,
    );
    c.match.mode = 'normal';
    c.weights = { ...DEFAULT_WEIGHTS, deny: 0, flex: 0 };
    const greedy = recommend(c, { limit: 20 })!;
    const deep = recommend(c, { limit: 20, lookahead: true })!;
    const rank = (r: typeof greedy, id: string) => r.items.findIndex((i) => i.champion === id);
    expect(rank(deep, 'JgB')).toBeLessThan(rank(deep, 'JgA'));
    expect(deep.items.find((i) => i.champion === 'JgB')!.parts.lookahead).toBe(0);
    expect(greedy.items[0].parts.lookahead).toBeUndefined();
  });

  it('does nothing for bans', () => {
    const r = recommend(ctx(), { lookahead: true })!;
    expect(r.type).toBe('ban');
    expect(r.items.every((i) => i.parts.lookahead === undefined)).toBe(true);
  });
});

