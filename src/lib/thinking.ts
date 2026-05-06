export interface SplitThinkingResult {
  text: string;
  thinking?: string;
}

export function splitThinkingFromText(input: string): SplitThinkingResult {
  if (!input) return { text: '' };
  const thinking: string[] = [];
  const text = input.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const cleaned = String(inner ?? '').trim();
    if (cleaned) thinking.push(cleaned);
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return {
    text,
    thinking: thinking.join('\n\n').trim() || undefined,
  };
}

export function joinThinking(...parts: Array<string | undefined>): string | undefined {
  const text = parts.map((p) => p?.trim()).filter(Boolean).join('\n\n').trim();
  return text || undefined;
}
