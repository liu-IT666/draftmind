import { useMemo, useState } from 'react';
import { CHAMPIONS, CHAMP_BY_ID, matchesSearch } from '../data';
import { sampleTeams } from '../data/sampleTeams';
import { ROLE_LABELS } from '../engine/scorer';
import { ROLES, type Role, type Team } from '../engine/types';
import { emptyTeam, setPlayerStars, type Lang } from '../store';
import { ChampIcon, champName } from './ChampIcon';

interface Props {
  teams: Team[];
  lang: Lang;
  onChange: (teams: Team[]) => void;
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'on' : ''} onClick={() => onChange(n)} title={`${n} 星`}>
          ★
        </button>
      ))}
    </span>
  );
}

function AddChampion({ role, exclude, onAdd }: { role: Role; exclude: Record<string, number>; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return CHAMPIONS.filter((c) => !exclude[c.id] && matchesSearch(c, q))
      .sort((a, b) => Number(b.positions.includes(role)) - Number(a.positions.includes(role)))
      .slice(0, 8);
  }, [q, exclude, role]);
  const add = (id: string) => {
    onAdd(id);
    setQ('');
  };
  return (
    <div className="add-champ">
      <input
        placeholder="添加英雄（拼音/名字）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && add(results[0].id)}
      />
      {results.length > 0 && (
        <div className="add-results">
          {results.map((c) => (
            <button key={c.id} onClick={() => add(c.id)}>
              <ChampIcon id={c.id} size={24} />
              {c.titleZh} {c.nameZh}
              {!c.positions.includes(role) && <em className="muted"> 非常规位置</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PoolEditor({ teams, lang, onChange }: Props) {
  const [selected, setSelected] = useState<string | undefined>(teams[0]?.id);
  const team = teams.find((t) => t.id === selected) ?? teams[0];
  const update = (t: Team) => onChange(teams.map((x) => (x.id === t.id ? t : x)));

  const exportTeam = () => {
    const blob = new Blob([JSON.stringify(team, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `draftmind-${team.name || 'team'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importTeam = async (file: File) => {
    try {
      const t = JSON.parse(await file.text()) as Team;
      if (!t.players || !ROLES.every((r) => t.players[r])) throw new Error('格式不对');
      const clean = { ...t, id: Math.random().toString(36).slice(2, 10) };
      ROLES.forEach((r) => {
        clean.players[r].pool = Object.fromEntries(Object.entries(clean.players[r].pool ?? {}).filter(([c]) => CHAMP_BY_ID[c]));
      });
      onChange([...teams, clean]);
      setSelected(clean.id);
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="pool-editor">
      <aside className="team-list">
        <h3>战队</h3>
        {teams.map((t) => (
          <button key={t.id} className={t.id === team?.id ? 'on' : ''} onClick={() => setSelected(t.id)}>
            {t.name || '未命名'}
            <span className="muted small">
              {ROLES.reduce((n, r) => n + Object.keys(t.players[r].pool).length, 0)} 个英雄
            </span>
          </button>
        ))}
        <button
          className="ghost"
          onClick={() => {
            const t = emptyTeam(`新战队 ${teams.length + 1}`);
            onChange([...teams, t]);
            setSelected(t.id);
          }}
        >
          + 新建战队
        </button>
        <button
          className="ghost"
          title="两支虚构战队，用来体验推荐效果"
          onClick={() => {
            const s = sampleTeams();
            onChange([...teams, ...s]);
            setSelected(s[0].id);
          }}
        >
          + 加载示例战队
        </button>
        <label className="ghost file">
          导入 JSON
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importTeam(e.target.files[0])} />
        </label>
      </aside>
      {team && (
        <section className="team-detail">
          <div className="team-detail-head">
            <input className="team-name" value={team.name} onChange={(e) => update({ ...team, name: e.target.value })} />
            <button onClick={exportTeam}>导出 JSON</button>
            <button
              className="danger"
              disabled={teams.length <= 2}
              title={teams.length <= 2 ? '至少保留两支战队' : ''}
              onClick={() => {
                if (!confirm(`删除战队「${team.name}」？`)) return;
                onChange(teams.filter((t) => t.id !== team.id));
                setSelected(teams.find((t) => t.id !== team.id)?.id);
              }}
            >
              删除
            </button>
          </div>
          <p className="muted small">熟练度 1–5 星：5 = 绝活，4 = 比赛可用，3 = 能玩，1–2 = 应急。推荐只会给选手安排他会玩的英雄（可在设置里关闭）。</p>
          <div className="players">
            {ROLES.map((r) => {
              const p = team.players[r];
              const entries = Object.entries(p.pool).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
              return (
                <div key={r} className="player-card">
                  <div className="player-head">
                    <span className="role-chip">{ROLE_LABELS[r]}</span>
                    <input
                      placeholder="选手 ID"
                      value={p.name}
                      onChange={(e) => update({ ...team, players: { ...team.players, [r]: { ...p, name: e.target.value } } })}
                    />
                  </div>
                  <AddChampion role={r} exclude={p.pool} onAdd={(id) => update(setPlayerStars(team, r, id, 3))} />
                  <ul className="pool-list">
                    {entries.map(([c, s]) => (
                      <li key={c}>
                        <ChampIcon id={c} size={28} />
                        <span className="pool-name">{champName(c, lang)}</span>
                        <Stars value={s} onChange={(n) => update(setPlayerStars(team, r, c, n))} />
                        <button className="x" title="移除" onClick={() => update(setPlayerStars(team, r, c, 0))}>
                          ×
                        </button>
                      </li>
                    ))}
                    {entries.length === 0 && <li className="muted small">还没有英雄</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
