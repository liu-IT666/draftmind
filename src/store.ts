import { useEffect, useState } from 'react';
import { newGame, newMatch } from './engine/rules';
import { DEFAULT_WEIGHTS, type Weights } from './engine/scorer';
import { ROLES, type Match, type Role, type StatsPack, type Team } from './engine/types';

export type Server = 'cn' | 'global';
export type Lang = 'zh' | 'en';

export interface AppState {
  version: 1;
  server: Server;
  lang: Lang;
  teams: Team[];
  allyTeamId: string;
  enemyTeamId: string;
  match: Match;
  gameIndex: number;
  weights: Weights;
  strictPool: boolean;
  /** Shallow search over the opponent's best reply when ranking picks. */
  lookahead: boolean;
  /** A stats pack imported by the user, replacing the built-in one. */
  customStats: StatsPack | null;
}

const KEY = 'draftmind.state.v1';

export function emptyTeam(name: string): Team {
  const players = Object.fromEntries(ROLES.map((r) => [r, { name: '', pool: {} }])) as Team['players'];
  return { id: Math.random().toString(36).slice(2, 10), name, players };
}

function initial(): AppState {
  const ally = emptyTeam('我方');
  const enemy = emptyTeam('对手');
  return {
    version: 1,
    server: 'cn',
    lang: 'zh',
    teams: [ally, enemy],
    allyTeamId: ally.id,
    enemyTeamId: enemy.id,
    match: newMatch(3, 'hard', { allySide: 'blue', firstPick: 'ally' }),
    gameIndex: 0,
    weights: DEFAULT_WEIGHTS,
    strictPool: true,
    lookahead: true,
    customStats: null,
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.version === 1) return { ...initial(), ...s, weights: { ...DEFAULT_WEIGHTS, ...s.weights } };
    }
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return initial();
}

export function useAppState() {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Quota or private mode: keep working in memory.
    }
  }, [state]);
  return [state, setState] as const;
}

/** Deep-ish clone for immutable updates of the match. */
export const cloneMatch = (m: Match): Match => JSON.parse(JSON.stringify(m));

export function startNextGame(m: Match): Match {
  const next = cloneMatch(m);
  const last = next.games[next.games.length - 1];
  // Default: the loser of the previous game gets the choice; keep sides as a starting guess.
  const loser = last.winner === 'ally' ? 'enemy' : 'ally';
  next.games.push(newGame({ allySide: last.setup.allySide, firstPick: last.winner ? loser : last.setup.firstPick }));
  return next;
}

export function setPlayerStars(team: Team, role: Role, champ: string, stars: number): Team {
  const pool = { ...team.players[role].pool };
  if (stars <= 0) delete pool[champ];
  else pool[champ] = stars;
  return { ...team, players: { ...team.players, [role]: { ...team.players[role], pool } } };
}
