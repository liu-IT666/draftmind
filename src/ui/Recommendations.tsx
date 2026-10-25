import { FACTOR_LABELS, ROLE_LABELS, type FactorKey, type PairRecommendation, type Recommendation } from '../engine/scorer';
import type { TeamId } from '../engine/types';
import type { Lang } from '../store';
import { ChampIcon, champName } from './ChampIcon';

const COLORS: Record<FactorKey | 'threat', string> = {
  meta: 'var(--f-meta)',
  proficiency: 'var(--f-prof)',
  counter: 'var(--f-counter)',
  synergy: 'var(--f-syn)',
  compFit: 'var(--f-comp)',
  flex: 'var(--f-flex)',
  deny: 'var(--f-deny)',
  threat: 'var(--f-counter)',
  exposure: 'var(--f-cost)',
  scarcity: 'var(--f-cost)',
  lookahead: 'var(--f-cost)',
};

interface Props {
  rec: { team: TeamId; type: 'ban' | 'pick'; items: Recommendation[] } | null;
  pairs: PairRecommendation[] | null;
  lang: Lang;
  onApply: (id: string) => void;
  onApplyPair: (ids: [string, string]) => void;
  hasStats: boolean;
}

export function Recommendations({ rec, pairs, lang, onApply, onApplyPair, hasStats }: Props) {
  if (!rec) return <div className="rec-panel muted">本局 BP 已完成。记录胜负后可以开始下一局。</div>;
  const ours = rec.team === 'ally';
  const title = ours ? (rec.type === 'pick' ? '推荐 Pick' : '推荐 Ban') : rec.type === 'pick' ? '对方可能 Pick' : '对方可能 Ban';
  const max = Math.max(0.01, ...rec.items.map((i) => i.total));
  return (
    <div className="rec-panel">
      <div className="rec-title">
        <h3>{title}</h3>
        {!ours && <span className="muted small">按对方英雄池预测，点击可直接录入</span>}
      </div>
      {!hasStats && <div className="notice small">未加载职业赛数据，版本强度、克制、协同暂按中性计算。</div>}
      {rec.items.length === 0 && <div className="muted">没有可推荐的英雄。检查英雄池或关闭「仅推荐英雄池内」。</div>}
      {pairs && pairs.length > 0 && (
        <div className="pair-box">
          <h4>{ours ? '连续两手组合' : '对方可能的两手组合'}</h4>
          <ol className="pair-list">
            {pairs.map((p) => (
              <li key={p.champions.join('+')} onClick={() => onApplyPair(p.champions)} title="点击连续录入这两手">
                {p.champions.map((c, i) => (
                  <span key={c} className="pair-champ">
                    <ChampIcon id={c} size={28} />
                    <span>
                      {champName(c, lang)}
                      {p.roles[i] && <em className="muted small"> {ROLE_LABELS[p.roles[i]!]}</em>}
                    </span>
                  </span>
                ))}
                <span className="score">{p.total.toFixed(2)}</span>
                {p.reasons.length > 0 && (
                  <ul className="reasons">
                    {p.reasons.slice(0, 2).map((x, i) => (
                      <li key={i} className={x.tone}>
                        {x.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <h4>单手排序</h4>
        </div>
      )}
      <ol className="rec-list">
        {rec.items.map((r) => (
          <li key={r.champion} className="rec-item" onClick={() => onApply(r.champion)} title="点击录入这一步">
            <ChampIcon id={r.champion} size={40} />
            <div className="rec-body">
              <div className="rec-head">
                <strong>{champName(r.champion, lang)}</strong>
                {r.role && (
                  <span className="role-chip">
                    {ROLE_LABELS[r.role]}
                    {r.player ? ` · ${r.player}` : ''}
                  </span>
                )}
                <span className="score">{r.total.toFixed(2)}</span>
              </div>
              <div className="bar" title={barTitle(r)}>
                {(Object.entries(r.parts) as [FactorKey, number][])
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <span key={k} style={{ width: `${(v / max) * 100}%`, background: COLORS[k] }} />
                  ))}
              </div>
              <ul className="reasons">
                {r.reasons.slice(0, 4).map((x, i) => (
                  <li key={i} className={x.tone}>
                    {x.text}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function barTitle(r: Recommendation) {
  return (Object.entries(r.parts) as [FactorKey, number][])
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([k, v]) => `${FACTOR_LABELS[k]} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
    .join('\n');
}

export function FactorLegend() {
  const keys: FactorKey[] = ['meta', 'proficiency', 'counter', 'synergy', 'compFit', 'flex', 'deny'];
  return (
    <div className="legend small">
      {keys.map((k) => (
        <span key={k}>
          <i style={{ background: COLORS[k] }} />
          {FACTOR_LABELS[k]}
        </span>
      ))}
    </div>
  );
}
