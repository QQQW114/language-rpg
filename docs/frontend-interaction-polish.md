# 前端交互优化（四项）

本文记录一次前端优化的需求、成因与实现，便于后续维护时理解"为什么这样写"。

---

## 1. 发送消息时自动滚动到底部

**需求**：发送后跟到最新内容。

**实现**（[`src/v2/GamePage.tsx`](../src/v2/GamePage.tsx)）：

- 文献卡内部、输入框之前放一个零高度锚点 `storyEndRef`；
- 新内容到达时对它 `scrollIntoView({ block: 'end' })`。

用锚点而不是 `scrollTop = scrollHeight` 有两个好处：滚动位置由浏览器按真实布局计算，
不需要维护"底部还差多少像素"这种容易失效的常量；而锚点位于输入框**之前**，
所以滚到底时底部输入框自然贴住它，不会盖住正文末尾。

**一条刻意的克制**：玩家主动往上翻读历史时**不打断**。滚动监听记录"距底部是否超过
120px"，超过就认为玩家在自己浏览，暂停自动跟随；一旦玩家自己滚回底部或发送新行动，
跟随立即恢复。

首次到达用 `auto`（瞬时），后续增量用 `smooth`，避免刚进页面就平滑滚动一大段。

---

## 2. 回合完成时正文"闪烁"（重刷一次）

**成因**：不是重渲染，是 **CSS 动画被重放**。

- [`src/index.css`](../src/index.css) 里 `.prose-story p` 带 `animation: fade-in`，用于"正文逐段出现"；
- 而流式进行中与最终落盘**原本是两套不同的元素结构**（落盘版 `article > div + div > Markdown`，流式版 `article > div + Markdown`）；
- 回合结束时 React 卸载一棵树、挂载另一棵，节点一重挂载，动画就重放 —— 视觉上就是正文整体重新淡入一次。

**修法（两层）**：

1. 抽出共用的 `StoryArticle` 组件，让两条路径产出**完全同构的 DOM**，节点因此被复用而不是重挂载；
2. 落盘后的容器额外带 `prose-story--settled`，CSS 据此禁用正文动画（流式期间逐段淡入仍然保留）。

**回归测试**：[`tests/storyArticle.test.ts`](../tests/storyArticle.test.ts) 用
`renderToStaticMarkup` 断言两条路径的**标签骨架完全一致**、且只有落盘版带 `prose-story--settled`。
这是"结构同构"最直接的检验方式，不需要真实 DOM。

> 附带解决的测试基建问题：`react-dom/server` 在 esbuild 的 ESM 产物里会因
> `require('stream')` 抛 `Dynamic require of "stream" is not supported`。
> 已在 [`scripts/run-unit-tests.mjs`](../scripts/run-unit-tests.mjs) 里把 Node 内置模块
> 设为 external，并用 `createRequire` 注入 CJS 互操作层。

---

## 3. 未发送输入的草稿保留

**需求**：打开设置页、返回主页、或刷新后重新进入对话，输入框里的内容应当还在。

**实现**：[`src/v2/draft.ts`](../src/v2/draft.ts) + GamePage 里的三个 effect。

- 存储位置是 `localStorage` 的 `lrpg.draft.<saveId>`，**每个存档一份**，互不干扰；
- 刻意**不写进 `lrpg.v2`**：草稿是易失的界面状态，不该参与存档体积与写入可靠性那套机制，
  也不该让一次草稿写入失败影响存档；
- 输入变化 250ms 防抖写入；`pagehide` 时再补一次，避免防抖窗口内的内容丢失；
- 恢复时机放在存档可用之后（首帧 `save` 可能还是 `undefined`），且**每个存档只恢复一次**，
  不会覆盖玩家后续的输入；
- 空字符串等于清除，不留空键；超长（>20000 字符）截断，避免写爆配额；localStorage 抛错时
  读取退化为空串、写入静默失败。

**回归测试**：[`tests/draft.test.ts`](../tests/draft.test.ts)（含"不触碰 `lrpg.v2`"与配额异常两条）。

---

## 4. 侧边栏信息更新的视觉反馈

**需求**：侧边栏的块（人物、线程、命运、规划等）有信息更新时，用一条与周边颜色相似的
黄色斜线从左到右划过去，在划过的区域显示新信息，同时几颗同色小星星闪烁转圈并慢慢淡化消失；
原本没有的块则先用黄色淡线画出大体轮廓，再走同一套斜线 + 星星。

**实现分两层**，刻意把"判断什么变了"与"怎么画"分开：

### 4.1 纯逻辑：`src/v2/sidePanelUpdates.ts`

`diffSidePanelChanges(before, after)` 比较前后两个权威状态，输出块的增删改：

- 固定块（命运、场景、进展、摘要、随机事件）**永远报 `updated`**——它们在界面上始终占位；
- 集合块（人物、关系、道具、线程、事实）按 id 比较，新增报 `new`、内容变化报 `updated`；
- **删除不产生特效**：块已经不在界面上，没有可播放的对象；
- 首次进入（`before` 为空）返回空数组：刚打开存档就把整栏扫一遍没有意义，
  而且会让玩家误以为"刚发生了变化"。

做成纯函数是为了可测试：`tests/sidePanelUpdates.test.ts` 覆盖了上述每一条。

### 4.2 表现层：`src/components/ui/UpdateGlow.tsx`

- `UpdateGlow` 包住任意块，`change` 有值时播放一次，**播完即卸载覆盖层**（不常驻 DOM）；
- 斜线：一个 `skewX(-16deg)` 的窄带从左向右划过，中间亮、两端透明。
  颜色取自项目既有的 `gold` 系列（`#c9a566` / `#e3c27e`），与卡片边框、分隔线同源；
- 小星星：五颗 `✦ ✧ ⋆` 字符，原地转圈 + 闪烁，随后淡出。
  **位置用固定序列而不是随机**，这样同一块每次播放的位置一致，看起来是设计好的而非抖动；
- 新块额外先用虚线描出轮廓；
- 覆盖层是 `pointer-events-none`，绝不吃掉卡片本身的点击（编辑、展开等）；
- 动画定义在 [`tailwind.config.js`](../tailwind.config.js) 的 `keyframes`/`animation` 里
  （`update-sweep` / `update-outline` / `sparkle`），与项目其余动效同一处维护；
- 尊重 `prefers-reduced-motion`：减弱动效时**不渲染覆盖层**，避免留下静止的金色残影
  （全局 CSS 已把动画压到 0.001ms，但覆盖层的渐变背景仍会可见）。

### 4.3 顺带扩展的能力

原来的 `UpdateGlow` 播放逻辑只区分"变了/没变"，但连续两轮都变化的块会被 React 判定为
props 未变而不重播。现在由 `change` 的值本身驱动，同时加了 `blockId` 依赖（换存档或换标签
说明换了一块），并在 GamePage 里用定时器清空变更表，保证"每轮最多播一次"。

---

## 验证方式

```bash
cmd /c npm test            # 含 5 条渲染结构断言、7 条侧边栏 diff 断言、7 条草稿断言
cmd /c npm run build       # 已确认新动画类都进了产物 CSS
node scripts/mock-provider.mjs 8791   # 常驻 mock 供应商，供浏览器冒烟
cmd /c npm run dev         # 把设置页的 API Base 指向 http://127.0.0.1:8791/v1 即可
```

`scripts/mock-provider.mjs` 会按轮次稳定地改变侧边栏内容（第 1 轮新增人物与线程、
第 2 轮改人物状态并推进线程、第 3 轮新增道具与事实），便于一次点完就观察四种特效。
