import type { AgentPromptTrace } from '@/types/ledger';

export function withPromptTrace<T extends object>(
  value: T,
  trace: AgentPromptTrace | undefined,
): T & { trace?: AgentPromptTrace } {
  if (!trace) return value as T & { trace?: AgentPromptTrace };
  Object.defineProperty(value, 'trace', {
    value: trace,
    enumerable: false,
    configurable: true,
  });
  return value as T & { trace?: AgentPromptTrace };
}
