import type { LlmUsage } from '@/types/llm';
export type AgentPromptTraceMessage={role:string;content:string};
export interface AgentPromptTrace{system?:string;user?:string;messages?:AgentPromptTraceMessage[];inputSummary?:string}
export interface AgentCallRecord{id:string;saveId:string;round:number;kind:string;label:string;input?:AgentPromptTrace;thinking?:string;output?:string;usage?:LlmUsage;cacheHit?:boolean;createdAt:number}
