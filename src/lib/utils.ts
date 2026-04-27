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

// 提取首个 JSON 对象（应对模型包裹 markdown code fence 的情况）
export function extractJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  // 去掉 ```json ... ``` 包裹
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cand = fenced ? fenced[1] : text;
  const match = cand.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
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

export function nowMs(): number {
  return Date.now();
}
