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
- **英雄池编辑**：每支战队 5 个位置，每名选手每个英雄 1–5 星；附两支虚构的示例战队用来体验。
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

Ban 分 = 对方视角的 Pick 分 + λ × 对我方已选英雄的克制。软全局下对方已经用过的英雄不会推荐 Ban。

位置是硬过滤：英雄必须能放进还空着的位置（已选的翻转英雄可以挪位置让出来）；默认只推荐选手英雄池里的英雄，英雄池为空时不限制。

## 数据

- `src/data/champions.json` + `public/champions/*.png`：`npm run data:champions [版本号]` 从 Data Dragon（zh_CN / en_US）和 Meraki Analytics（位置、伤害类型）生成。俗称和位置补丁在 `scripts/champion-overrides.mjs`。
- `src/data/stats/pro.json`：`python3 pipeline/leaguepedia_stats.py --since 2026-07-15` 从 Leaguepedia 拉职业赛对局生成（BP 率、胜率、对位、协同）。Leaguepedia 限流很严（实测每 500 局要等十几到二十分钟），脚本会退避重试并把分页缓存在 `pipeline/.cache/`。可以用 `--league LPL --league LDL` 只拉指定赛事，用 `--include-cached` 把之前各次运行缓存的分页合并进来，用 `--max-wait` 限制等待时长，大范围数据可以分几次拉完。数据遵循 CC BY-SA 3.0。
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

## 后续（第二阶段）

浅层博弈搜索（连续两手组合评分、模拟对方下一步）、历史 BP 回测调权重、LCU 自动同步（桌面端）、外服高分段路人局统计。

DraftMind isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
