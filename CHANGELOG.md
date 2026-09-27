# 更新记录

本项目从 v0.3.0 起使用语义化版本号。早期测试标签保留原名，不再作为后续标签命名规范。

## [0.4.0] - 2026-09-27

### 移除

- **整体移除 Responses（`/responses`）链路**：`apiFormat` 在界面上没有任何入口，该格式对用户是死代码，且其下 `thinkingMode` / `reasoningEffort` / `plannerJsonMode` / 工具开关全部静默失效。现在只支持 Chat Completions。usage 的 `input_tokens` / `output_tokens` / `*_tokens_details.cached_tokens` 别名归一化保留（属于通用供应商差异，不是 Responses 专属）。
- 清理 V1 遗留代码：删除 36 个被 git 跟踪的零引用文件（另有 1 个从未纳入 git 的 `src/pages/GamePage.tsx.bak`，共 37 个），包括旧页面（`LibraryPage`、`GamePage.tsx.bak`）、18 个旧组件、IndexedDB 司书库（`storage/ledgerRepository.ts`）、工作区/司书库模板链路、旧执笔链提示词与只服务旧类型的工具模块。
- 移除内容库中的随机事件条目与司书库模板：`RandomEvent` / `WorkspaceTemplate` 类型、预设事件库、以及 `contentLibrary` / `useContentStore` 中的对应分支。随机事件改由 `engine.ts` 指令与 `patch.ts` 调度独立驱动（行为不变）。
- 删除误导性的临时重构产物 `.tmp_cn_refs.txt` 与 `.tmp_item_refs.txt`。

### 新增

- **思考强度补上 `low` 档，并支持逐阶段设置**：DeepSeek 官方映射为 `minimal/low → low`、`medium/high/xhigh → high`、`max/ultra → max`，不提供数字型思考预算；原先只暴露 high/max，等于把思考预算锁在最贵两档。现在设置页可对写前规划 / 故事正文 / 写后结算分别选择「跟随全局 / Low / High / Max」，默认只给结算降一档（它的产出结构由模板固定，属机械性任务）。关闭思考时改为显式发送 `thinking: {type:'disabled'}`——官方文档说明思考模式**默认开启**，"什么都不发"会退回默认开启而不是关闭。
- **状态提交对账统计（`patchStats`）**：每回合记录"模型提交了多少条状态变更、程序接受了多少条、丢弃了多少条、改写了多少处枚举"，其中"结构不全"（模型漏填必填字段）与"字段齐全但被拒"（引用了不存在的 id）分开计数——两者的修法完全不同。数字写进 `TurnRecordV2.patchStats` 并随存档持久化，游戏页「模型活动」面板的写后结算阶段会显示一行对账结果。此前这些丢弃只以警告文本存在，既没有数字也无法累计观察，导致"模型以为记下了、程序其实丢了"这个结构性盲区一直无法度量。这一步是先量后改：只有确认丢弃比例可观，才值得把被拒情况回显给结算模型（见 [`docs/planner-multiround-evaluation.md`](docs/planner-multiround-evaluation.md)）。
- **侧边栏信息更新的视觉反馈**：侧边栏的块（人物、线程、命运、场景、进展、事实、背包）有更新时，一条与卡片边框同源的金色斜线自左向右扫过，掠过之处伴随几颗同色小星星原地转圈闪烁后淡出；原本不存在的块先用虚线描出轮廓再走同一套效果。判断"什么变了"是纯函数（`src/v2/sidePanelUpdates.ts`，含单测），表现层在 `src/components/ui/UpdateGlow.tsx`，动画与项目其余动效同在 `tailwind.config.js` 维护。覆盖层为 `pointer-events-none` 不吃点击，并尊重 `prefers-reduced-motion`。
- **未发送输入的草稿保留**：输入框内容按存档存入 `lrpg.draft.<saveId>`，打开设置页、返回主页或刷新后重新进入对话时仍在。刻意不写进 `lrpg.v2`——草稿是易失的界面状态，不该参与存档体积与写入可靠性机制。输入变化 250ms 防抖写入，`pagehide` 时补一次；每个存档只恢复一次，不覆盖玩家后续输入。
- **发送消息时自动滚动到底部**：文献卡内、输入框之前放零高度锚点，用 `scrollIntoView` 跟随（位置由浏览器按真实布局计算，不需要维护像素常量；锚点在输入框之前，所以滚到底时输入框自然贴住它）。玩家主动往上翻读时不打断，滚回底部或发送新行动后恢复跟随。
- **常驻 mock 供应商 `scripts/mock-provider.mjs`**：供浏览器手动冒烟用。按轮次稳定改变侧边栏内容（第 1 轮新增人物与线程、第 2 轮改人物状态并推进线程、第 3 轮新增道具与事实），一次点完即可观察四种更新特效。

