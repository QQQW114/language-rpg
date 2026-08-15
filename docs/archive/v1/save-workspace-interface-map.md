# 保存 / 司书库接口说明

> 日期：2026-05-11  
> 目的：记录当前保存层与司书库读写接口的意义，为后续工具权限系统、小模型自动保存 planning artifact、司辰 run_xxx 调度工具做准备。  
> 关联文档：`docs/workspace-tool-responsibility-plan.md`

## 1. 总体定位

当前项目后续应按三层理解保存系统：

```txt
ledger：底账 / 回滚 / 导出 / 审计
workspaceDocs（司书库）：模型可读的故事文件系统 / 工作区
Zustand state：前端运行态与 UI 快速缓存
```

其中：

- `rounds`、`agentCalls`、`snapshots` 属于 ledger 底账。
- `workspaceDocs` 属于司书库，是后续工具系统主要读取和沉淀入口。
- `state.history` 与 `state.agentThoughts` 不再由 localStorage 全量保存；它们由 ledger 组合回 state。

## 2. IndexedDB store 意义

### saves

保存存档元信息和不含完整 history / agentThoughts 的运行 state。

主要接口：

```ts
putSaveMeta(save)
loadAllSaves()
deleteSaveData(saveId)
```

意义：

- 旅程列表、配置、当前运行态。
- 不承担大体积聊天记录保存。

### rounds

按回合保存聊天消息。

主要接口：

```ts
syncRoundsFromSave(save)
getRounds(saveId)
```

意义：

- 聊天记录底账。
- 回合卷宗。
- 导出旅程包。
- 回滚时恢复 history。

### agentCalls

保存模型调用记录。

主要接口：

```ts
addAgentCall(saveId, thought)
getAgentCalls(saveId)
```

意义：

- 审计、调试、前端“记录/思考”展示。
- 保存输入、输出、thinking、usage、cache hit。
- 不建议作为模型高频资料入口；后续应把精炼结果沉淀到司书库 planning artifact。

### snapshots

保存有限回滚快照。

主要接口：

```ts
captureSnapshot(save, label, round)
findRollbackSnapshot(saveId, round, preferred)
restoreSnapshotState(save, snapshot)
pruneAfter(saveId, round, inclusive)
```

当前策略：

- 回滚系统已简化为“最多回到上一回合”。
- `captureSnapshot` 后会清理更旧快照，只保留当前回合与上一回合附近的快照。
- `findRollbackSnapshot` 只查目标回合的快照，不再向更早回合兜底，避免恢复到过旧状态。
- `pruneAfter` 会清理 rounds / agentCalls / snapshots，以及非 human 的未来司书库文件。

意义：

- 支持最近一轮编辑、重写、重新生成。
- 不再承担任意历史深度回滚。

### workspaceDocs

司书库文件。

主要底层接口：

```ts
getWorkspaceDocuments(saveId)
getWorkspaceManifest(saveId)
getWorkspaceDocumentByPath(saveId, path)
createWorkspaceDocument(input)
patchWorkspaceDocument(id, patch)
deleteWorkspaceDocument(id)
searchWorkspaceDocuments(saveId, query, limit)
```

意义：

- 后续模型工具的主要读取入口。
- 保存正史、规划、角色、物品、场景、事件、记忆、审校等文件。
- 与 ledger 区分：司书库是“模型工作区”，ledger 是“原始底账”。

## 3. 当前新增内部落盘口

文件：

```txt
src/services/workspacePersistence.ts
```

这是代码层内部接口，不是 LLM tool。

### writeWorkspaceFile

```ts
writeWorkspaceFile(saveId, path, content, options)
```

意义：

- 传入 saveId、文件路径、内容即可落盘。
- 默认不覆盖 `updatedBy='human'` 的玩家手写文件。
- 后续小模型自动保存 planning artifact 时优先使用。

适用：

```txt
planning/latest/character-plan.json
planning/rounds/0012/scene-plan.json
director/current-plan.md
audits/logic-review.md
```

### writeWorkspaceJson

```ts
writeWorkspaceJson(saveId, path, value, options)
```

意义：

- 将对象 JSON.stringify 后写入司书库。
- 自动加 `json` 标签。
- 适合保存模型结构化输出。

### writeWorkspaceFiles

```ts
writeWorkspaceFiles(saveId, files, defaults)
```

意义：

- 批量写入多个司书库文件。
- 每个元素只需要提供 `path` 与 `content`，其余元数据可从 `defaults` 继承。
- 这是后续“小模型输出一组文件草稿后，由代码统一落盘”的主入口之一。

示例：

```ts
await writeWorkspaceFiles(saveId, [
  { path: 'planning/latest/character-plan.json', content: json },
  { path: 'planning/rounds/0012/character-plan.json', content: json },
], {
  kind: 'audit',
  round: 12,
  updatedBy: 'characterPlanner',
});
```

### appendWorkspaceFile

```ts
appendWorkspaceFile(saveId, path, content, options)
```

意义：

- 向已有文件追加一个小节。
- 文件不存在时创建。
- 适合追加“第 N 回合更新”“本次审校”“待核对”。

