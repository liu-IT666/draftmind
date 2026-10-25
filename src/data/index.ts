import championData from './champions.json';
import type { Champion, StatsPack } from '../engine/types';

export const CHAMPIONS = championData.champions as Champion[];
export const CHAMPION_PATCH = championData.patch;
export const CHAMP_BY_ID: Record<string, Champion> = Object.fromEntries(CHAMPIONS.map((c) => [c.id, c]));

const packs = import.meta.glob<{ default: StatsPack }>('./stats/*.json', { eager: true });
export const BUILTIN_STATS: StatsPack | null = packs['./stats/pro.json']?.default ?? null;

export const iconUrl = (id: string) => `${import.meta.env.BASE_URL}champions/${id}.png`;

export function matchesSearch(c: Champion, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return c.search.some((w) => w.toLowerCase().includes(s));
}