### 修复

- **回合完成时正文闪烁重刷**：流式进行中与最终落盘原本是两套不同的元素结构，回合结束时 React 卸载一棵树、挂载另一棵；而 `.prose-story p` 带 `fade-in` 动画，节点一重挂载动画就重放，表现为正文整体重新淡入一次。现在两条路径共用 `StoryArticle` 组件、产出完全同构的 DOM，落盘容器再带 `prose-story--settled` 禁用正文动画。回归测试用 `renderToStaticMarkup` 断言标签骨架一致（`tests/storyArticle.test.ts`）。
- **提示词结构破坏前缀缓存（命中率上不去的主因）**：供应商的前缀缓存只认"从头开始逐字节相同"的部分，而写后结算的请求把约 1.9KB 的固定输出模板放在了每回合都变的正文**之后**，模板因此永远无法命中；模板里还内嵌了每回合随机生成的 `commitId`，即使位置对了也逐字节不同；`baseRevision` / `turn` 两个递增的值又排在模板开头，把后面整段字段说明的复用性再次截断。现在三个阶段统一为「固定指令与输出模板 → 可变材料」，`commitId` 移出模板（改由 `【TURN_ID】` 行给出，提交时仍由程序覆盖），注入值挪到模板末尾，权威状态 JSON 也改为稳定字段在前、`scene/summary/progress/turn/revision/recent` 在后。实测可复用前缀：结算阶段 34.2% → 67.0%，三个阶段合计约 25% → 56.9%（最小存档下；真实存档比例更高）。
- **`cache_read_input_tokens` / `cache_creation_input_tokens` / DeepSeek 原生缓存字段读不到**：缓存字段此前只在 `cache` 嵌套对象里查找，而 DeepSeek 把 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 放在 `usage` 顶层，Anthropic 把 `cache_read_input_tokens` 放在顶层——两者都读不到，直连时缓存命中永远显示 0。
- **`input_tokens` 与 `prompt_tokens` 口径混用导致输入量少算**：OpenAI 风格的 `prompt_tokens` 已是完整输入量，而 Anthropic / DeepSeek 风格的 `input_tokens` 只表示未命中部分，完整量需加上缓存读写（与 DSH 的 `totalTokens = input + output + cacheRead + cacheWrite` 一致）。现在按字段组合判别口径，而不是按字段名猜。
- **未命中量被误派生成 0，算出 100% 的假命中率**：只带 `prompt_cache_hit_tokens` 的中间帧曾被当成完整输入量。现在总量只从可信来源取，数据不足时留空、界面显示"—"，同时新增 `cacheHitRate` / `formatCacheHitRate` 与缓存写 token 字段。
- **后到的残缺 usage 帧把已统计的缓存量抹成 0**：流式响应中多个 usage 帧先后到达，后者可能只重复部分字段。缓存计数改为取较大值（一次请求内单调不减），顶层 `promptTokens` 仍按每个请求各自取值。
- **`superseded` 缺少有效替代者时虚增结局完成度**：`replacementBeatId` 只校验非空、不校验存在性，指向不存在的故事节时状态仍被置为 `superseded`，而结局判定把所有 `superseded` 视为已完成 → 可能提前触发结局。现在必须指向真实存在的故事节，否则降级为 `reframed` 并发警告；已落库的历史坏数据会在下次提交时回收。不会卡住流程：`endingReached` 只记录状态、不终止游戏。
- **多处静默丢弃/静默改写改为可观察**：人物 `create` 缺 `name`、线程 `create` 缺 `title`（此前会退化为按 id 覆盖已有线程且不校验 reason）、枚举字段收到表外取值、工具调用帧缺 `function.name`——现在都会产生进入活动流的警告；人物 aliases 与线程 `involvedCharacterIds` 的 create 分支补齐与合并/update 分支一致的去重。
- **世界书 priority 区间统一**：工坊保存夹 `[0,100]`、内容库校验允许 `[-10000,10000]`，导致"保存 → 导出 → 再导入"静默改写；两处现已同区间。
- **存档会撞上 localStorage 配额，且写入失败完全不可见**：每回合把三阶段完整提示词留档写进 `lrpg.v2`，实测 30 回合达 6.21 MB（其中留档占 97.8% 的字节），约第 26 回合即超限；超限后内存状态继续前进而磁盘停在旧值，刷新丢档。现在持久化时剔除 `calls[].input`（30 回合 6212 KB → 420 KB，距配额约 337 回合），并用自定义 `StateStorage` 把写入失败提升为可渲染的 `persistError`（异常照旧上抛），游戏页渲染持久化告警横幅。
- **`<think>` 标签变体会吞掉整回合正文**：只认逐字符相等的 `</think>`，模型写出 `</think >`、`</THINK>` 时其后正文全部被判为思考内容，回合以"空内容"失败。现在归一化标签再拆分，并加"无规范标签时按正文返回"的安全网。
- **工具循环丢掉已生成的最终 JSON**：模型在同一轮里既给出完整 JSON 又发起工具调用、末轮只回空内容时，原实现只取末轮文本导致整回合失败。现在回退到最后一个非空文本。
- **工具轮次用尽直接抛错**：末轮改用 `toolChoice:'none'` 阻止继续调用，仍请求工具时用已有内容收尾而非打掉整回合（并顺带修掉由此暴露的潜在无界调用）；仅当从未产出可用文本时才抛错。
- **世界书的 `alwaysActive` / `keywords` / `priority` 完全失效**：关键词门控从未生效，未命中的条目（含尚未发生的伏笔）每回合都被注入，`priority` 不起作用且第 21 条起静默丢弃。现在按常驻 + 关键词命中筛选、按优先级排序，截断时发活动流警告。
- **枚举未写进提示词导致静默强转**：`postShape` 只给 `"status":"active"` / `"kind":"item"`，模型输出中文枚举时被白名单静默改写（人物死亡记为活跃）。现在写全枚举并补充"不得翻译枚举""superseded 需 replacementBeatId""endingReached 的联合门槛"三条规则；同时补全 `scene` / `actions` 的字段结构（原先只给 `null` / `[]`）。
- **随机事件说明在未到期回合被丢弃**：`lastNote` 是纯审计文本（前端显示为「随机事件结果」），此前只在事件到期分支记录。现在所有分支都记录，调度字段仍然只在到期时改动；前端相应只在事件真的触发过之后才显示为结果。
- **`availableActions` 在状态写入层不校验内容**：规整逻辑已抽到 `src/lib/actions.ts` 的 `normalizeChoices`，由 `engine` 与 `patch` 共用——任何绕过 engine 直接提交 Patch 的调用方都不再能写进空 label 的按钮。
- **检索工具可用性**：证据改为按实际命中的词做窗口切片（此前只截前 900 字，长回合返回的证据可能不含查询词），中文单字人名不再被分词丢弃，工具描述补上适用/不适用场景与 `scope` 取值含义。
- **未闭合的 `<think>` 会吞掉整段正文**：拆分器此前只在存在半个标签前缀时才 flush，导致"未闭合的 think 块"永远等不到收尾判定——内容留在思考里、正文为空、回合以"模型返回了空内容"失败。现在 `finish()` 总是收尾；闭标签从未出现时把内容判为正文并补发给流式消费者。同时把"JSON 写在 `<think>` 里"的场景也纳入兜底（此前被 `!tagThinking` 条件排除）。
- **世界书优先级可在全区间使用**：工坊输入框放开到 `-10000 ~ 10000`（此前夹 `0 ~ 100`，与内容库的校验区间不一致，导致保存→导出→再导入静默改写），并补上"数字大的先注入"的说明。
- **显式 0 不再被当成"没填"**：随机事件间隔的 `Number(x) || 3` 会把刻意的 0 变成默认值 3；现在只有 `undefined`/`NaN` 回退默认值，0 照实夹到最小值 1。
- **`lrpg.v2` 补上格式版本与迁移层**：读旧档时补齐缺失字段（缺 `facts[].keywords`、`storyThreads`、`destiny.beats`、`inventory` 的存档此前会在 `snapshot()` 抛 `TypeError`，而且是在已经花掉两三次模型调用之后）；结构坏到无法修复的条目被丢弃而不是拖垮整个存档集；由更新版本写入的存档原样保留并进入只读提示，不再被本程序重新解读后写回（那会静默抹掉它不认识的新字段）。
- 设置页"写前规划和写后结算分别计算工具次数"的文案与实现矛盾（结算阶段从不挂载工具），已更正。
- 删除零引用的 `src/lib/toast.ts`（其渲染组件早已随 V1 清理删除）。
- `tsconfig.json` 的 `include` 从 4 个路径改为 `["src"]`：此前大量文件不在类型检查范围内，`src/types/game.ts` 被删除后仍被十余个文件 import 而无人发现。
- `extractJSONText` 贪婪匹配导致解析失败：模型在 JSON 之后继续输出文字、或一次返回多个对象时整体不是合法 JSON，直接返回 `null`，使整回合失败。改为逐个 `{` 做括号平衡扫描（跳过字符串字面量与转义引号），返回首个可解析对象；并修复了两个由复核发现的衍生问题——截断输入会退而返回内层对象（现在返回 `null`）、逐候选扫描在病态输入上退化成 O(n²)（200 KB 未闭合括号需 124 秒，现在 200 万个耗时 2 ms）；合法 JSON 在非法 fence 之前时不再被整体丢弃。
- `mergeLlmUsage` 用 `undefined` 覆盖已知缓存统计：`normalizeLlmUsage` 产出的 cache 必带三个键（值可能为 `undefined`），对象展开会把上一帧已拿到的 `hitTokens` 覆盖掉。改为逐字段 `??` 合并，且只写入真正有值的字段。
- Patch 缺 `latestProgress` 时清空进度：`summary` 与 `latestProgress` 现在统一走 `textOrPrevious`，"空串/空白串视为未提供、保留旧值"。此前的 `raw || previous` 写法无法拦住 `'   '`（truthy），清洗后仍会变成空串。

