// 通用工具

export function genId(prefix = 'id'): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// 从 start（必须是 '{'）起找到第一个括号平衡的 JSON 对象文本。
// 必须跳过字符串字面量内部的括号，否则 {"note":"}"} 会被提前截断。
// sawExtensibleTail：扫描到文本结尾仍未闭合时置为 true，说明从 start 起
// 整个尾部都处于未闭合状态，后续候选必然同样无法闭合，可以直接停止尝试。
function balancedObjectText(text: string, start: number, state?: { sawExtensibleTail: boolean }): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  if (state) state.sawExtensibleTail = true;
  return null;
}

// 在候选文本中找出首个可解析的 JSON 对象。
function firstJSONObjectIn(cand: string): string | null {
  // 没有任何 '}' 时不可能存在完整对象。这个 O(1) 预检同时挡掉了
  // “整段都是 '{'”的病态输入：否则下面每个 '{' 都会白扫到结尾，
  // 退化成 O(n²)（实测 200KB 输入会让标签页冻结两分钟以上）。
  if (cand.indexOf('}') === -1) return null;
  // 逐个 '{' 尝试平衡切片：模型在 JSON 前后或之后继续输出说明时，
  // 贪婪匹配会把多段文本一起截断，导致整体解析失败。
  for (let i = cand.indexOf('{'); i !== -1; i = cand.indexOf('{', i + 1)) {
    const state = { sawExtensibleTail: false };
    const objectText = balancedObjectText(cand, i, state);
    if (!objectText) {
      // 从该 '{' 到结尾都没有闭合：更靠后的候选不可能闭合成功（截断输入）。
      // 直接返回 null，而不是退而返回某个内层对象。
      if (state.sawExtensibleTail) return null;
      continue;
    }
    try {
      JSON.parse(objectText);
      return objectText;
    } catch {
      // 该片段不是合法 JSON，继续找下一个 '{'。
    }
  }
  return null;
}

// 提取首个可解析的 JSON 对象文本（应对模型包裹 markdown code fence、
// 在 JSON 前后写解释文字、或一次返回多个对象的情况）。
// 返回的是可直接 JSON.parse 的字符串；找不到时返回 null。
export function extractJSONText(text: string): string | null {
  if (!text) return null;
  // 优先信任 ```json ... ``` 包裹的内容。
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    // 回退到全文：模型可能先给出合法 JSON，后面才跟一个装着伪代码或
    // 半截 JSON 的 fence。只认 fence 会把前面完全合法的对象一起丢掉。
    return firstJSONObjectIn(fenced[1]) ?? firstJSONObjectIn(text);
  }
  return firstJSONObjectIn(text);
}

// 提取并解析首个 JSON 对象（应对模型包裹 markdown code fence 的情况）
export function extractJSON<T = unknown>(text: string): T | null {
  const raw = extractJSONText(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// 用于提示词模板的占位替换
export function formatTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

// 截取字符串的末尾 N 个字符，保证关键词匹配只在"最近上下文"中执行
export function tail(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(s.length - n);
}

/**
 * 清洗"可选覆盖"文本字段：模型没给、给了空串或只有空白时保留旧值。
 * 用 `raw || previous` 是不够的——`'   '` 是 truthy，会绕过回退，
 * 清洗后变成空串并把已有的摘要/进度清掉。
 * previous 也缺失时回落为 fallback（默认空串），避免产出 undefined 字段。
 */
export function textOrPrevious(
  raw: unknown,
  previous: string | undefined,
  max: number,
  fallback = '',
): string {
  const cleaned = String(raw ?? '').trim().slice(0, max);
  return cleaned || previous || fallback;
}

export function nowMs(): number {
  return Date.now();
}
