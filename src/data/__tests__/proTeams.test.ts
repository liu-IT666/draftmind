import { describe, expect, it } from 'vitest';
import { CHAMP_BY_ID } from '..';
import roster from '../proTeams.json';
import { proTeamToTeam, type ProTeamsFile } from '../proTeams';
import { ROLES } from '../../engine/types';

const file = roster as unknown as ProTeamsFile;

describe('pro team import', () => {
  it('maps games played to stars and drops unknown champions', () => {
    const t = proTeamToTeam(
      {
        name: 'T',
        league: 'LPL',
        lastGame: '2026-10-01',
        players: {
          top: { name: 'a', games: 6, champions: { Rumble: [1, 1], KSante: [2, 0], Jayce: [5, 3], NotAChamp: [9, 9] } },
          jungle: { name: 'b', games: 0, champions: {} },
          mid: { name: 'c', games: 0, champions: {} },
          bot: { name: 'd', games: 0, champions: {} },
          support: { name: 'e', games: 0, champions: {} },
        },
      },
      (id) => !!CHAMP_BY_ID[id],
    );
    expect(t.players.top.pool).toEqual({ Rumble: 3, KSante: 4, Jayce: 5 });
    expect(t.players.top.name).toBe('a');
  });

  it('ships a roster whose champion ids all exist', () => {
    expect(file.teams.length).toBeGreaterThan(40);
    for (const team of file.teams) {
      for (const r of ROLES) {
        for (const c of Object.keys(team.players[r].champions)) expect(CHAMP_BY_ID[c], `${team.name} ${c}`).toBeDefined();
      }
    }
  });
});