### 文档

- 重写 `AGENTS.md`：原内容描述的是 V1 结构（`useGameStore.ts`、`services/storyAgent.ts`、`src/prompts/*`、`runStory/runChoices/dispatch` 等均不存在），已按 V2 实况重写运行命令、代码结构、路由、存储键与协议改动清单。
- 重写 `PROJECT_HANDOFF.md`：改为记录本次接手发现的问题、处理方式、验证结果与仍需人工完成的事项。
- 同步 `docs/PROJECT_STATUS.md`（存储键、测试体系、已移除的遗留部分）与 `docs/README.md`（标注归档文档中的失效路径）。
- `README.md` 补充测试与开发文档索引。
- `docs/cache-prefix-investigation.md`：前缀缓存的四个失效点查证（含 DSH 源码与 DeepSeek 官方文档依据、真实请求体的字节级测量）。
- `docs/cost-analysis.md`：一次真实三回合游玩的成本实测与优化优先级（输出占 82% 费用、时段差价 2 倍、缓存优化上限约 16%）。
- `docs/multiround-generation-evaluation.md`、`docs/planner-multiround-evaluation.md`：两次"要不要多轮"的评估（含 29 个真实回合的量化证据与被证伪的假设）。
- `docs/frontend-interaction-polish.md`：四项前端交互优化的成因与实现。

