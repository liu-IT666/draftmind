import { ROLE_LABELS } from '../engine/scorer';
import { ROLES, type Team, type TeamId } from '../engine/types';
import type { Lang } from '../store';
import { ChampIcon } from './ChampIcon';

interface Props {
  teams: Record<TeamId, Team | undefined>;
  /** Champions each team can no longer pick in this series. */
  locked: Record<TeamId, Set<string>>;
  used: Record<TeamId, string[]>;
  lang: Lang;
}

/** Fearless planning view: what each player still has left in the series. */
export function SeriesPools({ teams, locked, used }: Props) {
  return (
    <div className="series-pools">
      {(['ally', 'enemy'] as TeamId[]).map((tid) => {
        const t = teams[tid];
        return (
          <div key={tid} className="sp-team">
            <h4>
              {t?.name ?? tid} · 已用 {used[tid].length} 个
            </h4>
            {!t || ROLES.every((r) => Object.keys(t.players[r].pool).length === 0) ? (
              <div className="muted small">还没有录入英雄池。在「英雄池」页添加后，这里会显示每名选手剩余的强势英雄。</div>
            ) : (
              ROLES.map((r) => {
                const pool = Object.entries(t.players[r].pool).sort((a, b) => b[1] - a[1]);
                const left = pool.filter(([c]) => !locked[tid].has(c));
                const strongLeft = left.filter(([, s]) => s >= 4).length;
                return (
                  <div key={r} className="sp-row">
                    <span className="sp-role">
                      {ROLE_LABELS[r]}
                      {t.players[r].name && <em>{t.players[r].name}</em>}
                    </span>
                    <span className={`sp-count${strongLeft <= 1 ? ' warn' : ''}`} title="剩余 4 星以上英雄数">
                      {strongLeft}
                    </span>
                    <span className="sp-champs">
                      {pool.map(([c, s]) => (
                        <span key={c} className={`sp-champ s${s}`} title={`${s} 星${locked[tid].has(c) ? '，已锁定' : ''}`}>
                          <ChampIcon id={c} size={26} dim={locked[tid].has(c)} />
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
