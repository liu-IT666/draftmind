import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILTIN_STATS, CHAMPIONS, CHAMPION_PATCH } from './data';
import {
  fearlessActive,
  getOrder,
  lockedFor,
  newMatch,
  replay,
  seriesOver,
  seriesPicks,
  seriesScore,
  unavailableReason,
} from './engine/rules';
import { recommend, recommendPairs, teamRoles, type ScoreContext } from './engine/scorer';
import type { FearlessMode, Role, SeriesFormat, Side, TeamId } from './engine/types';
import { cloneMatch, startNextGame, useAppState, type AppState } from './store';
import { ChampionGrid } from './ui/ChampionGrid';
import { DraftBoard } from './ui/DraftBoard';
import { PoolEditor } from './ui/PoolEditor';
import { FactorLegend, Recommendations } from './ui/Recommendations';
import { SeriesPools } from './ui/SeriesPools';
import { Settings } from './ui/Settings';

type Tab = 'draft' | 'pools' | 'settings';
const MODE_LABELS: Record<FearlessMode, string> = { hard: '硬全局', soft: '软全局', normal: '普通 BP' };

export default function App() {
  const [state, setState] = useAppState();
  const [tab, setTab] = useState<Tab>('draft');
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));

  const { match, gameIndex } = state;
  const game = match.games[gameIndex];
  const order = getOrder(match.orderId);
  const view = useMemo(() => replay(game, order), [game, order]);
  const stats = state.customStats ?? BUILTIN_STATS;
  const teams = useMemo(
    () => ({
      ally: state.teams.find((t) => t.id === state.allyTeamId),
      enemy: state.teams.find((t) => t.id === state.enemyTeamId),
    }),
    [state.teams, state.allyTeamId, state.enemyTeamId],
  );
  const ctx: ScoreContext = useMemo(
    () => ({ match, gameIndex, champions: CHAMPIONS, stats, teams, weights: state.weights, strictPool: state.strictPool }),
    [match, gameIndex, stats, teams, state.weights, state.strictPool],
  );
  const rec = useMemo(() => recommend(ctx, { limit: 8, lookahead: state.lookahead }), [ctx, state.lookahead]);
  const pairs = useMemo(() => recommendPairs(ctx, 4), [ctx]);
  const roles = useMemo(() => teamRoles(ctx), [ctx]);
  const locked = useMemo(
    () => ({ ally: lockedFor(match, gameIndex, 'ally'), enemy: lockedFor(match, gameIndex, 'enemy') }),
    [match, gameIndex],
  );
  const used = useMemo(() => seriesPicks(match, gameIndex), [match, gameIndex]);
  const score = seriesScore(match);
  const isLastGame = gameIndex === match.games.length - 1;

  const updateMatch = useCallback((fn: (m: typeof match) => void) => {
    setState((s) => {
      const m = cloneMatch(s.match);
      fn(m);
      return { ...s, match: m };
    });
  }, [setState]);

  const act = (...champions: (string | null)[]) => {
    if (!view.next || !isLastGame) return;
    updateMatch((m) => champions.forEach((champion) => m.games[gameIndex].actions.push({ champion })));
  };
  const undo = useCallback(() => updateMatch((m) => m.games[gameIndex].actions.pop()), [updateMatch, gameIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && tab === 'draft') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, tab]);

  const blocked = (id: string) => (view.next ? unavailableReason(match, gameIndex, view.next.teamId, id) : '本局已结束');
  const setRole = (team: TeamId, champ: string, role: Role) =>
    updateMatch((m) => {
      const g = m.games[gameIndex];
      const current = roles[team];
      const o: Partial<Record<string, Role>> = { ...current, ...(g.roleOverrides[team] ?? {}) };
      // Swap with whichever champion currently holds that role.
      const holder = Object.keys(o).find((c) => o[c] === role && c !== champ);
      if (holder) o[holder] = current[champ];
      o[champ] = role;
      g.roleOverrides[team] = o;
    });

  const newSeries = (format: SeriesFormat, mode: FearlessMode) => {
    if (match.games.some((g) => g.actions.length) && !confirm('开始新的系列赛？当前系列赛记录会清空。')) return;
    patch({ match: newMatch(format, mode, game.setup), gameIndex: 0 });
  };

  const setSetup = (p: Partial<typeof game.setup>) =>
    updateMatch((m) => {
      m.games[gameIndex].setup = { ...m.games[gameIndex].setup, ...p };
    });

  const stepLabel = view.next
    ? `第 ${view.stepIndex + 1} / ${order.steps.length} 步 · ${view.next.teamId === 'ally' ? '我方' : '对方'} ${view.next.type === 'ban' ? 'Ban' : 'Pick'}`
    : 'BP 完成';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          DraftMind <span className="muted small">BP 助手 · {CHAMPION_PATCH}</span>
        </div>
        <nav className="tabs">
          {(
            [
              ['draft', 'BP 台'],
              ['pools', '英雄池'],
              ['settings', '设置'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="top-opts">
          <select value={state.server} onChange={(e) => patch({ server: e.target.value as AppState['server'] })} title="区服">
            <option value="cn">国服</option>
            <option value="global">外服</option>
          </select>
          <select value={state.lang} onChange={(e) => patch({ lang: e.target.value as AppState['lang'] })} title="英雄名称语言">
            <option value="zh">中文名</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>

      {tab === 'draft' && (
        <main className="draft">
          <section className="series-bar">
            <div className="group">
              <label>赛制</label>
              {([1, 3, 5] as SeriesFormat[]).map((f) => (
                <button key={f} className={match.format === f ? 'on' : ''} onClick={() => f !== match.format && newSeries(f, match.mode)}>
                  BO{f}
                </button>
              ))}
            </div>
            <div className="group">
              <label>模式</label>
              {(['hard', 'soft', 'normal'] as FearlessMode[]).map((md) => (
                <button key={md} className={match.mode === md ? 'on' : ''} onClick={() => updateMatch((m) => void (m.mode = md))}>
                  {MODE_LABELS[md]}
                </button>
              ))}
              {match.format === 1 && match.mode !== 'normal' && <span className="muted small">BO1 不锁定</span>}
            </div>
            <div className="group">
              <label>我方</label>
              <select value={state.allyTeamId} onChange={(e) => patch({ allyTeamId: e.target.value })}>
                {state.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <label>对手</label>
              <select value={state.enemyTeamId} onChange={(e) => patch({ enemyTeamId: e.target.value })}>
                {state.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="group score">
              比分 {score.ally} : {score.enemy}
            </div>
          </section>

          <section className="game-bar">
            <div className="game-tabs">
              {match.games.map((_, i) => (
                <button key={i} className={i === gameIndex ? 'on' : ''} onClick={() => patch({ gameIndex: i })}>
                  第 {i + 1} 局{match.games[i].winner ? (match.games[i].winner === 'ally' ? ' 胜' : ' 负') : ''}
                </button>
              ))}
              {match.games.length < match.format && !seriesOver(match) && match.games[match.games.length - 1].winner && (
                <button
                  className="primary"
                  onClick={() => patch({ match: startNextGame(match), gameIndex: match.games.length })}
                >
                  + 下一局
                </button>
              )}
              <button className="ghost" onClick={() => newSeries(match.format, match.mode)}>
                新系列赛
              </button>
            </div>
            <div className="group">
              <label>我方在</label>
              {(['blue', 'red'] as Side[]).map((sd) => (
                <button
                  key={sd}
                  className={game.setup.allySide === sd ? `on ${sd}` : ''}
                  disabled={game.actions.length > 0}
                  onClick={() => setSetup({ allySide: sd })}
                >
                  {sd === 'blue' ? '蓝方' : '红方'}
                </button>
              ))}
              <label>先手</label>
              {(['ally', 'enemy'] as TeamId[]).map((t) => (
                <button
                  key={t}
                  className={game.setup.firstPick === t ? 'on' : ''}
                  disabled={game.actions.length > 0}
                  onClick={() => setSetup({ firstPick: t })}
                >
                  {t === 'ally' ? '我方' : '对方'}
                </button>
              ))}
            </div>
          </section>

          <div className="draft-main">
            <div className="board">
              <DraftBoard game={game} view={view} teams={teams} roles={roles} lang={state.lang} onRoleChange={setRole} />
            </div>
            <div className="center">
              <div className={`step-banner ${view.next?.teamId ?? 'done'}`}>
                <span>{stepLabel}</span>
                <span className="actions">
                  {view.next?.type === 'ban' && isLastGame && (
                    <button onClick={() => act(null)} title="跳过这次 Ban">
                      空 Ban
                    </button>
                  )}
                  <button onClick={undo} disabled={game.actions.length === 0} title="Ctrl/⌘ + Z">
                    撤销
                  </button>
                </span>
              </div>
              {view.complete ? (
                <div className="result-box">
                  <p>本局 BP 已完成，记录结果：</p>
                  <button className={game.winner === 'ally' ? 'on' : ''} onClick={() => updateMatch((m) => void (m.games[gameIndex].winner = 'ally'))}>
                    我方胜
                  </button>
                  <button className={game.winner === 'enemy' ? 'on' : ''} onClick={() => updateMatch((m) => void (m.games[gameIndex].winner = 'enemy'))}>
                    对方胜
                  </button>
                  {fearlessActive(match) && <p className="muted small">记录后开始下一局，本局 10 个 Pick 会按{MODE_LABELS[match.mode]}规则锁定。</p>}
                </div>
              ) : (
                <ChampionGrid
                  lang={state.lang}
                  blocked={blocked}
                  onPick={act}
                  disabled={!isLastGame}
                  highlight={new Set(rec?.items.slice(0, 3).map((i) => i.champion))}
                />
              )}
            </div>
            <aside className="side">
              <Recommendations
                rec={rec}
                pairs={pairs}
                lang={state.lang}
                onApply={(id) => act(id)}
                onApplyPair={(ids) => act(...ids)}
                hasStats={!!stats}
              />
              <FactorLegend />
            </aside>
          </div>

          {fearlessActive(match) && (
            <section className="series-section">
              <h3>
                系列赛英雄池 <span className="muted small">{MODE_LABELS[match.mode]}：灰色为已锁定，数字为剩余 4 星以上英雄数</span>
              </h3>
              <SeriesPools teams={teams} locked={locked} used={used} lang={state.lang} />
            </section>
          )}
        </main>
      )}

      {tab === 'pools' && <PoolEditor teams={state.teams} lang={state.lang} onChange={(t) => patch({ teams: t })} />}
      {tab === 'settings' && <Settings state={state} stats={stats} onChange={patch} />}

      <footer className="foot muted small">
        英雄数据：Riot Data Dragon。统计数据：{stats?.source ?? '无'}
        {stats?.license ? `（${stats.license}）` : ''}
        {state.server === 'cn' ? '。国服无公开数据接口，统计数据非国服路人局，仅供参考。' : '。'}
        DraftMind isn't endorsed by Riot Games.
      </footer>
    </div>
  );
}