### 新增

- 自动化测试系统：`npm test` 使用 esbuild 打包 + Node 内置 `node:test` 运行，完全离线（模型调用 mock `fetch`），当前 304 条用例；`npm run test:patch` 保留为 Patch/命运状态回归脚本。
- 端到端 mock 链路测试：`npm run test:e2e` 用本地 OpenAI 兼容 mock 服务器驱动真实 engine/store，43 条断言覆盖完整回合、工具调用轮、失败路径（截断、非法 JSON、HTTP 429）、store 落盘与缓存前缀结构。
- 存档体积与写入可靠性实测：`npm run test:storage` 测量每回合字节增长、距 localStorage 配额的剩余回合数，并注入 `QuotaExceededError` 验证失败可见性。
- `scripts/mock-provider.mjs`：常驻的 OpenAI 兼容 mock 供应商，供浏览器手动冒烟使用（按轮次稳定改变侧边栏内容，一次点完即可观察四种更新特效）。
- `tests/llmClient.test.ts`：补齐此前零覆盖的模型客户端（工具循环两个 HARD 缺陷的回归测试）。
- `docs/known-issues.md`：登记审查与测试中发现、尚未修复的问题（含严重度、影响路径与处理建议）。

## [0.3.0] - 2026-07-16

### 新增

