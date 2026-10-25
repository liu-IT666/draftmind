import { CHAMP_BY_ID } from '../data';
import { sideOf, type DraftView } from '../engine/rules';
import { ROLE_LABELS } from '../engine/scorer';
import { ROLES, type Game, type Role, type Side, type Team, type TeamId } from '../engine/types';
import type { Lang } from '../store';
import { ChampIcon, champName } from './ChampIcon';

interface Props {
  game: Game;
  view: DraftView;
  teams: Record<TeamId, Team | undefined>;
  roles: Record<TeamId, Record<string, Role>>;
  lang: Lang;
  onRoleChange: (team: TeamId, champ: string, role: Role) => void;
}

function TeamColumn({ team, side, props }: { team: TeamId; side: Side; props: Props }) {
  const { game, view, teams, roles, lang, onRoleChange } = props;
  const t = teams[team];
  const active = view.next?.teamId === team;
  const isFirst = game.setup.firstPick === team;
  const bans = view.bans[team];
  const picks = view.picks[team];
  return (
    <div className={`team-col ${side}${active ? ' active' : ''}`}>
      <div className="team-head">
        <span className="side-tag">{side === 'blue' ? '蓝方' : '红方'}</span>
        <strong>{t?.name ?? (team === 'ally' ? '我方' : '对手')}</strong>
        {isFirst && <span className="fp-tag">先手</span>}
      </div>
      <div className="ban-row">
        {Array.from({ length: 5 }, (_, i) => {
          const b = bans[i];
          const current = active && view.next?.type === 'ban' && i === bans.length;
          return (
            <div key={i} className={`ban-slot${current ? ' current' : ''}`}>
              {b ? <ChampIcon id={b} size={32} dim /> : i < bans.length ? <span className="empty-ban">空</span> : null}
            </div>
          );
        })}
      </div>
      <div className="pick-list">
        {Array.from({ length: 5 }, (_, i) => {
          const p = picks[i];
          const current = active && view.next?.type === 'pick' && i === picks.length;
          const role = p ? roles[team][p] : undefined;
          return (
            <div key={i} className={`pick-slot${current ? ' current' : ''}`}>
              {p ? (
                <>
                  <ChampIcon id={p} size={44} />
                  <div className="pick-info">
                    <div className="pick-name">{champName(p, lang)}</div>
                    <div className="pick-role">
                      <select value={role} onChange={(e) => onRoleChange(team, p, e.target.value as Role)}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                            {t?.players[r].name ? ` · ${t.players[r].name}` : ''}
                            {CHAMP_BY_ID[p]?.positions.includes(r) ? '' : ' ?'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <span className="pick-placeholder">{current ? '选择中…' : ''}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DraftBoard(props: Props) {
  const blueTeam: TeamId = sideOf(props.game, 'ally') === 'blue' ? 'ally' : 'enemy';
  const redTeam: TeamId = blueTeam === 'ally' ? 'enemy' : 'ally';
  return (
    <>
      <TeamColumn team={blueTeam} side="blue" props={props} />
      <TeamColumn team={redTeam} side="red" props={props} />
    </>
  );
}
