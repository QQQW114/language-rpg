# 预设故事编写与导入

> 面向：自己写预设故事，或让外部模型批量生成预设故事。格式以 `src/types/content.ts` 为准；示例见 [`content-examples/`](content-examples/)。

## 1. 数据在游戏里怎么被使用

- 大纲只描述「命运骨架」：**幕 = 命运阶段，故事节（beat）= 必须经历的叙事功能/结果**。
- 具体地点、事件形式、承担角色由规划模型按玩家路径动态重构；因此不要把故事节写成固定路线，但又必须可核验。
- 随机事件由引擎自动调度，大纲里不要写事件/事件库；也不要写运行时状态字段（`currentActId`、`inventory`、`actHistory` 等）。
- 一个预设通常支撑 20~40 回合。

## 2. `StoryOutline` 字段

```json
{
  "id": "outline_xxx",
  "title": "故事标题",
  "synopsis": "80~250 字：世界观 + 主角处境 + 核心矛盾 + 长期走向",
  "tone": "可选 ≤60 字：文风提示",
  "coverEmoji": "可选",
  "worldBookIds": ["同一导入包内世界书 id"],
  "acts": [ /* 3~6 幕，推荐 5 幕；每幕 2~5 节，推荐 3 节 */ ]
}
```

- `id`：ASCII、小写、稳定、全包唯一；缺 id 会自动生成，但建议显式给出。
- `title/synopsis/acts[].title/acts[].purpose/acts[].beats[].title/beats[].purpose` 必填且不能为空。

## 3. `StoryAct` / `StoryBeat`

```json
{
  "id": "act-1-xxx",
  "title": "第一幕 · xxx",
  "purpose": "这一幕要完成的命运/成长推进（必填）",
  "entryBrief": "可选 ≤200 字：进入本幕的舞台状态、气氛、核心议题",
  "stageContract": "可选 ≤200 字：允许展开的范围与禁止提前写穿的底线",
  "exitCriteriaNote": "可选 ≤120 字：人类可读的幕完成标志",
  "beats": [
    { "id": "beat-xxx", "title": "故事节短标题", "purpose": "必须完成的叙事功能/结果（可核验）" }
  ]
}
```

- 节与节之间要有递进（起承转合/压力升级）；避免"主角思考人生"这类无法核验的功能。
- 可选字段超长会被**静默裁剪**，不报错；建议总节数 12~20。

## 4. 世界书 `WorldBook`（可选）

```json
{
  "id": "wb_xxx",
  "name": "世界书名称",
  "description": "可选",
  "entries": [
    {
      "id": "wbe-xxx",
      "name": "条目名",
      "keywords": ["关键词"],
      "content": "会长期影响叙事的硬设定（建议 50~250 字）",
      "priority": 0,
      "alwaysActive": false
    }
  ]
}
```

- `alwaysActive: true` 的条目每回合注入，建议 2~4 条（世界底层规则/主角不可变身份）；
- 其余条目靠关键词命中当前输入或最近历史时注入，建议 4~8 条，关键词要有区分度；
- `priority` 越大越优先（-10000~10000）；在 `StoryOutline.worldBookIds` 中填写即可默认挂载。

## 5. 出身 `Background`（可选，全局资源）

```json
{
  "id": "bg_xxx",
  "name": "出身名",
  "description": "必填",
  "traits": ["特质"],
  "startItems": ["初始物品"],
  "startScene": "开局文案（必填）",
  "coverEmoji": "可选"
}
```

注意：出身是**全局选择**，不跟故事绑定。为某个故事单独设计的出身（如故事专属主角）不要直接导入，否则玩家可以在其它故事里选到它；通用出身才适合放进 `PRESET_BACKGROUNDS`。

## 6. 导入包格式

```json
{
  "outlines": [ /* StoryOutline[] */ ],
  "worldBooks": [ /* 可选 */ ],
  "backgrounds": [ /* 可选 */ ]
}
```

也接受带外壳的导出格式：

```json
{
  "kind": "language-rpg.content-library",
  "version": 1,
  "exportedAt": 1730000000000,
  "content": { "outlines": [], "worldBooks": [], "backgrounds": [] }
}
```

导入方式：游戏 →「故事与世界书工坊」→ 右上角「导入」→ 选择 JSON；同 id 会更新自定义内容，内置预设不会被覆盖。

## 7. 内置预设（0.5.1 起）

| 标题 | 世界书 | 结构 | 定位 |
|---|---|---|---|
| 错位青春 | `wb_misplaced_youth` | 5 幕 15 节 | 校园日常 / 性别错位 / 轻松治愈 |
| 余温代行人 | `wb_borrowed_ember` | 5 幕 15 节 | 近未来市井科幻 / 悬疑潜行 |
| 赝品修复师 | `wb_forged_provenance` | 5 幕 15 节 | 都市古玩悬疑 / 手艺日常 |

后两个由外部模型生成、经 `validateImportBundle` 校验后导入；工程上有 `tests/presets.test.ts` 固定校验（必填、id 唯一、世界书引用可解析、结构数量）。

## 8. 让外部模型批量生成时的最小提示

可以直接把 [`content-examples/`](content-examples/) 里的预设示例 + 本文档发给模型，并附加要求：

1. 输出一个裸 `ImportBundle` JSON（不要解释文字）；
2. 4 个故事，题材互不重复（都市异能/悬疑/古风/近未来/校园群像任选）；
3. 每个故事 5 幕 × 3 节左右，`id` ASCII 全局唯一；
4. 故事节写"可核验的叙事结果"，不写固定路线；
5. 可选地为其中 2 个故事配 7 条左右的世界书；
6. 不写随机事件、数值、状态机字段。

生成后先用地基校验（`validateStoryOutline` / `validateWorldBook`）检查，再导入。工程侧新增预设后请同步 `src/presets/*.ts`、`tests/presets.test.ts` 与本文档内置预设表。
