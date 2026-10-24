import type { Role, Team } from '../engine/types';

type Pools = Record<Role, [string, Record<string, number>]>;

function make(name: string, pools: Pools): Team {
  const players = Object.fromEntries(
    Object.entries(pools).map(([r, [n, pool]]) => [r, { name: n, pool }]),
  ) as Team['players'];
  return { id: Math.random().toString(36).slice(2, 10), name, players };
}

/** Fictional demo teams so a new user can see recommendations before entering real pools. */
export function sampleTeams(): Team[] {
  return [
    make('示例战队 A', {
      top: ['A-上单', { Rumble: 5, KSante: 4, Jayce: 4, Gnar: 3, Renekton: 3, Ambessa: 4 }],
      jungle: ['A-打野', { Vi: 5, XinZhao: 4, Sejuani: 4, Nocturne: 3, LeeSin: 4, JarvanIV: 3 }],
      mid: ['A-中单', { Orianna: 5, Azir: 4, Taliyah: 4, Syndra: 3, Ryze: 4, Annie: 3 }],
      bot: ['A-ADC', { Kalista: 5, Varus: 4, Ezreal: 4, Xayah: 3, Lucian: 4, Jhin: 3 }],
      support: ['A-辅助', { Rakan: 5, Alistar: 4, Nautilus: 4, Rell: 3, Leona: 3, Milio: 3 }],
    }),
    make('示例战队 B', {
      top: ['B-上单', { Aatrox: 5, Ornn: 4, Gragas: 3, Sion: 4, Rumble: 3, Shen: 4 }],
      jungle: ['B-打野', { Sejuani: 5, Skarner: 4, MonkeyKing: 4, Viego: 3, Vi: 3, Pantheon: 3 }],
      mid: ['B-中单', { Sylas: 5, Ahri: 4, Yone: 4, Galio: 3, Cassiopeia: 3, Orianna: 3 }],
      bot: ['B-ADC', { Aphelios: 5, Zeri: 4, Kaisa: 4, Varus: 3, Corki: 3, Ashe: 4 }],
      support: ['B-辅助', { Nautilus: 5, Braum: 4, Rakan: 4, Renata: 3, Lulu: 4, Thresh: 3 }],
    }),
  ];
}
