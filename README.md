# DraftMind

英雄联盟 BP 助手，面向职业 / 青训战队教练。网页版，手动录入 BP，每一步给出可解释的 Pick / Ban 推荐，支持普通 BP 和全局 BP（Fearless Draft，默认硬全局）。

## 运行

```bash
npm install
npm run dev        # 本地开发，http://localhost:5173
npm test           # 规则引擎和推荐评分的单元测试
npm run build      # 产出 dist/，纯静态文件，可直接部署到任意静态托管
```

不需要后端。战队英雄池、当前系列赛和权重设置都保存在浏览器本地（localStorage），英雄池可以导出 / 导入 JSON 在教练组之间共享。

## 功能（MVP）

- **BP 规则引擎**：标准赛事 20 步顺序（写成数据，见 `src/engine/rules.ts`），BO1 / BO3 / BO5，蓝红方和先手方分开设置（2026 First Selection），空 Ban，撤销（Ctrl/⌘+Z）。
- **全局 BP**：硬全局（默认，双方之前选过的双方都不能再选）、软全局（只锁自己选过的）、普通 BP。BO1 不锁定，Ban 不计入锁定。
- **手动录入**：英雄网格 + 搜索（名字、称号、全拼、首字母、俗称，例如 `ms`、`盲僧`、`瞎子`、`leesin`），回车录入第一个结果，已锁定英雄灰显并标注原因。
- **推荐**：每一步 Top 8，带分项得分条和理由；轮到对方时显示「对方可能」的预测。Pick 推荐会给出位置和选手。
- **英雄池编辑**：每支战队 5 个位置，每名选手每个英雄 1–5 星；可以一键导入一级联赛职业战队（按近期比赛选过的英雄生成初始英雄池），也附两支虚构的示例战队用来体验。
- **系列赛英雄池视图**：全局 BP 下每名选手还剩哪些英雄、剩几个 4 星以上。
- **国服 / 外服**：英雄名中英文切换；国服没有公开数据接口，界面会标明统计数据不是国服路人局数据。

## 推荐怎么算

`src/engine/scorer.ts`，纯函数，可调权重（设置页）：

| 维度 | 来源 |
| --- | --- |
| 版本强度 | 职业赛 BP 率 + 胜率，按该英雄在这个位置的出场占比折算 |
| 熟练度 | 英雄池星级；选手没有录入英雄池时按中性处理 |
| 克制 | 对线对手的对位胜率差（贝叶斯收缩，避免小样本） |
| 协同 | 与己方已选英雄同队时的胜率差 |
| 阵容完整性 | AP/AD、前排、开团是否缺失 |
| 翻转价值 | 可打位置数，前几手权重高 |
| 抢夺 | 对方选手在这个英雄上的熟练度 + 版本强度；硬全局下额外加成 |
| 暴露风险（扣分） | 对方剩余可选英雄里对它克制最强的 |
| 稀缺成本（扣分） | 全局 BP 下用掉选手少有的 4–5 星英雄，后面还剩几局 |

默认权重（第二阶段用回测调过）：版本强度 4、熟练度 1、克制 0.5、协同 0.5、阵容完整性 0.25、翻转价值 0、抢夺 0.5、暴露风险 3、稀缺成本 0.25、前瞻 0.5、针对我方（Ban 的 λ）0.5。职业队的选择首先跟着版本走，所以版本强度占比最大；教练可以在设置页按自己的思路调整。

Ban 分 = 对方视角的 Pick 分 + λ × 对我方已选英雄的克制。软全局下对方已经用过的英雄不会推荐 Ban。

**前瞻（第二阶段）**：Pick 时取单步得分前 10 名，逐个模拟「选了它以后对方下一手的最佳选择」，对方最佳回应越强扣分越多（权重「前瞻」，设置页可关）。如果下一步还是我方（连续两手），先按我方贪心最佳走一步再看对方。

**连续两手组合（第二阶段）**：轮到一方连续两手时（后手方第 2–3 手、先手方第 4–5 手、第二轮先手方连续两手），对前 10 名逐个固定第一手，再评第二手，两手一起计算协同和阵容缺口，给出组合排名，点击一次录入两手。

位置是硬过滤：英雄必须能放进还空着的位置（已选的翻转英雄可以挪位置让出来）；默认只推荐选手英雄池里的英雄，英雄池为空时不限制。

## 数据

