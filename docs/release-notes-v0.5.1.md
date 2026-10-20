# v0.5.1 发行说明（2026-10-20）

本版是 0.5.0 之后的内容与文档补丁，不涉及协议或存档结构变更。

## 新增

- **内置预设故事从 1 个增加到 3 个**：
  - 《余温代行人》——近未来市井科幻 / 悬疑潜行，5 幕 15 节；
  - 《赝品修复师》——都市古玩悬疑 / 手艺日常，5 幕 15 节；
  - 两个故事各带一本配套世界书（7 个条目），已通过内容库校验并挂载 `worldBookIds`。
- 新增 `tests/presets.test.ts`：校验内置预设的必填字段、id 唯一、世界书引用可解析、幕/节结构数量。

## 文档

- 新增 `docs/prompt-design-log.md`：外部评审结论、Prompt Pack v2/v2.1 的 A/B 数据、过拟合审计与模型分级建议。
- 新增 `docs/preset-authoring.md`：预设故事编写规范与导入格式；新增 `docs/content-examples/` 示例归档。
- 清理 `docs/temp/` 临时评审/反馈/前端交接文件；`docs/README.md` 导航同步。

## 兼容性

- 存档格式未变（`SAVE_STORAGE_VERSION = 2`），无需迁移；旧存档仍保留创建时的大纲副本，新预设只影响新旅程。
- 设置未变；联网搜索仍默认关闭。
- Gemini 包中的两个「出身」是故事专属主角，未导入（出身是全局选择，避免跨故事错配）；原始包保留在 `docs/content-examples/gemini-presets-2026-10-20.json`。

## 验证

- 单元测试 **560/560**（20 个测试文件）；`test:e2e` 43/43；`test:patch`、`test:storage`、`npm run build` 通过。
- 导入校验：`validateImportBundle` 0 issues（2 outlines / 2 worldBooks / 2 backgrounds），内置预设断言全绿。
