import { ROLES, type Champion, type Role, type Team } from './types';

function permutations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const p of permutations(rest, k - 1)) out.push([item, ...p]);
  });
  return out;
}

/** How natural it is for a champion to be played in a role by this team (higher is better). */
export function roleAffinity(champ: Champion, role: Role, team?: Team): number {
  let score = champ.positions.includes(role) ? 3 - champ.positions.indexOf(role) * 0.3 : 0;
  const stars = team?.players[role]?.pool[champ.id];
  if (stars) score += stars;
  return score;
}

/**
 * Assigns picked champions to roles. Manual overrides are kept; the rest are placed by
 * the best total affinity (at most 5! orderings, so brute force is fine).
 */
export function assignRoles(
  picks: string[],
  champs: Record<string, Champion>,
  team?: Team,
  overrides: Partial<Record<string, Role>> = {},
): Record<string, Role> {
  const result: Record<string, Role> = {};
  const used = new Set<Role>();
  for (const c of picks) {
    const r = overrides[c];
    if (r && !used.has(r)) {
      result[c] = r;
      used.add(r);
    }
  }
  const rest = picks.filter((c) => !(c in result));
  const free = ROLES.filter((r) => !used.has(r));
  let best: Role[] = [];
  let bestScore = -Infinity;
  for (const perm of permutations(free, rest.length)) {
    const s = perm.reduce((sum, r, i) => sum + (champs[rest[i]] ? roleAffinity(champs[rest[i]], r, team) : 0), 0);
    if (s > bestScore) {
      bestScore = s;
      best = perm;
    }
  }
  rest.forEach((c, i) => (result[c] = best[i]));
  return result;
}

export function openRoles(assigned: Record<string, Role>): Role[] {
  const used = new Set(Object.values(assigned));
  return ROLES.filter((r) => !used.has(r));
}

function plausible(champ: Champion | undefined, role: Role, team?: Team): boolean {
  if (!champ) return true;
  return champ.positions.includes(role) || !!team?.players[role]?.pool[champ.id];
}

/**
 * Roles a new champion could fill, given the team's current picks. A flex pick already on
 * the team may move to another role to make room (e.g. Gragas from jungle to top).
 */
export function candidateRoles(
  candidate: Champion,
  picks: string[],
  champs: Record<string, Champion>,
  team?: Team,
  overrides: Partial<Record<string, Role>> = {},
): Role[] {
  const out: Role[] = [];
  for (const role of ROLES) {
    if (!plausible(candidate, role, team)) continue;
    if (Object.values(overrides).includes(role) && picks.some((p) => overrides[p] === role)) continue;
    const free = ROLES.filter((r) => r !== role && !picks.some((p) => overrides[p] === r));
    const rest = picks.filter((p) => !overrides[p]);
    const fits = permutations(free, rest.length).some((perm) =>
      perm.every((r, i) => plausible(champs[rest[i]], r, team)),
    );
    if (fits) out.push(role);
  }
  return out;
}
