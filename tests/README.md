# tests/ — 单元测试

无网络、无 API Key、无新增依赖。源码是 TS/TSX，Node 不能直接执行，因此统一用
`esbuild` 打包到 `test-runs/unit/`，再用 `node:test` 逐文件（独立子进程）运行。

## 运行

```bash
cmd /c npm test                                 # 打包 + 全量运行（等价于下面的第一条）
node scripts/run-unit-tests.mjs --filter=patch   # 只跑文件名含 patch 的测试
node scripts/run-unit-tests.mjs --no-build       # 复用上次打包产物
```

运行器行为：

- esbuild 参数：`bundle: true`、`platform: 'node'`、`format: 'esm'`、`alias: { '@': '<repo>/src' }`、`logLevel: 'silent'`；
- `node --test --test-force-exit`，spec 报告写入 `test-runs/unit-reports/spec.txt` 后回显，
  TAP 报告用于统计；失败时以非零码退出并打印失败用例名；
- 子进程统一 `stdio: 'inherit'`（沙箱下管道 stdio 可能 EPERM）；
- 每个测试文件在独立进程里运行，单个文件失败/求值期崩溃不影响其他文件（已用临时探针验证）。

## 约定

- 测试文件：`tests/**/*.test.ts`；夹具与桩：`tests/helpers/*.ts`。
- 从 `@/...` 直接 import 源码（打包时按 alias 解析），不要 import `test-runs/` 里的产物。
- 涉及 zustand persist 的测试，必须把 `import './helpers/localStorageStub'` 放在**第一条 import**：
  ESM 按声明顺序求值，persist 在 store 模块求值时就读取 `localStorage`。
- 所有模型调用都用 `tests/helpers/streamFixtures.ts` 的 `withFetchMock` 拦截 `globalThis.fetch`，
  手工推 SSE 帧；绝不发真实请求。
- 断言与当前实现冲突时，先判断这是 bug 还是刻意的宽松设计：
  - 确认是 bug（例如解析/合并丢数据）：修复 `src/`，并把测试改为断言**修复后**的行为，同时登记进 `docs/known-issues.md`；
  - 属于产品判断（例如校验松紧）：**不改 src**，用例名标注 `（当前实现边界）`，写清"实际行为"，并登记进 [`../docs/known-issues.md`](../docs/known-issues.md) 待决策。

## 文件与覆盖面

| 文件 | 覆盖 |
|---|---|
| `utils.test.ts` | `extractJSONText` 括号平衡扫描（多对象取首个、字符串内括号、转义引号）/ `extractJSON` / `clamp` / `tail` / `formatTemplate` / `clsx` / `genId` |
| `llmUsage.test.ts` | DeepSeek 与 OpenAI 缓存字段归一化、`mergeLlmUsage` 逐字段保留、缓存展示辅助 |
| `sse.test.ts` | chat/responses 两种 SSE、`<think>` 跨帧拆分、`thinkingFallback`、tool_calls 聚合、usage 合并、`length`/错误帧 |
| `patch.test.ts` | `commitTurnPatchV2` 全部守卫与增量合并（人物/关系/库存/线程/事实/故事节/结局/随机事件/actions） |
| `engine.test.ts` | `normalizeDestinyPatch`、`runTurnV2` 三阶段端到端（mock fetch）、失败路径、工具循环、视角与注入 |
| `store.test.ts` | `useGameStoreV2` 的 create / commitSuccessfulTurn / restoreLastTurn / remove / persist |
| `contentLibrary.test.ts` | 大纲、世界书、导入包校验与导出/导入往返 |
| `contentStore.test.ts` | `useContentStore` 增删改、预设保护、导入导出、v3 与旧版持久化兼容 |
| `workshopModel.test.ts` | 工坊校验分级、克隆换 id、保存前归一化、`safeFilename`、导出封装与下载 |
