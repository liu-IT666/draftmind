import type { Role, Team } from '../engine/types';

export interface ProPlayer {
  name: string;
  games: number;
  /** Champion id -> [games, wins] on this role. */
  champions: Record<string, [number, number]>;
}

export interface ProTeam {
  name: string;
  league: string;
  lastGame: string;
  players: Record<Role, ProPlayer>;
}

export interface ProTeamsFile {
  source: string;
  license: string;
  since: string;
  teams: ProTeam[];
}

/** Stars from games played: 1 game = 能玩, 2 = 比赛可用, 3+ = 绝活. Same mapping the backtest uses. */
export const starsFromGames = (n: number) => Math.min(5, 2 + n);

/** Loaded on demand so the ~90 KB roster stays out of the main bundle. */
export const loadProTeams = () => import('./proTeams.json').then((m) => m.default as unknown as ProTeamsFile);

export function proTeamToTeam(t: ProTeam, known: (id: string) => boolean): Team {
  const players = Object.fromEntries(
    (Object.entries(t.players) as [Role, ProPlayer][]).map(([r, p]) => [
      r,
      {
        name: p.name,
        pool: Object.fromEntries(
          Object.entries(p.champions)
            .filter(([c]) => known(c))
            .map(([c, [n]]) => [c, starsFromGames(n)]),
        ),
      },
    ]),
  ) as Team['players'];
  return { id: Math.random().toString(36).slice(2, 10), name: t.name, players };
}