- `src/data/champions.json` + `public/champions/*.png`：`npm run data:champions [版本号]` 从 Data Dragon（zh_CN / en_US）和 Meraki Analytics（位置、伤害类型）生成。俗称和位置补丁在 `scripts/champion-overrides.mjs`。
- `src/data/stats/pro.json`：`python3 pipeline/oracles_elixir.py stats --since 2026-07-15` 从 [Oracle's Elixir](https://oracleselixir.com) 的年度职业赛 CSV 生成（BP 率、胜率、对位、协同），覆盖 LPL、LCK、LEC 等全部有记录的赛区。CSV 第一次运行时下载到 `pipeline/.cache/`，可用 `--until`、`--league` 限定范围。数据使用需注明来源 oracleselixir.com。
- `src/data/proTeams.json`：`python3 pipeline/oracles_elixir.py teams --since 2026-06-01` 生成一级联赛各战队每个位置选过的英雄，英雄池页「导入职业战队」用它生成初始英雄池（选过 1 次 = 3 星，2 次 = 4 星，3 次以上 = 5 星）。
- `pipeline/leaguepedia_stats.py`：Leaguepedia 版本的统计生成脚本（CC BY-SA 3.0），限流很严，作为备用。
- 也可以在设置页导入同格式的统计 JSON（例如以后用外服高分段路人局数据生成的）。

统计数据格式：

```jsonc
{
  "source": "...", "games": 1234,
  "champions": { "Vi": { "picks": 10, "bans": 30, "presence": 0.4, "winRate": 0.52, "roles": { "jungle": 10 } } },
  "counters": { "Vi": { "XinZhao": [0.03, 12] } },   // [Vi 对线 XinZhao 的胜率差, 场次]
  "synergy":  { "Vi": { "Orianna": [0.02, 8] } }     // [同队胜率差, 场次]
}
```

## 回测

```bash
python3 pipeline/oracles_elixir.py drafts --since 2026-06-01 --out pipeline/data/drafts.json   # 一级联赛完整 BP 顺序
python3 pipeline/oracles_elixir.py stats --since 2026-05-15 --until 2026-08-01 --out pipeline/data/stats-before-0801.json
python3 pipeline/oracles_elixir.py stats --since 2026-06-15 --until 2026-09-01 --out pipeline/data/stats-before-0901.json
# 验证集（8 月）：只用 8 月 1 日之前的统计，调权重
npx vite-node scripts/backtest.ts -- --from 2026-08-01 --to 2026-09-01 --stats pipeline/data/stats-before-0801.json --pools --tune --sample 3
# 测试集（9–10 月，含世界赛）：只用 9 月 1 日之前的统计，评估调好的权重
npx vite-node scripts/backtest.ts -- --from 2026-09-01 --stats pipeline/data/stats-before-0901.json --pools --weights '{...}'
```

对每一局的每个 Ban / Pick，按当时的局面（含系列赛前几局的全局锁定）让引擎给行动方的全部选项排序，统计实际选择落在第几名：Top 1 / 5 / 10 命中率和 MRR，并和「只按职业赛 BP 率排序」的基线对比。统计数据只用评估区间之前的比赛，避免信息泄露。`--pools` 用每支队伍在评估区间之前的职业赛选择推出英雄池（和「导入职业战队」同一套星级）。系列赛里同一英雄出现两次就按普通 BP 处理，否则按硬全局。`--lookahead` 打开前瞻（慢，配合 `--sample N` 每 N 局取 1 局），`--league LPL` 只看指定赛区，`--json FILE` 输出结果。

### 结果

8 月验证集（580 局，每 3 局取 1 局）上调权重，再在 9–10 月测试集（319 局，含世界赛，各 3190 次 Pick / Ban）上评估。统计只用 9 月 1 日之前的比赛，英雄池用每支队伍 9 月之前的选择推出：

| 测试集 | Pick Top1 | Pick Top5 | Pick Top10 | Pick MRR | Ban Top1 | Ban Top5 | Ban Top10 | Ban MRR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 只看职业赛 BP 率（基线） | 9.2% | 28.9% | 47.0% | 0.208 | 14.6% | 40.7% | 56.9% | 0.282 |
| 第一阶段默认权重 | 10.3% | 34.9% | 52.7% | 0.232 | 10.8% | 35.7% | 55.4% | 0.240 |
| 新默认权重 | 11.9% | 38.3% | 57.1% | 0.255 | 12.0% | 45.7% | 61.5% | 0.283 |
| 新默认权重 + 前瞻 | 12.2% | 38.3% | 57.1% | 0.257 | 12.0% | 45.7% | 61.5% | 0.283 |

- Pick：实际选择落在推荐前 5 的比例从 34.9% 提到 38.3%，比只看 BP 率高 9.4 个百分点。
- Ban：前 5 命中从 35.7% 提到 45.7%，比基线高 5 个百分点；但第 1 名命中仍低于基线（12.0% 对 14.6%），职业队的第一手 Ban 更集中在版本最热门的英雄上。
- 调参时协同和阵容完整性的最优值是 0，但保留 0.5 / 0.25 只差不到 0.5 个百分点，换来两手组合和阵容缺口提示仍然有意义。
- 前瞻对「复现职业队选择」几乎没有影响（Top1 +0.3 个百分点），它针对的是对方的最佳应对，这一点职业比赛数据很难直接验证。界面里默认打开，可以在设置页关掉。
- 回测衡量的是「推荐和职业队实际选择的一致程度」，不等于胜率；英雄池从比赛记录推出，比真实英雄池窄。

## 后续

LCU 自动同步（桌面端）、外服高分段路人局统计、按对手近期 BP 习惯预测对方下一手、多人同步。

DraftMind isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
