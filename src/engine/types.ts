export type Role = 'top' | 'jungle' | 'mid' | 'bot' | 'support';
export const ROLES: Role[] = ['top', 'jungle', 'mid', 'bot', 'support'];

/** Teams are named from the coach's point of view and keep their identity across games. */
export type TeamId = 'ally' | 'enemy';
export type Side = 'blue' | 'red';
export type ActionType = 'ban' | 'pick';
/** F = the team holding first pick in this game, S = the other team. */
export type OrderSlot = 'F' | 'S';

export type FearlessMode = 'normal' | 'hard' | 'soft';
export type SeriesFormat = 1 | 3 | 5;

export interface Champion {
  id: string;
  key: number;
  nameZh: string;
  titleZh: string;
  nameEn: string;
  positions: Role[];
  positionsGuessed: boolean;
  tags: string[];
  roles: string[];
  damage: 'ad' | 'ap';
  toughness: number;
  control: number;
  mobility: number;
  ranged: boolean;
  search: string[];
}

export interface StepDef {
  team: OrderSlot;
  type: ActionType;
}

export interface DraftOrder {
  id: string;
  name: string;
  steps: StepDef[];
}

/** One recorded action. champion null = skipped ban (空 Ban). */
export interface DraftAction {
  champion: string | null;
}

export interface GameSetup {
  allySide: Side;
  firstPick: TeamId;
}

export interface Game {
  setup: GameSetup;
  actions: DraftAction[];
  /** Role assignment per team for picked champions; filled automatically, editable. */
  roleOverrides: Partial<Record<TeamId, Partial<Record<string, Role>>>>;
  winner: TeamId | null;
}

export interface Match {
  format: SeriesFormat;
  mode: FearlessMode;
  orderId: string;
  games: Game[];
  /** Champions disabled on this patch (bugged / hotfix-disabled). */
  disabled: string[];
}

export interface Player {
  name: string;
  /** champion id -> proficiency 1..5 */
  pool: Record<string, number>;
}

export interface Team {
  id: string;
  name: string;
  players: Record<Role, Player>;
}

export interface ChampStats {
  picks: number;
  bans: number;
  presence: number;
  winRate: number;
  roles: Partial<Record<Role, number>>;
}

export interface StatsPack {
  source: string;
  license?: string;
  since?: string;
  games: number;
  patches?: Record<string, number>;
  /** Games per tournament, to show which leagues the pack covers. */
  tournaments?: Record<string, number>;
  generatedAt?: string;
  champions: Record<string, ChampStats>;
  /** counters[a][b] = [win-rate delta of a vs b in the same role, games] */
  counters: Record<string, Record<string, [number, number]>>;
  /** synergy[a][b] = [win-rate delta of a with b on the same team, games] */
  synergy: Record<string, Record<string, [number, number]>>;
}