### patchWorkspaceFileByPath

```ts
patchWorkspaceFileByPath(saveId, path, patch, options)
```

意义：

- 按路径修改司书库文件元数据或内容。
- 默认不覆盖玩家手写文件。

### readWorkspaceFile

```ts
readWorkspaceFile(saveId, path)
```

意义：

- 内部按路径读取文件。
- 后续可作为语义读取工具的底层。

### readWorkspaceFiles

```ts
readWorkspaceFiles(saveId, paths)
```

意义：

- 按路径批量读取文件。
- 自动规范化路径并去重。
- 适合后续工具在一次调用中读取“角色档案 + 场景档案 + 当前规划”等少量明确文件。

### listWorkspaceFiles

```ts
listWorkspaceFiles(saveId, options)
```

意义：

- 返回司书库 manifest，不返回全文。
- 可按目录 `path`、`kind`、`tags`、是否包含归档文件过滤。
- 后续给模型展示“当前有哪些文件可读”时优先使用，避免直接塞全文。

### searchWorkspaceFiles

```ts
searchWorkspaceFiles(saveId, query, options)
```

意义：

- 搜索司书库文件全文并返回命中文件。
- 适合后续语义读取工具底层使用。
- 仍应由工具层控制数量，避免模型一次读入过多资料。

### planningArtifactPath

```ts
planningArtifactPath(kind, round?)
```

意义：

- 统一生成 planning artifact 路径。

示例：

```ts
planningArtifactPath('character-plan', 12)
```

返回：

```json
{
  "latest": "planning/latest/character-plan.json",
  "round": "planning/rounds/0012/character-plan.json"
}
```

### writePlanningArtifact

```ts
writePlanningArtifact(saveId, kind, value, options)
```

意义：

- 同时写入 `planning/latest/{kind}.json` 与 `planning/rounds/NNNN/{kind}.json`。
- `value` 可以是字符串或对象；对象会被 JSON 化。
- 当前仅提供口子，不主动接任何小模型；后续小模型自动保存时可直接调用。

## 4. 未来小模型自动保存建议

后续不要让小模型自己调用写入工具。

建议服务层在模型输出成功后执行：

```ts
await writePlanningArtifact(saveId, 'character-plan', plan, {
  kind: 'audit',
  round: completedRound,
  updatedBy: 'characterPlanner',
});
```

但当前阶段仅准备接口，暂不接入自动保存。

## 5. 回滚与司书库关系

当前已调整：

```txt
pruneAfter(saveId, round, inclusive)
```

除清理 rounds / agentCalls / snapshots 外，也会清理：

```txt
updatedAtRound 在回滚点之后
且 updatedBy !== 'human'
的 workspaceDocs
```

目的：

- 防止回滚后模型读到未来角色、物品、事件、规划文件。
- 保留玩家手写司书库文件，避免误删用户资产。

注意：

- 这只是第一版简单策略。
- 后续如果出现“玩家手写但只适用于未来”的文件，需要 UI 或文件元数据额外标记。

## 6. 后续工具系统接口预期

当工具系统开工时，不应直接散落调用底层 repository。

建议：

```txt
工具读取 → 走语义工具 / workspacePersistence / repository
工具写入 → 走受控写入口，不直接 putWorkspaceDocument
小模型保存 → 走 workspacePersistence，代码自动写，不交给模型
```

第一批语义读取工具可基于这些接口实现：

```txt
get_latest_planning_bundle
get_latest_character_plan
get_latest_scene_plan
get_latest_event_plan
get_latest_outline_mapping
get_latest_stage_judge
get_latest_director_plan
```

第一批司辰 run_xxx 工具后续基于：

```txt
小模型 request 函数
+ workspacePersistence 自动保存
+ 返回结果给司辰
```

## 7. 当前不要做

- 不让小模型直接拿工具。
- 不让故事写手获得写入工具。
- 不把 agentCalls 当高频资料入口。
- 不把 planning artifact 直接当正史。
- 不继续扩写 prompt 来承担资料搬运。

## 8. 工具权限第一版落地

当前已将：

```ts
buildWorkspaceToolRuntime(save, { agentKind })
```

作为工具运行时入口。不同模型会得到不同工具集和不同的【本回合可用工具】系统说明。

当前策略：

```txt
故事写手：只读
回合司辰：只读核心工具 + 近期模型记录读取
叙事导演 / 主弧 / 设定守护 / 记忆 / 逻辑审校：固定只读工具
人物 / 场景 / 事件 / 大纲映射 / 阶段判断小模型：无工具
决策 / 摘要 / 随机事件 / 评价：暂不开放工具
写入工具：保留代码，不默认暴露
```

已新增语义读取工具：

```txt
get_latest_planning_bundle
get_latest_character_plan
get_latest_scene_plan
get_latest_event_plan
get_latest_outline_mapping
get_latest_stage_judge
get_latest_director_plan
get_entity_doc
get_active_event_docs
```

后续如果实现小模型自动保存，这些语义工具可以自然读取 `planning/latest/*` 文件；在此之前，它们会优先返回 state 中的最新规划结果。
