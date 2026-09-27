/**
 * Node 环境下的 localStorage 最小内存实现。
 *
 * 必须在 `@/v2/store` / `@/store/useContentStore` 被求值之前安装：
 * 这两个模块在顶层调用 zustand `persist(...)`，persist 会立刻读取
 * `localStorage`（读取失败会退化为“storage 不可用”，hydration 被跳过）。
 *
 * 用法：在测试文件里把它作为**第一条 import** 导入；ESM 会按 import 声明
 * 顺序求值，因此本模块一定先于 store 模块执行。
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    const value = this.map.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }

  [name: string]: unknown;
}

export const memoryStorage = new MemoryStorage();

// 覆盖可能存在的宿主 localStorage，保证测试写入的是一个干净的内存实现。
(globalThis as unknown as { localStorage: Storage }).localStorage = memoryStorage;

/** 读取并解析某个持久化 key（不存在或非法 JSON 时返回 undefined）。 */
export function readPersisted(key: string): unknown {
  const raw = memoryStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 写入 persist 期望的包装格式：{ state, version }。 */
export function seedPersisted(key: string, state: unknown, version: number): void {
  memoryStorage.setItem(key, JSON.stringify({ state, version }));
}

export function clearPersisted(): void {
  memoryStorage.clear();
}
