# 内容示例

用于编写/生成预设故事与世界书的参考文件。字段规范见 [`../preset-authoring.md`](../preset-authoring.md)，运行时类型见 `src/types/content.ts`。

| 文件 | 说明 |
|---|---|
| `misplaced-youth.outline.json` | 内置预设《错位青春》的完整 `StoryOutline`（5 幕 15 节，含幕级可选字段），黄金参考 |
| `misplaced-youth.worldbook.json` | 配套 `WorldBook`（7 个条目，含 alwaysActive 与关键词条目） |
| `freshman-xiyu.background.json` | 出身 `Background` 示例（全局出身，不绑定故事） |
| `gemini-presets-2026-10-20.json` | 外部模型生成的原始 `ImportBundle`（2 个故事 + 2 本世界书 + 2 个故事专属出身），保留作来源记录；两个出身已导入并分别绑定到对应故事的 `backgroundIds` |

导入格式：

```json
{ "outlines": [ ... ], "worldBooks": [ ... ], "backgrounds": [ ... ] }
```

在「故事与世界书工坊 → 导入」选择 JSON 即可；同 id 更新自定义内容，内置预设不会被覆盖。新增内置预设请改 `src/presets/outlines.ts` / `src/presets/worldbooks.ts` 并同步 `tests/presets.test.ts` 与 `docs/preset-authoring.md` 的内置预设表。
