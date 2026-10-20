#!/usr/bin/env node
/**
 * 单元测试运行器：esbuild 打包 tests/**\/*.test.ts → test-runs/unit/<scope>/*.test.mjs，
 * 再用 node:test 逐文件（独立子进程）运行，最后打印可读汇总。
 *
 * <scope> 由 --filter 决定（未过滤时为 all）：多个 agent 并行开发时可能同时跑
 * 不同过滤条件的测试，按 filter 隔离产物与报告目录，避免后启动的进程 rm -rf
 * 掉先启动进程正在使用的文件。
 *
 * 设计约束：
 * - 不新增任何 npm 依赖（只用 esbuild + Node 内置模块）。
 * - 无网络、无 API Key：测试内部一律 mock fetch。
 * - 子进程 stdio 使用 inherit（沙箱下管道 stdio 可能 EPERM）；
 *   测试报告由 node 自己写进文件，本脚本读取后再打印。
 * - 单个测试文件失败不影响其他文件（node --test 默认每文件独立进程）。
 *
 * 用法：
 *   node scripts/run-unit-tests.mjs                # 打包 + 全量运行
 *   node scripts/run-unit-tests.mjs --filter=patch # 只跑文件名含 patch 的测试
 *   node scripts/run-unit-tests.mjs --no-build     # 复用上次打包产物
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(rootDir, 'tests');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

const filter = flagValue('filter');
const skipBuild = hasFlag('no-build');
// 并行跑测试时按 filter 隔离目录：不同 scope 互不删除对方的产物。
// 同一 scope 的两次运行仍会互相覆盖，这属于预期（同一过滤条件不该并发跑）。
const scope = filter ? filter.replace(/[^a-zA-Z0-9_-]/g, '_') : 'all';
const outDir = path.join(rootDir, 'test-runs', 'unit', scope);

async function collectTestFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await collectTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found.sort();
}

function outputPathFor(testFile) {
  const relative = path.relative(testsDir, testFile).split(path.sep).join('/');
  return path.join(outDir, relative.replace(/\.ts$/, '.mjs'));
}

async function bundle(testFiles) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({
    absWorkingDir: rootDir,
    entryPoints: testFiles,
    outdir: outDir,
    outbase: testsDir,
    entryNames: '[dir]/[name]',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': path.join(rootDir, 'src') },
    // Node 内置模块保持外部引用；并用 createRequire 补齐 CJS 互操作层：
    // `react-dom/server`（渲染结构回归测试用）走的是 CJS 分支、内部 require('stream')，
    // 而 esbuild 的 ESM 产物里默认没有 require，会以
    // "Dynamic require of \"stream\" is not supported" 在运行期炸掉。
    external: [
      'node:*',
      'stream', 'util', 'events', 'buffer', 'string_decoder', 'async_hooks',
      'fs', 'path', 'os', 'crypto', 'url', 'zlib', 'net', 'tls', 'http', 'https',
    ],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'silent',
  });
}

function parseTapSummary(tap) {
  const summary = {};
  for (const rawLine of tap.split('\n')) {
    const match = /^#\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+([\d.]+)\s*$/.exec(rawLine.trim());
    if (match) summary[match[1]] = Number(match[2]);
  }
  if (summary.tests === undefined) {
    summary.pass = (tap.match(/^ok \d+/gm) ?? []).length;
    summary.fail = (tap.match(/^not ok \d+/gm) ?? []).length;
    summary.tests = summary.pass + summary.fail;
  }
  return summary;
}

function parseTapFailures(tap) {
  const failures = [];
  for (const rawLine of tap.split('\n')) {
    const line = rawLine.trim();
    const match = /^not ok \d+\s+-\s+(.*?)(?:\s+#.*)?$/.exec(line);
    if (match) failures.push(match[1].trim());
  }
  return failures;
}

async function readIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

const allTests = await collectTestFiles(testsDir);
const selected = filter ? allTests.filter((f) => f.includes(filter)) : allTests;

if (!selected.length) {
  console.error(`[unit-tests] 没有找到测试文件（tests/**/*.test.ts${filter ? `，filter=${filter}` : ''}）。`);
  process.exit(1);
}

console.log(`[unit-tests] node ${process.version} · 测试文件 ${selected.length} 个 · 作用域 ${scope} · 产物目录 test-runs/unit/${scope}/`);

if (!skipBuild) {
  const startedAt = Date.now();
  try {
    await bundle(selected);
  } catch (error) {
    console.error('[unit-tests] esbuild 打包失败：');
    const errors = Array.isArray(error?.errors) ? error.errors : [];
    if (!errors.length) console.error(error);
    for (const item of errors) {
      const location = item.location ? `${item.location.file}:${item.location.line}:${item.location.column} ` : '';
      console.error(`  ✗ ${location}${item.text}`);
    }
    process.exit(1);
  }
  console.log(`[unit-tests] 打包完成（${Date.now() - startedAt} ms）`);
}

const builtFiles = selected.map(outputPathFor);
const missing = [];
for (const file of builtFiles) {
  try {
    await readFile(file);
  } catch {
    missing.push(path.relative(rootDir, file));
  }
}
if (missing.length) {
  console.error('[unit-tests] 缺少打包产物（去掉 --no-build 重新打包）：');
  for (const file of missing) console.error(`  ✗ ${file}`);
  process.exit(1);
}

const reportDir = path.join(rootDir, 'test-runs', 'unit-reports', scope);
await rm(reportDir, { recursive: true, force: true });
await mkdir(reportDir, { recursive: true });
const specFile = path.join(reportDir, 'spec.txt');
const tapFile = path.join(reportDir, 'tap.txt');

const nodeArgs = [
  '--test',
  '--test-force-exit',
  '--test-reporter=spec',
  `--test-reporter-destination=${specFile}`,
  '--test-reporter=tap',
  `--test-reporter-destination=${tapFile}`,
  ...builtFiles,
];

const startedRun = Date.now();
const exitCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[unit-tests] 无法启动 node --test：${error.message}`);
    resolve(1);
  });
  child.on('close', (code) => resolve(code ?? 1));
});
const elapsed = Date.now() - startedRun;

const spec = await readIfExists(specFile);
const tap = await readIfExists(tapFile);

if (spec.trim()) {
  process.stdout.write(spec.endsWith('\n') ? spec : `${spec}\n`);
}

const summary = parseTapSummary(tap);
const failures = parseTapFailures(tap);
const passed = summary.pass ?? 0;
const failed = summary.fail ?? 0;

console.log('─'.repeat(60));
if (exitCode === 0) {
  console.log(`[unit-tests] 通过：tests ${summary.tests ?? passed} · pass ${passed} · fail 0 · 子进程耗时 ${elapsed} ms`);
} else {
  console.log(`[unit-tests] 失败：tests ${summary.tests ?? passed + failed} · pass ${passed} · fail ${failed} · 子进程耗时 ${elapsed} ms · exit ${exitCode}`);
  if (failures.length) {
    console.log('[unit-tests] 失败用例：');
    for (const name of failures.slice(0, 40)) console.log(`  ✗ ${name}`);
  } else {
    console.log('[unit-tests] 没有解析到失败用例名，请查看上面的 spec 输出（可能是打包/加载期错误）。');
  }
  console.log(`[unit-tests] 完整报告：${path.relative(rootDir, specFile)} · ${path.relative(rootDir, tapFile)}`);
}
console.log('─'.repeat(60));

process.exit(exitCode);
