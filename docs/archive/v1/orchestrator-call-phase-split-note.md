# 司辰 calls 拆分为写前 / 写后调用的留档

> 状态：暂不实施，仅留档。  
> 背景：当前司辰 `calls + callOrder` 能表达“本回合要不要调用某模型”，但不能精确表达“这个模型应在故事写作前运行，还是故事写作后运行”。这会导致 director / logicCheck / memory / summary 等模型的时机语义混乱。

## 1. 当前结构的问题

当前司辰大致输出：

```json
{
  "calls": {
    "outlineMapper": { "run": true, "reason": "..." },
    "stageJudge": { "run": true, "reason": "..." },
    "settingGuard": { "run": false, "reason": "..." },
    "eventBeat": { "run": true, "reason": "..." },
    "director": { "run": true, "reason": "..." },
    "logicCheck": { "run": true, "reason": "..." },
    "memory": { "run": false, "reason": "..." },
    "summary": { "run": false, "reason": "..." }
  },
  "callOrder": ["outlineMapper", "stageJudge", "eventBeat", "director", "logicCheck"]
}
```

这里的问题是：

- `outlineMapper / stageJudge / settingGuard / eventBeat / director` 多数是**故事写作前**需要跑的模型，用来给故事写手提供大纲、阶段、设定、事件节奏和 writingBrief。
- `logicCheck / memory / summary` 多数是**故事写作后**需要跑的模型，用来审校刚生成的正文、整理新记忆和压缩上下文。
- `director` 具有双重含义：
  - 写前 director：生成当前回合的 writingBrief。
  - 写后 director：根据刚生成的故事更新下一轮计划。

单一 `calls.director.run` 无法区分这两种用途，容易造成同一回合 pre-story 和 post-story 重复调用 director。

当前代码已经做了临时止血：如果写前 director 已经实际运行，写后阶段不再强制重复跑；但这只是代码兜底，不是结构性解决。

## 2. 建议的长期结构

更清晰的结构是让司辰输出两个调用组：

```json
{
  "preStoryCalls": {
    "outlineMapper": { "run": true, "reason": "...", "hint": "..." },
    "stageJudge": { "run": true, "reason": "...", "hint": "..." },
    "settingGuard": { "run": false, "reason": "..." },
    "eventBeat": { "run": true, "reason": "..." },
    "director": { "run": true, "reason": "...", "hint": "生成本回合 writingBrief" }
  },
  "postStoryCalls": {
    "logicCheck": { "run": true, "reason": "生成后检查本回合设定连续性" },
    "memory": { "run": true, "reason": "本回合产生长期事实" },
    "summary": { "run": false, "reason": "历史未超阈值" },
    "director": { "run": false, "reason": "写前 brief 已足够，不需要写后刷新" }
  },
  "preStoryCallOrder": ["outlineMapper", "stageJudge", "eventBeat", "director"],
  "postStoryCallOrder": ["logicCheck", "memory"]
}
```

执行链路可变为：

```txt
司辰判断
  ↓
写前模型组：outlineMapper / stageJudge / settingGuard / eventBeat / director
  ↓
故事写手 story
  ↓
写后模型组：logicCheck / memory / summary / 写后 director
  ↓
保存、记忆、审校、下一轮准备
```

## 3. 写前 / 写后职责建议

### 写前模型组

| 模型 | 主要时机 | 作用 |
| --- | --- | --- |
| outlineMapper | 写前 | 将当前剧情映射到大纲 / 主弧，给后续模型确定方向。 |
| stageJudge | 写前 | 判断玩家意图、节奏、阶段完成度。 |
| settingGuard | 写前 | 锁定世界书、身份、能力和硬设定边界。 |
| eventBeat | 写前 | 判定活跃事件弧的推进、结算、完成或失败。 |
| director | 写前为主 | 整合写前信息，产出本回合 writingBrief。 |

### 写后模型组

| 模型 | 主要时机 | 作用 |
| --- | --- | --- |
| logicCheck | 写后 | 审校刚生成正文的设定、时间线、人物、能力一致性。 |
| memory | 写后 | 将本回合新产生的长期事实、承诺、关系、能力等整理进长期记忆。 |
| summary | 写后 / 后台 | 在上下文过长或阶段收束时压缩历史。 |
| director | 可选写后 | 根据刚生成的故事更新下一轮计划；应与写前 director 区分。 |

## 4. 涉及改动范围

如果实施，需要同步修改：

- `src/types/game.ts`
  - 增加 `preStoryCalls / postStoryCalls`
  - 增加 `preStoryCallOrder / postStoryCallOrder`
  - 决定是否保留 legacy `calls / callOrder`
- `src/prompts/authorOrchestratorSystem.ts`
  - 司辰输出协议要改。
  - 明确哪些模型只能写前、哪些通常写后、哪些可双时机。
- `src/services/authorOrchestratorAgent.ts`
  - sanitize / fallback 要支持新 schema。
  - 最好保留旧 schema 兼容一段时间。
- `src/pages/GamePage.tsx`
  - 写前循环只读 `preStoryCallOrder`。
  - story 结束后只读 `postStoryCallOrder`。
  - director 写前 / 写后需要避免共用一个含义模糊的 `force`。
- UI / 记录面板
  - 可显示“写前调用”和“写后调用”两组，方便调试链路。

## 5. 迁移建议

建议不要立刻硬切，分两步：

1. **兼容期**
   - 类型中新增新字段，但仍允许旧 `calls / callOrder`。
   - 如果司辰返回新字段，按新字段执行。
   - 如果只返回旧字段，则使用当前兼容逻辑：
     - 写前只取 `outlineMapper / stageJudge / settingGuard / eventBeat / director`
     - 写后只取 `logicCheck / memory / summary`
2. **稳定后**
   - prompt 完全切到新协议。
   - 删除或弱化旧字段。

## 6. 当前不立即实施的原因

- 当前提示词仍在调整阶段，直接改 schema 会扩大 prompt 改造面。
- 现阶段代码已用 `preStoryDirectorRan` 先防住 director 重复调用。
- 司辰职责和下游模型职责仍在继续打磨，等模型边界更稳定后再做结构性拆分更合适。

## 7. 后续判断标准

出现以下情况时，建议正式实施拆分：

- director 再次出现同回合双跑或语义混乱。
- memory / summary / logicCheck 被司辰安排进写前调用链，导致无效或错误调用。
- UI 需要清晰展示“写前模型组 / 写后模型组”。
- 回合司辰开始承担更复杂的执行计划生成职责，单一 `calls` 已不够表达链路。

