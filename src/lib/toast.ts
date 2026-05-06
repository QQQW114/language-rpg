/**
 * 轻量 toast 队列。不依赖 Zustand，用最简单的 emitter 模式。
 *
 * 用法：
 *   import { toast } from '@/lib/toast';
 *   toast.info('已复制到剪贴板');
 *   toast.warn('设定守护失利，沿用上次设定');
 *   toast.success('旅程包已写入文件。');
 *   toast.danger('出错：xxx');
 *
 *   // 在某个根组件挂一次 <ToastViewport />
 *
 * 设计：
 * - 队列上限 4 条；超出移除最旧的
 * - 每条默认 4 秒后自动移除
 * - 同一文本+kind 在 1.5s 内重复进入会被去重（只重置 expireAt）
 */

import { genId } from './utils';

export type ToastKind = 'info' | 'success' | 'warn' | 'danger';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  durationMs: number;
}

type Listener = (items: ToastItem[]) => void;

const MAX_ITEMS = 4;
const DEFAULT_DURATION = 4000;
const DEDUPE_WINDOW = 1500;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let timer: number | null = null;

function emit() {
  for (const l of listeners) l(items);
}

function scheduleSweep() {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    sweep();
  }, 250);
}

function sweep() {
  const now = Date.now();
  const next = items.filter((it) => now < it.createdAt + it.durationMs);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
  if (items.length > 0) scheduleSweep();
}

function push(kind: ToastKind, message: string, durationMs = DEFAULT_DURATION): string {
  const trimmed = String(message).trim();
  if (!trimmed) return '';

  const now = Date.now();
  const dupe = items.find(
    (it) => it.kind === kind && it.message === trimmed && now - it.createdAt < DEDUPE_WINDOW,
  );
  if (dupe) {
    dupe.createdAt = now;
    dupe.durationMs = durationMs;
    emit();
    scheduleSweep();
    return dupe.id;
  }

  const item: ToastItem = {
    id: genId('toast'),
    kind,
    message: trimmed,
    createdAt: now,
    durationMs,
  };
  items = [...items, item].slice(-MAX_ITEMS);
  emit();
  scheduleSweep();
  return item.id;
}

export const toast = {
  info: (message: string, ms?: number) => push('info', message, ms),
  success: (message: string, ms?: number) => push('success', message, ms),
  warn: (message: string, ms?: number) => push('warn', message, ms),
  danger: (message: string, ms?: number) => push('danger', message, ms),
  dismiss: (id: string) => {
    const before = items.length;
    items = items.filter((it) => it.id !== id);
    if (items.length !== before) emit();
  },
  clear: () => {
    if (items.length === 0) return;
    items = [];
    emit();
  },
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  // 立即推送一次当前快照
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
