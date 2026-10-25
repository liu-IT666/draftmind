import { CHAMPION_PATCH } from '../data';
import { DEFAULT_WEIGHTS, FACTOR_LABELS, type Weights } from '../engine/scorer';
import type { StatsPack } from '../engine/types';
import type { AppState } from '../store';

interface Props {
  state: AppState;
  stats: StatsPack | null;
  onChange: (patch: Partial<AppState>) => void;
}

const HELP: Record<keyof Weights, string> = {
  meta: '职业赛 BP 率和胜率，按位置折算',
  proficiency: '选手英雄池星级',
  counter: '对线对手的对位胜率差（职业赛数据，已做小样本收缩）',
  synergy: '与己方已选英雄同队时的胜率差',
  compFit: '补足 AP/AD、前排、开团',
  flex: '能打多个位置，前几手更有价值',
  deny: '对方想要的英雄（对方英雄池 + 版本强度）；硬全局下额外加成',
  exposure: '选了以后容易被对方剩余英雄针对（扣分）',
  scarcity: '全局 BP 下用掉选手少有的强势英雄的代价（扣分）',
  lookahead: '模拟对方下一手：选了以后对方最佳应对越强，扣分越多',
  threat: 'Ban 时额外考虑对我方已选英雄的克制',
};

function patchRange(stats: StatsPack) {
  const patches = Object.keys(stats.patches ?? {}).filter(Boolean);
  if (patches.length === 0) return '';
  return `，版本 ${patches[0]}${patches.length > 1 ? `–${patches[patches.length - 1]}` : ''}`;
}

export function Settings({ state, stats, onChange }: Props) {
  const setWeight = (k: keyof Weights, v: number) => onChange({ weights: { ...state.weights, [k]: v } });
  const importStats = async (file: File) => {
    try {
      const pack = JSON.parse(await file.text()) as StatsPack;
      if (!pack.champions || !pack.counters || !pack.synergy) throw new Error('缺少 champions / counters / synergy');
      onChange({ customStats: pack });
    } catch (e) {
      alert(`导入失败：${(e as Error).message}`);
    }
  };
  return (
    <div className="settings">
      <section>
        <h3>推荐权重</h3>
        <p className="muted small">拖动调整各维度的重要程度。改动会立即反映到推荐里。</p>
        {(Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).map((k) => (
          <div key={k} className="weight-row">
            <label>
              {FACTOR_LABELS[k]}
              <span className="muted small">{HELP[k]}</span>
            </label>
            <input type="range" min={0} max={5} step={0.05} value={state.weights[k]} onChange={(e) => setWeight(k, Number(e.target.value))} />
            <span className="num">{state.weights[k].toFixed(2)}</span>
          </div>
        ))}
        <button onClick={() => onChange({ weights: DEFAULT_WEIGHTS })}>恢复默认</button>
        <label className="check">
          <input type="checkbox" checked={state.lookahead} onChange={(e) => onChange({ lookahead: e.target.checked })} />
          前瞻搜索：Pick 推荐模拟对方的最佳应对（前 10 名重排）
        </label>
        <label className="check">
          <input type="checkbox" checked={state.strictPool} onChange={(e) => onChange({ strictPool: e.target.checked })} />
          仅推荐英雄池内的英雄（选手英雄池为空时不限制）
        </label>
      </section>
      <section>
        <h3>数据</h3>
        <dl className="data-info">
          <dt>英雄数据</dt>
          <dd>Data Dragon {CHAMPION_PATCH}（中文 / 英文）</dd>
          <dt>统计数据</dt>
          <dd>
            {stats ? (
              <>
                {stats.source}，{stats.games} 局，{stats.since ? `${stats.since} 起` : ''}
                {patchRange(stats)}
                {stats.tournaments && `，${Object.keys(stats.tournaments).length} 个赛事`}
                {stats.generatedAt && `，生成于 ${stats.generatedAt}`}
                {state.customStats && '（已导入自定义数据）'}
              </>
            ) : (
              '未加载'
            )}
          </dd>
          <dt>区服</dt>
          <dd>
            {state.server === 'cn'
              ? '国服：没有公开数据接口，统计数据使用职业赛（含 LPL）与外服数据，仅供参考。'
              : '外服：使用职业赛数据。'}
          </dd>
        </dl>
        <label className="ghost file">
          导入统计数据（JSON）
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importStats(e.target.files[0])} />
        </label>
        {state.customStats && <button onClick={() => onChange({ customStats: null })}>恢复内置数据</button>}
        <p className="muted small">内置统计数据由 pipeline/oracles_elixir.py 从 Oracle's Elixir 职业赛数据生成，格式见 README。</p>
      </section>
    </div>
  );
}
