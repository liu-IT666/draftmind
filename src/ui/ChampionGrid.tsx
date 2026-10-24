import { useMemo, useState } from 'react';
import { CHAMPIONS, matchesSearch } from '../data';
import { ROLE_LABELS } from '../engine/scorer';
import { ROLES, type Role } from '../engine/types';
import type { Lang } from '../store';
import { ChampIcon, champName } from './ChampIcon';

interface Props {
  lang: Lang;
  /** Reason a champion cannot be chosen, or null. */
  blocked: (id: string) => string | null;
  onPick: (id: string) => void;
  disabled?: boolean;
  highlight?: Set<string>;
}

export function ChampionGrid({ lang, blocked, onPick, disabled, highlight }: Props) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const list = useMemo(
    () =>
      CHAMPIONS.filter((c) => matchesSearch(c, q) && (!role || c.positions.includes(role))).sort((a, b) =>
        lang === 'zh' ? a.titleZh.localeCompare(b.titleZh, 'zh-CN') : a.nameEn.localeCompare(b.nameEn),
      ),
    [q, role, lang],
  );

  const submitFirst = () => {
    const first = list.find((c) => !blocked(c.id));
    if (first && !disabled) {
      onPick(first.id);
      setQ('');
    }
  };

  return (
    <div className="grid-panel">
      <div className="grid-toolbar">
        <input
          className="search"
          placeholder="搜索：名字 / 称号 / 拼音 / 首字母 / 俗称，回车选第一个"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitFirst()}
          autoFocus
        />
        <div className="role-filter">
          <button className={!role ? 'on' : ''} onClick={() => setRole(null)}>
            全部
          </button>
          {ROLES.map((r) => (
            <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(role === r ? null : r)}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div className="champ-grid">
        {list.map((c) => {
          const why = blocked(c.id);
          return (
            <button
              key={c.id}
              className={`champ-cell${why ? ' blocked' : ''}${highlight?.has(c.id) ? ' hl' : ''}`}
              disabled={!!why || disabled}
              title={why ? `${c.nameZh}：${why}` : `${c.nameZh} ${c.titleZh} · ${c.nameEn}`}
              onClick={() => {
                onPick(c.id);
                setQ('');
              }}
            >
              <ChampIcon id={c.id} size={48} dim={!!why} title="" />
              <span>{champName(c.id, lang)}</span>
              {why === '全局 BP 已锁定' && <i className="lock">锁</i>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