- 新增“故事工坊”，支持自定义故事大纲、幕、故事节、结局方向与世界书条目。
- 支持复制内置“错位青春”作为自定义故事参考。
- 自定义故事保存在浏览器中，支持编辑、复制、删除与 JSON 导入/导出。
- 新增规划模型上下文预算、故事上下文查询工具、工具调用上限和 DeepSeek 兼容选项。
- 新增实时生成活动树，可查看模型推理、工具调用、阶段状态和 Token/缓存用量。
- 新增消息队列、取消、终止、重试与修改最近输入后重新生成。
- 新增慢速、标准、快速和时间跨越四种叙事节奏。

### 重构

- 重写为命运驱动的 V2 双模型故事链路：规划写前、故事生成、规划写后、程序提交。
- 使用结构化幕与故事节维护长期故事目标，并允许玩家偏航后迁移关键故事功能。
- 将人物、关系、物品、任务、事实、摘要与故事进度改为程序侧权威状态。
- 清理旧多 Agent、司书库、回合上限、选项刷新和不再支持的角色模型逻辑。
- 重建主要前端界面和聊天交互，同时保留成熟版本的视觉语言。

### 修复

- 修复无玩家输入时可能自动推进下一回合的问题。
- 修复后台切换、终止或旧请求返回时可能产生重复提交的问题。
- 修复规划活动状态显示在错误回合、工具开关错位等交互问题。
- 加强结构化 Patch 校验、事实去重和故事节状态更新的容错。

### 兼容性

- V2 不兼容旧版存档。
- 自定义故事和存档均为浏览器本地数据，升级或清理站点数据前建议导出备份。

## [0.2.0] - 2026-05-07

- 扩展执笔模式的分阶段叙事与提示词体系。
- 增加“错位青春”预设和一键启动入口。
- 项目许可证切换为 GPL-3.0。

## [0.1.0] - 2026-05-01

- 发布首个公开测试版本。
- 提供纯前端互动故事原型与基础模型设置。
