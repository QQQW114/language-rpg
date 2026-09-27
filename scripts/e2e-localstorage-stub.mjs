// 必须在 import 任何使用 zustand persist 的模块之前求值：
// persist 在 store 模块求值时就读取 localStorage，因此这个文件要作为第一个 import。
const backing = new Map();

globalThis.localStorage = {
  getItem: (key) => (backing.has(key) ? backing.get(key) : null),
  setItem: (key, value) => { backing.set(key, String(value)); },
  removeItem: (key) => { backing.delete(key); },
  clear: () => { backing.clear(); },
  key: (index) => [...backing.keys()][index] ?? null,
  get length() { return backing.size; },
};

export const storageBacking = backing;
