import type { GameSave, Item, NpcUpdateRaw } from '@/types/game';
import type { Background, StoryOutline, WorldBook } from '@/types/content';
import type { AgentCallRecord, RoundRecord } from '@/types/ledger';
import type { WorkspaceDocument, WorkspaceDocumentKind, WorkspaceDocumentManifestItem } from '@/types/workspace';
import type { ChatParams, ChatTool } from '@/services/llmClient';
import { seedWorkspaceDocumentsFromSave } from '@/lib/workspaceSeed';
import { normalizeStrictCustomConfig } from '@/lib/strictCustom';
import {
  selectAllBackgrounds,
  selectAllOutlines,
  selectAllWorldBooks,
  useContentStore,
} from '@/store/useContentStore';
import {
  createWorkspaceDocument,
  getAgentCalls,
  getRounds,
  getWorkspaceDocumentByPath,
  getWorkspaceManifest,
  getWorkspaceDocuments,
  normalizeWorkspacePath,
  patchWorkspaceDocument,
  searchWorkspaceDocuments,
} from '@/storage/ledgerRepository';
import { useGameStore } from '@/store/useGameStore';
import { clamp, genId } from '@/lib/utils';

export type WorkspaceToolName =
  | 'list_docs'
  | 'read_doc'
  | 'search_docs'
  | 'get_entity_doc'
  | 'get_recent_rounds'
  | 'get_round_record'
  | 'get_current_round_agent_calls'
  | 'get_recent_agent_calls'
  | 'get_agent_output'
  | 'get_current_state'
  | 'get_recent_history'
  | 'get_story_briefing'
  | 'get_story_outline'
  | 'get_initial_scene'
  | 'get_background'
  | 'get_world_books'
  | 'get_journey_content'
  | 'get_author_custom_config'
  | 'get_story_style'
  | 'get_master_arc'
  | 'get_director_plan'
  | 'get_active_events'
  | 'get_active_arcs'
  | 'get_npc_list'
  | 'get_npc_detail'
  | 'get_latest_planning_bundle'
  | 'get_latest_character_plan'
  | 'get_latest_scene_plan'
  | 'get_latest_event_plan'
  | 'get_latest_outline_mapping'
  | 'get_latest_stage_judge'
  | 'get_latest_director_plan'
  | 'get_active_event_docs'
  | 'ask_director'
  | 'run_character_analysis'
  | 'run_scene_analysis'
  | 'run_event_analysis'
  | 'set_npc_affinity'
  | 'add_npc_note'
  | 'grant_minor_item'
  | 'update_item_note'
  | 'write_doc'
  | 'patch_doc'
  | 'append_doc'
  | 'archive_doc'
  | 'write_entity_doc';

export type WorkspaceAgentKind =
  | 'orchestrator'
  | 'story'
  | 'director'
  | 'directorReply'
  | 'masterArc'
  | 'settingGuard'
  | 'logicCheck'
  | 'memory'
  | 'summary'
  | 'decision'
  | 'randomEvent'
  | 'stageJudge'
  | 'outlineMapper'
  | 'characterPlanner'
  | 'scenePlanner'
  | 'eventPlanner'
  | 'eventBeat'
  | 'review'
  | 'librarian'
  | 'default';

export interface WorkspaceToolContext {
  save: GameSave;
  agentKind?: WorkspaceAgentKind;
  allowedTools?: ReadonlySet<WorkspaceToolName>;
  analysisToolHandler?: (name: WorkspaceToolName, args: Record<string, unknown>, ctx: WorkspaceToolContext) => Promise<unknown>;
}

export interface WorkspaceToolSpec {
  type: 'function';
  function: {
    name: WorkspaceToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const WORKSPACE_READ_TOOL_SPECS: WorkspaceToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_docs',
      description: '列出司书库文件。可按目录 path 过滤，只返回 manifest，不返回全文。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，例如 characters/ 或 director/。留空则列出全部。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_doc',
      description: '读取司书库中某个文件的全文。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: '文件路径，例如 characters/小晴/profile.md。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description: '在司书库中搜索关键词，返回命中的文件全文。适合查找角色、场景、伏笔、规范。',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', description: '最大返回数量，默认 8。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entity_doc',
      description: '按实体类型和名称读取角色、能力、场景或事件档案；不知道路径时优先用它，系统会尝试默认路径与搜索。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', description: 'character | item | scene | event' },
          name: { type: 'string', description: '实体名称，例如“小晴”“钢笔”“女厕”“逛街事件”。' },
          path: { type: 'string', description: '若已知司书库路径，可直接指定。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_rounds',
      description: '读取最近 n 回合的回合卷宗。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'number', description: '回合数，默认 3。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_round_record',
      description: '读取指定回合的回合卷宗。',
      parameters: {
        type: 'object',
        required: ['round'],
        properties: {
          round: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_round_agent_calls',
      description: '读取本回合已经完成的模型调用列表。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_agent_calls',
      description: '读取最近 n 次模型调用记录，包含模型类型、输出和 usage。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'number', description: '调用次数，默认 8。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_output',
      description: '按 callId 读取某次模型的实际输出。',
      parameters: {
        type: 'object',
        required: ['callId'],
        properties: {
          callId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_state',
      description: '读取当前旅程状态摘要：回合、场景、时间天气、NPC、能力、长期记忆和最近玩家输入。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_history',
      description: '直接读取当前存档中的最近 n 条对话消息；当回合卷宗还未同步或需要当前浏览器态时使用。',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'number', description: '消息条数，默认 8。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_story_briefing',
      description: '读取当前旅程关键资料包：完整故事大纲、开局文本、出身、故事风格、主弧、导演计划、活跃事件。适合处理回忆、补写跳过剧情、核对大纲因果。',
      parameters: {
        type: 'object',
        properties: {
          round: { type: 'number', description: '需要核对的目标回合，默认下一回合。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_story_outline',
      description: '读取当前旅程选择的完整原始故事大纲，包含 acts/幕结构。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_initial_scene',
      description: '读取当前旅程的开局文本 / startScene。处理“刚开始发生了什么”“回忆开局”时优先使用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_background',
      description: '读取当前旅程选择的出身 / 角色初始设定。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_world_books',
      description: '读取当前旅程挂载的世界书。默认返回摘要；includeEntries=true 时返回条目内容。',
      parameters: {
        type: 'object',
        properties: {
          includeEntries: { type: 'boolean', description: '是否返回世界书条目正文，默认 false。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_journey_content',
      description: '读取旅程创建时固化的内容配置摘要：所选大纲、出身、世界书、模式、随机事件、模型链路配置开关等。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_author_custom_config',
      description: '读取执笔模式/严格自定义的规则与提示词覆盖开关。默认不返回完整模板正文。',
      parameters: {
        type: 'object',
        properties: {
          includeTemplates: { type: 'boolean', description: '是否返回 system/user 覆盖模板全文，默认 false。' },
          round: { type: 'number', description: '目标回合；仅用于说明当前判断位置。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_story_style',
      description: '读取创建旅程时固化的故事长度与风格偏好设置。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_master_arc',
      description: '读取执笔模式主弧 / 阶段化目标。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_director_plan',
      description: '读取叙事导演当前计划。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_events',
      description: '读取当前正在进行的长线事件 / 动态随机事件。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_planning_bundle',
      description: '读取最新规划包：大纲映射、阶段判断、人物/场景/事件规划、叙事导演计划、主弧和活跃事件。优先返回 state 中的最新结果，并附带司书库 planning/latest 文件。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_character_plan',
      description: '读取最新人物规划/人物关系分析结果。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_scene_plan',
      description: '读取最新场景规划/时空资源分析结果。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_event_plan',
      description: '读取最新事件规划/事件生命周期分析结果。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_outline_mapping',
      description: '读取最新大纲映射结果，用于判断当前剧情对齐哪段大纲。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_stage_judge',
      description: '读取最新阶段判断/玩家意图判断结果。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_director_plan',
      description: '读取最新叙事导演计划和 writingBrief。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_event_docs',
      description: '读取当前活跃事件状态，并尽量返回 timeline/active-events.md 与 timeline/events/ 下相关事件档案。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const ORCHESTRATOR_ANALYSIS_TOOL_SPECS: WorkspaceToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'run_character_analysis',
      description: '回合司辰专用：带着明确问题运行人物规划分析，判断角色身份、关系、出场必要性、知情范围和动机。结果会落入本轮人物规划，供司辰和叙事导演读取；它是工具调用，不要再写入 calls。',
      parameters: {
        type: 'object',
        required: ['question', 'reason'],
        properties: {
          question: { type: 'string', description: '必须回答的具体问题，例如“小晴是否是既有角色？她本回合是否应出场？”' },
          reason: { type: 'string', description: '为什么本轮需要这次人物分析。' },
          focus: { type: 'string', description: '分析焦点，例如角色身份、关系推进、出场必要性。' },
          relatedNames: { type: 'array', items: { type: 'string' }, description: '涉及的人物、称呼或线索名。' },
          expectedOutput: { type: 'string', description: '希望返回的结论形式或重点。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_scene_analysis',
      description: '回合司辰专用：带着明确问题运行场景规划分析，判断地点、时间、天气、空间资源、行动阻力和人物出现的场景合理性。结果会落入本轮场景规划，供司辰和叙事导演读取；它是工具调用，不要再写入 calls。',
      parameters: {
        type: 'object',
        required: ['question', 'reason'],
        properties: {
          question: { type: 'string', description: '必须回答的具体问题，例如“当前场景是否支持小晴自然出现？”' },
          reason: { type: 'string', description: '为什么本轮需要这次场景分析。' },
          focus: { type: 'string', description: '分析焦点，例如场景连续性、时间天气、空间资源。' },
          relatedNames: { type: 'array', items: { type: 'string' }, description: '涉及的地点、人物、事件或物件名。' },
          expectedOutput: { type: 'string', description: '希望返回的结论形式或重点。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_event_analysis',
      description: '回合司辰专用：带着明确问题运行事件规划分析，判断当前小事件是否继续、转折、完成、失败、延后或需要改写，并给出写作边界。结果会落入本轮事件规划，供司辰和叙事导演读取；它是工具调用，不要再写入 calls。',
      parameters: {
        type: 'object',
        required: ['question', 'reason'],
        properties: {
          question: { type: 'string', description: '必须回答的具体问题，例如“当前小事件是否已经完成或失败？”' },
          reason: { type: 'string', description: '为什么本轮需要这次事件分析。' },
          focus: { type: 'string', description: '分析焦点，例如事件生命周期、完成标准、写作边界。' },
          relatedNames: { type: 'array', items: { type: 'string' }, description: '涉及的事件、角色、场景或线索名。' },
          expectedOutput: { type: 'string', description: '希望返回的结论形式或重点。' },
        },
      },
    },
  },
];

export const EVENT_BEAT_TOOL_SPECS: WorkspaceToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'get_npc_list',
      description: '司事专用：列出当前旅程已存在的 NPC 简档、好感、最近备注与若干细节。只用于事件结算前核对对象，不会创建 NPC。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_npc_detail',
      description: '司事专用：按 npcId 或 name 查询一个已存在 NPC 的完整状态。用于好感结算与备注前核对身份；找不到时返回错误，不会创建 NPC。',
      parameters: {
        type: 'object',
        properties: {
          npcId: { type: 'string', description: 'NPC id；优先使用。' },
          name: { type: 'string', description: 'NPC 名称；不知道 id 时使用。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_arcs',
      description: '司事专用：读取当前 authorNarrative.activeArcs，并返回每个事件弧的生命周期、进度、完成/失败标准、写作边界和 milestone 标记。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_npc_affinity',
      description: '司事专用写工具：只调整已存在 NPC 的好感度，必须提供 npcId、delta、reason。工具层强制 |delta|≤30，找不到 NPC 时失败且不会创建新 NPC；reason 会写入 recentNote。',
      parameters: {
        type: 'object',
        required: ['npcId', 'delta', 'reason'],
        properties: {
          npcId: { type: 'string', description: '必须是当前已存在 NPC 的 id。' },
          delta: { type: 'number', description: '好感增量；工具层会限制在 -30 到 30。' },
          reason: { type: 'string', description: '事件结算理由，会写入 NPC.recentNote。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_npc_note',
      description: '司事专用写工具：给已存在 NPC 添加 recentNote，并可追加到 details。找不到 NPC 时失败且不会创建新 NPC。',
      parameters: {
        type: 'object',
        required: ['npcId', 'note'],
        properties: {
          npcId: { type: 'string', description: '必须是当前已存在 NPC 的 id。' },
          note: { type: 'string', description: '要记录的事件结算备注。' },
          appendToDetails: { type: 'boolean', description: '为 true 时同时追加到 NPC.details。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grant_minor_item',
      description: '司事专用写工具：授予事件内小能力/纪念物/备注。category 只能是 minor_ability、memento、note，工具层拒绝 main_ability；description 必须标明“事件得来”。',
      parameters: {
        type: 'object',
        required: ['name', 'description', 'category'],
        properties: {
          name: { type: 'string', description: '能力或纪念物名称。' },
          description: { type: 'string', description: '描述，必须明示“事件得来”。' },
          category: { type: 'string', enum: ['minor_ability', 'memento', 'note'], description: '只允许 minor_ability / memento / note。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_item_note',
      description: '司事专用写工具：给已有能力/物品追加事件备注，不创建新条目，不覆盖原 description 主体。',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: '已有能力/物品 id；优先使用。' },
          name: { type: 'string', description: '已有能力/物品名称；不知道 id 时使用。' },
          note: { type: 'string', description: '要追加的事件备注。' },
        },
      },
    },
  },
];

export const STORY_DIALOGUE_TOOL_SPECS: WorkspaceToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'ask_director',
      description: '故事写手专用：当遇到剧情复杂场景（缺角色信息、不清楚设定、剧情有跨节点冲突）、基于当前 brief 写不出合格段落时，向叙事导演提出一次询问。系统会暂停你的创作，触发导演专门答复，然后将答复注入对话由你继续创作。每回合仅可使用 1 次。不要用于日常细节询问。',
      parameters: {
        type: 'object',
        required: ['question'],
        properties: {
          question: {
            type: 'string',
            description: '具体问题，明确告诉导演你卡在哪里。例如：「我缺少小晴这个角色的信息」「我不清楚主角的能力设定」。',
          },
          missingInfo: {
            type: 'string',
            description: '可选：明确缺少的信息类型或范围，例如角色、设定、关系、能力、地点、跨回合因果等。',
          },
        },
      },
    },
  },
];

export const WORKSPACE_WRITE_TOOL_SPECS: WorkspaceToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'write_doc',
      description: '创建或整体覆盖一个司书库文件。适合写入模型已经整理好的当前正史、人物档案、能力档案、场景档案或事件档案。',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: '文件路径，例如 characters/小晴/profile.md、inventory/items/钢笔/item.md。' },
          title: { type: 'string' },
          kind: { type: 'string', description: '文件类型：character / inventory / scene / timeline / world / memory / rule / misc 等。' },
          content: { type: 'string', description: '文件全文。若只是补充一节，优先使用 append_doc。' },
          summary: { type: 'string', description: 'manifest 摘要，建议 20-120 字。' },
          tags: { type: 'array', items: { type: 'string' } },
          createOnly: { type: 'boolean', description: '为 true 时，若文件已存在则返回错误，不覆盖。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_doc',
      description: '按路径修改司书库文件的元数据或全文；不传 content 时只改标题、摘要、标签、归档/过期状态。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string' },
          content: { type: 'string' },
          summary: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          archived: { type: 'boolean' },
          stale: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_doc',
      description: '向司书库文件追加一个小节；适合记录“第 N 回合更新”“本次补充”“待核对”。若文件不存在会创建。',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          title: { type: 'string', description: '文件不存在时使用的标题。' },
          kind: { type: 'string', description: '文件不存在时使用的类型。' },
          heading: { type: 'string', description: '追加小节标题；默认按当前回合生成。' },
          content: { type: 'string', description: '追加正文。' },
          summary: { type: 'string', description: '可选：同时更新 manifest 摘要。' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选：同时更新标签。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archive_doc',
      description: '将某个司书库文件标记为 archived 或 stale；适合角色合并、能力失效/遗忘、事件结束后归档。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          archived: { type: 'boolean', description: '默认 true。' },
          stale: { type: 'boolean', description: '默认 false。' },
          reason: { type: 'string', description: '归档原因，会追加到文件末尾。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_entity_doc',
      description: '按统一格式写入角色、能力、场景或事件档案。适合模型把新生成/更新的实体沉淀成司书库文件。',
      parameters: {
        type: 'object',
        required: ['entityType', 'name', 'content'],
        properties: {
          entityType: { type: 'string', description: 'character | item | scene | event' },
          name: { type: 'string' },
          lifecycle: { type: 'string', description: '当前生命周期，如 active / background / owned / expired / completed / archived。' },
          content: { type: 'string', description: '当前事实正文；只写已经成立或明确标注为猜测/计划的内容。' },
          summary: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          path: { type: 'string', description: '可选自定义路径；不填则按实体类型自动生成。' },
          mode: { type: 'string', description: 'replace | append，默认 replace。append 会在原文件后追加回合更新。' },
          extra: { type: 'object', description: '可选结构化补充，会以 JSON 附在文件末尾。' },
        },
      },
    },
  },
];

export const WORKSPACE_TOOL_SPECS: WorkspaceToolSpec[] = [
  ...WORKSPACE_READ_TOOL_SPECS,
  ...ORCHESTRATOR_ANALYSIS_TOOL_SPECS,
  ...EVENT_BEAT_TOOL_SPECS,
  ...STORY_DIALOGUE_TOOL_SPECS,
  ...WORKSPACE_WRITE_TOOL_SPECS,
];

const WORKSPACE_READ_TOOL_NAMES = WORKSPACE_READ_TOOL_SPECS.map((spec) => spec.function.name);
const ORCHESTRATOR_ANALYSIS_TOOL_NAMES = ORCHESTRATOR_ANALYSIS_TOOL_SPECS.map((spec) => spec.function.name);
const EVENT_BEAT_TOOL_NAMES = EVENT_BEAT_TOOL_SPECS.map((spec) => spec.function.name);
const STORY_DIALOGUE_TOOL_NAMES = STORY_DIALOGUE_TOOL_SPECS.map((spec) => spec.function.name);
const EVENT_BEAT_WRITE_TOOL_NAMES: WorkspaceToolName[] = [
  'set_npc_affinity',
  'add_npc_note',
  'grant_minor_item',
  'update_item_note',
];
const WORKSPACE_WRITE_TOOL_NAMES = WORKSPACE_WRITE_TOOL_SPECS.map((spec) => spec.function.name);

const STORY_REFERENCE_TOOLS: WorkspaceToolName[] = [
  'get_recent_rounds',
  'get_round_record',
  'get_current_state',
  'get_recent_history',
  'get_npc_list',
  'get_active_arcs',
  'get_latest_planning_bundle',
  'get_latest_event_plan',
  'get_latest_outline_mapping',
  'get_latest_stage_judge',
  'get_latest_director_plan',
  'get_active_event_docs',
  ...STORY_DIALOGUE_TOOL_NAMES,
];

const CORE_READ_TOOLS: WorkspaceToolName[] = [
  ...WORKSPACE_READ_TOOL_NAMES,
  'get_npc_list',
  'get_npc_detail',
];

const DIRECTOR_READ_TOOLS: WorkspaceToolName[] = [
  ...WORKSPACE_READ_TOOL_NAMES.filter((name) => name !== 'get_story_briefing'),
  'get_npc_list',
  'get_npc_detail',
];

const MIDDLE_READ_TOOLS: WorkspaceToolName[] = DIRECTOR_READ_TOOLS;

const NO_TOOL_AGENT_KINDS = new Set<WorkspaceAgentKind>([
  'characterPlanner',
  'scenePlanner',
  'eventPlanner',
  'outlineMapper',
  'stageJudge',
  'decision',
  'summary',
  'randomEvent',
  'review',
]);

const AGENT_KIND_LABELS: Record<WorkspaceAgentKind, string> = {
  orchestrator: '回合司辰',
  story: '故事写手',
  director: '叙事导演',
  directorReply: '叙事导演 · 回应询问',
  masterArc: '主弧规划员',
  settingGuard: '设定守护者',
  logicCheck: '逻辑审校员',
  memory: '记忆书吏',
  summary: '摘要书吏',
  decision: '决策记录员',
  randomEvent: '机缘导演',
  eventBeat: '司事',
  stageJudge: '阶段判断员',
  outlineMapper: '大纲映射员',
  characterPlanner: '人物规划员',
  scenePlanner: '场景规划员',
  eventPlanner: '事件规划员',
  review: '旅程评卷人',
  librarian: '司书',
  default: '模型',
};

export interface BuildWorkspaceToolRuntimeOptions {
  agentKind?: WorkspaceAgentKind;
  allowWrite?: boolean;
  includeManifest?: boolean;
  analysisToolHandler?: WorkspaceToolContext['analysisToolHandler'];
}

function uniqueToolNames(names: WorkspaceToolName[]): WorkspaceToolName[] {
  return Array.from(new Set(names));
}

function workspaceToolNamesForAgent(agentKind: WorkspaceAgentKind, allowWrite = false): WorkspaceToolName[] {
  if (NO_TOOL_AGENT_KINDS.has(agentKind)) return [];
  if (agentKind === 'librarian') {
    return uniqueToolNames([
      ...WORKSPACE_READ_TOOL_NAMES,
      ...(allowWrite ? WORKSPACE_WRITE_TOOL_NAMES : []),
    ]);
  }
  if (agentKind === 'orchestrator') return uniqueToolNames([
    ...CORE_READ_TOOLS,
    ...ORCHESTRATOR_ANALYSIS_TOOL_NAMES,
  ]);
  if (agentKind === 'eventBeat') return uniqueToolNames([
    'get_recent_rounds',
    ...EVENT_BEAT_TOOL_NAMES.filter((name) =>
      allowWrite || !EVENT_BEAT_WRITE_TOOL_NAMES.includes(name),
    ),
  ]);
  if (agentKind === 'story') return uniqueToolNames(STORY_REFERENCE_TOOLS);
  if (['director', 'directorReply', 'masterArc', 'settingGuard', 'logicCheck', 'memory'].includes(agentKind)) {
    return uniqueToolNames(MIDDLE_READ_TOOLS);
  }
  return uniqueToolNames(STORY_REFERENCE_TOOLS);
}

function filterToolSpecs(names: WorkspaceToolName[]): ChatTool[] {
  const allowed = new Set(names);
  return WORKSPACE_TOOL_SPECS.filter((spec) => allowed.has(spec.function.name)) as ChatTool[];
}

function buildWorkspaceToolSystemRules(
  agentKind: WorkspaceAgentKind,
  allowedTools: WorkspaceToolName[],
  allowWrite: boolean,
): string | undefined {
  if (!allowedTools.length) return undefined;
  const writeToolNames = [...WORKSPACE_WRITE_TOOL_NAMES, ...EVENT_BEAT_WRITE_TOOL_NAMES];
  const writeTools = allowedTools.filter((name) => writeToolNames.includes(name));
  const readTools = allowedTools.filter((name) => !writeToolNames.includes(name));
  const label = AGENT_KIND_LABELS[agentKind] ?? AGENT_KIND_LABELS.default;
  const has = (name: WorkspaceToolName) => allowedTools.includes(name);
  const ruleLines = [
    '- 先阅读用户消息里的【司书库文件结构】；它是文件 manifest，不是全文。',
    has('read_doc') || has('get_entity_doc')
      ? '- 如果 manifest 中某个文件与当前任务强相关，再调用 read_doc(path) 或 get_entity_doc 读取全文。'
      : undefined,
    has('search_docs')
      ? '- 不确定资料位置时调用 search_docs(query)，不要为了“保险”批量读取全库。'
      : undefined,
    has('get_story_briefing')
      ? '- 需要核对开局、原始大纲、出身、世界书和创建时配置时，优先调用 get_story_briefing；只缺某一项时再调用更细工具。'
      : undefined,
    has('get_latest_planning_bundle') || has('get_latest_director_plan')
      ? '- 需要读取规划层信息时，优先调用 get_latest_planning_bundle 或对应 get_latest_xxx 工具。'
      : undefined,
    has('get_recent_rounds') || has('get_round_record') || has('get_recent_history')
      ? '- 需要核对近期剧情时调用 get_recent_rounds / get_round_record / get_recent_history。'
      : undefined,
    has('ask_director')
      ? '- ask_director 会触发一次独立的叙事导演回应；每回合最多一次，只在当前 brief 不足以写出合格正文时使用。'
      : undefined,
    '- 司书库文件优先级：玩家手写/明确确认 > 近期回合卷宗 > 当前状态 > 专业模型输出 > 旧摘要。',
    '- 文件若标记 stale/archived，只能当历史参考，不能当当前正史。',
    '- 工具调用后仍必须遵守本模型原本的输出协议。',
  ].filter(Boolean).join('\n');
  return `【本回合可用工具】
当前模型：${label}

可读取：
${readTools.map((name) => `- ${name}`).join('\n') || '- 无'}

可写入：
${writeTools.length && allowWrite ? writeTools.map((name) => `- ${name}`).join('\n') : '- 无。当前模型不得修改司书库，只能读取资料并按自己的输出协议返回。'}

工具规则：
${ruleLines}`;
}

export const WORKSPACE_TOOL_SYSTEM_RULES = `【司书库工具规则 / 旧版通用说明】
运行时优先使用按模型生成的【本回合可用工具】说明；本常量仅保留给旧代码兜底。

使用方式：
- 先阅读用户消息里的【司书库文件结构】；它是文件 manifest，不是全文。
- 如果 manifest 中某个文件与当前任务强相关，再调用 read_doc(path) 读取全文。
- 不确定资料位置时调用 search_docs(query)。
- 需要核对近期剧情时调用 get_recent_rounds / get_round_record。
- 需要查看本回合或近期其他模型实际输出时调用 get_current_round_agent_calls / get_recent_agent_calls / get_agent_output。
- 需要核对开局、原始大纲、出身、世界书和创建时配置时，优先调用 get_story_briefing；只缺某一项时调用 get_story_outline / get_initial_scene / get_background / get_world_books。

纪律：
- 只读取与当前任务有关的文件；不要为了“保险”批量读取全库。
- 司书库文件优先级：玩家手写/明确确认 > 近期回合卷宗 > 当前状态 > 专业模型输出 > 旧摘要。
- 文件若标记 stale/archived，只能当历史参考，不能当当前正史。
- 未显式开放写入权限时，不得修改司书库。
- 工具调用后仍必须遵守本模型原本的输出协议。`;

export interface WorkspaceToolRuntime {
  systemRules?: string;
  userManifest?: string;
  tools?: ChatTool[];
  onToolCall?: ChatParams['onToolCall'];
}

function toInt(value: unknown, fallback: number, min = 1, max = 50): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function manifestFilter(items: WorkspaceDocumentManifestItem[], path?: unknown): WorkspaceDocumentManifestItem[] {
  const prefix = typeof path === 'string' && path.trim()
    ? normalizeWorkspacePath(path).replace(/\/?$/, '/')
    : '';
  return items.filter((item) => !prefix || item.path.startsWith(prefix));
}

function recentRounds(rounds: RoundRecord[], n: number): RoundRecord[] {
  return [...rounds]
    .sort((a, b) => b.round - a.round || b.createdAt - a.createdAt)
    .slice(0, n)
    .sort((a, b) => a.round - b.round || a.createdAt - b.createdAt);
}

function recentCalls(calls: AgentCallRecord[], n: number): AgentCallRecord[] {
  return [...calls].sort((a, b) => b.createdAt - a.createdAt).slice(0, n).reverse();
}

function stripHugeInput(call: AgentCallRecord): AgentCallRecord {
  return {
    ...call,
    input: call.input
      ? {
        inputSummary: call.input.inputSummary,
        system: call.input.system?.slice(0, 1200),
        user: call.input.user?.slice(0, 1600),
      }
      : undefined,
  };
}

function clipText(value: unknown, max = 4000): string {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}\n……（已截断）` : text;
}

const WORKSPACE_KINDS: WorkspaceDocumentKind[] = [
  'protagonist',
  'character',
  'relationship',
  'scene',
  'director',
  'world',
  'timeline',
  'foreshadowing',
  'memory',
  'audit',
  'inventory',
  'rule',
  'misc',
];

function normalizeToolKind(value: unknown, fallback: WorkspaceDocumentKind = 'misc'): WorkspaceDocumentKind {
  const kind = String(value ?? '').trim();
  return WORKSPACE_KINDS.includes(kind as WorkspaceDocumentKind)
    ? kind as WorkspaceDocumentKind
    : fallback;
}

function tagsFromTool(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n，、]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = String(item ?? '').trim().slice(0, 24);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 16) break;
  }
  return out;
}

function safePathPart(value: unknown, fallback: string): string {
  return (String(value ?? '').trim() || fallback)
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || fallback;
}

function defaultEntityPath(entityType: string, name: string): string {
  const safe = safePathPart(name, '未命名');
  switch (entityType) {
    case 'character':
      return `characters/${safe}/profile.md`;
    case 'item':
      return `inventory/items/${safe}/item.md`;
    case 'scene':
      return `scenes/${safe}.md`;
    case 'event':
      return `timeline/events/${safe}.md`;
    default:
      return `misc/${safe}.md`;
  }
}

function entityKind(entityType: string): WorkspaceDocumentKind {
  switch (entityType) {
    case 'character': return 'character';
    case 'item': return 'inventory';
    case 'scene': return 'scene';
    case 'event': return 'timeline';
    default: return 'misc';
  }
}

function entityTitle(entityType: string, name: string): string {
  switch (entityType) {
    case 'character': return `${name} · 人物档案`;
    case 'item': return `${name} · 能力档案`;
    case 'scene': return `${name} · 场景档案`;
    case 'event': return `${name} · 事件档案`;
    default: return name;
  }
}

function buildEntityDocContent(p: {
  entityType: string;
  name: string;
  lifecycle?: string;
  content: string;
  round: number;
  extra?: unknown;
}): string {
  const lifecycle = p.lifecycle?.trim() || 'active';
  const usage = (() => {
    switch (p.entityType) {
      case 'character':
        return '记录角色身份、关系、外观、知情范围、近期状态和生命周期。';
      case 'item':
        return '记录能力来源、当前掌握/失效状态、用途和剧情约束。';
      case 'scene':
        return '记录场景地点、时间天气、稳定布置、可用资源和当前状态。';
      case 'event':
        return '记录事件目标、生命周期、完成/失败标准、进度和写作边界。';
      default:
        return '记录当前旅程中的实体状态。';
    }
  })();
  const lines = [
    `# ${p.name}`,
    '',
    '> 司书库文件：本文件只属于当前旅程。模型可按需读取和维护。',
    '',
    `- 用途：${usage}`,
    '- 当前可信度：以玩家输入、最新正文、专业模型输出和本文件最近更新共同核对。',
    '- 更新原则：只把已经成立或明确标注为“计划/猜测/待核对”的内容写入；不要把幕后信息误写成主角已知。',
    `- 实体类型：${p.entityType}`,
    `- 生命周期：${lifecycle}`,
    `- 最近更新回合：第 ${p.round} 回合`,
    '',
    '## 当前状态',
    clipText(p.content, 12000) || '暂无。',
  ];
  if (p.extra !== undefined) {
    lines.push(
      '',
      '## 结构化补充',
      '```json',
      JSON.stringify(p.extra, null, 2),
      '```',
    );
  }
  return lines.join('\n');
}

function workspaceWriteResult(action: string, doc: WorkspaceDocument): unknown {
  return {
    ok: true,
    action,
    id: doc.id,
    path: doc.path,
    title: doc.title,
    kind: doc.kind,
    version: doc.version,
    updatedAtRound: doc.updatedAtRound,
    archived: doc.archived,
    stale: doc.stale,
  };
}

export function resolveWorkspaceSeedResources(save: GameSave): {
  outline?: StoryOutline;
  background?: Background;
  worldBooks: WorldBook[];
} {
  const contentState = useContentStore.getState();
  const outlines = selectAllOutlines(contentState);
  const backgrounds = selectAllBackgrounds(contentState);
  const worldBooks = selectAllWorldBooks(contentState);
  const outline = outlines.find((item) => item.id === save.content.outlineId);
  const background = backgrounds.find((item) => item.id === save.content.backgroundId);
  const selectedWorldBookIds = new Set(save.content.worldBookIds ?? []);
  return {
    outline,
    background,
    worldBooks: worldBooks.filter((item) => selectedWorldBookIds.has(item.id)),
  };
}

function outlineSummary(outline?: StoryOutline): unknown {
  if (!outline) return { error: '当前旅程没有可解析的故事大纲资源；可尝试 read_doc("director/outline.md")。' };
  return {
    id: outline.id,
    title: outline.title,
    synopsis: outline.synopsis,
    acts: outline.acts ?? [],
    tone: outline.tone,
    worldBookIds: outline.worldBookIds ?? [],
  };
}

function backgroundSummary(background?: Background, characterName?: string): unknown {
  if (!background) return { error: '当前旅程没有可解析的出身资源；可尝试 read_doc("protagonist/profile.md")。' };
  return {
    id: background.id,
    characterName: characterName || '主角',
    name: background.name,
    description: background.description,
    traits: background.traits ?? [],
    startItems: background.startItems ?? [],
    startScene: background.startScene,
  };
}

function strictConfigSummary(save: GameSave, includeTemplates = false, round?: number): unknown {
  const config = save.content.authorCustom ?? save.content.strictCustom;
  if (!config?.enabled) {
    return {
      enabled: false,
      source: save.content.authorCustom ? 'authorCustom' : save.content.strictCustom ? 'strictCustom' : 'none',
    };
  }
  const normalized = normalizeStrictCustomConfig(config);
  const result: Record<string, unknown> = {
    enabled: normalized.enabled,
    source: save.content.authorCustom ? 'authorCustom' : 'strictCustom',
    globalPrompt: normalized.globalPrompt,
    pacingPrompt: normalized.pacingPrompt,
    revealPrompt: normalized.revealPrompt,
    choicePrompt: normalized.choicePrompt,
    promptOverrideEnabled: normalized.promptOverrideEnabled,
    targetRound: round !== undefined
      ? Math.max(0, Math.floor(Number(round) || 0))
      : save.state.currentRound + 1,
  };
  if (includeTemplates) {
    result.storySystemPrompt = clipText(normalized.storySystemPrompt, 12000);
    result.storyUserPrompt = clipText(normalized.storyUserPrompt, 8000);
    result.decisionSystemPrompt = clipText(normalized.decisionSystemPrompt, 12000);
    result.decisionUserPrompt = clipText(normalized.decisionUserPrompt, 8000);
  } else {
    result.templates = {
      storySystemPromptChars: normalized.storySystemPrompt.length,
      storyUserPromptChars: normalized.storyUserPrompt.length,
      decisionSystemPromptChars: normalized.decisionSystemPrompt.length,
      decisionUserPromptChars: normalized.decisionUserPrompt.length,
      note: '模板正文默认不返回；如确需核对提示词覆盖内容，重新调用 includeTemplates=true。',
    };
  }
  return result;
}

function compactWorldBooks(books: WorldBook[], includeEntries = false): unknown {
  return books.map((book) => ({
    id: book.id,
    name: book.name,
    description: book.description,
    entryCount: book.entries?.length ?? 0,
    entries: includeEntries
      ? (book.entries ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        keywords: entry.keywords ?? [],
        alwaysActive: !!entry.alwaysActive,
        priority: entry.priority ?? 0,
        content: clipText(entry.content, 2000),
      }))
      : (book.entries ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        keywords: entry.keywords ?? [],
        alwaysActive: !!entry.alwaysActive,
        priority: entry.priority ?? 0,
        contentPreview: clipText(entry.content, 220),
      })),
  }));
}

function recentHistoryFromSave(save: GameSave, n: number): unknown {
  return (save.state.history ?? [])
    .slice(-n)
    .map((msg) => ({
      role: msg.role,
      round: msg.round,
      content: clipText(msg.content, 2000),
      hasThinking: !!msg.thinking?.trim(),
    }));
}

type PlanningStateKey =
  | 'characterPlan'
  | 'scenePlan'
  | 'eventPlan'
  | 'eventBeat'
  | 'outlineMapping'
  | 'stageJudge'
  | 'directorPlan';

const PLANNING_DOC_BY_KEY: Record<PlanningStateKey, string> = {
  characterPlan: 'planning/latest/character-plan.json',
  scenePlan: 'planning/latest/scene-plan.json',
  eventPlan: 'planning/latest/event-plan.json',
  eventBeat: 'planning/latest/event-beat.json',
  outlineMapping: 'planning/latest/outline-mapping.json',
  stageJudge: 'planning/latest/stage-judge.json',
  directorPlan: 'planning/latest/director-plan.json',
};

async function getPlanningDoc(saveId: string, key: PlanningStateKey): Promise<WorkspaceDocument | undefined> {
  return getWorkspaceDocumentByPath(saveId, PLANNING_DOC_BY_KEY[key]);
}

async function latestPlanningEntry(save: GameSave, key: PlanningStateKey): Promise<unknown> {
  const stateValue = (() => {
    switch (key) {
      case 'characterPlan': return save.state.authorNarrative?.characterPlan;
      case 'scenePlan': return save.state.authorNarrative?.scenePlan;
      case 'eventPlan': return save.state.authorNarrative?.eventPlan;
      case 'eventBeat': return save.state.authorNarrative?.eventBeat;
      case 'outlineMapping': return save.state.authorNarrative?.outlineMapping;
      case 'stageJudge': return save.state.authorNarrative?.stageJudge;
      case 'directorPlan': return save.state.authorNarrative?.plan;
      default: return undefined;
    }
  })();
  return {
    key,
    state: stateValue ?? null,
    workspaceDoc: await getPlanningDoc(save.id, key) ?? null,
  };
}

async function latestPlanningBundle(save: GameSave): Promise<unknown> {
  const [
    outlineMapping,
    stageJudge,
    characterPlan,
    scenePlan,
    eventPlan,
    eventBeat,
    directorPlan,
  ] = await Promise.all([
    latestPlanningEntry(save, 'outlineMapping'),
    latestPlanningEntry(save, 'stageJudge'),
    latestPlanningEntry(save, 'characterPlan'),
    latestPlanningEntry(save, 'scenePlan'),
    latestPlanningEntry(save, 'eventPlan'),
    latestPlanningEntry(save, 'eventBeat'),
    latestPlanningEntry(save, 'directorPlan'),
  ]);
  return {
    currentRound: save.state.currentRound,
    masterArc: save.state.authorNarrative?.masterArc ?? null,
    outlineMapping,
    stageJudge,
    characterPlan,
    scenePlan,
    eventPlan,
    eventBeat,
    directorPlan,
    activeEvents: {
      pendingEvent: save.state.authorRandomEventState?.pendingEvent,
      activeEvents: save.state.authorRandomEventState?.activeEvents ?? [],
      activeArcs: save.state.authorNarrative?.activeArcs ?? [],
    },
  };
}

async function getActiveEventDocs(save: GameSave): Promise<unknown> {
  const docs = await getWorkspaceDocuments(save.id);
  const activeEventsDoc = await getWorkspaceDocumentByPath(save.id, 'timeline/active-events.md');
  const eventDocs = docs
    .filter((doc) => !doc.archived)
    .filter((doc) => doc.kind === 'timeline' || doc.path.startsWith('timeline/events/'))
    .slice(0, 12);
  return {
    state: {
      pendingEvent: save.state.authorRandomEventState?.pendingEvent,
      activeEvents: save.state.authorRandomEventState?.activeEvents ?? [],
      completedEvents: save.state.authorRandomEventState?.completedEvents ?? [],
      activeArcs: save.state.authorNarrative?.activeArcs ?? [],
    },
    activeEventsDoc: activeEventsDoc ?? null,
    eventDocs,
  };
}

function freshSave(save: GameSave): GameSave {
  return useGameStore.getState().saves[save.id] ?? save;
}

function findExistingNpc(save: GameSave, args: Record<string, unknown>) {
  const npcId = String(args.npcId ?? args.id ?? '').trim();
  const name = String(args.name ?? args.npcName ?? '').trim();
  const npcs = save.state.npcs ?? [];
  return npcs.find((npc) => npcId && npc.id === npcId)
    ?? npcs.find((npc) => name && npc.name === name);
}

function compactNpcList(save: GameSave): unknown {
  return (save.state.npcs ?? []).map((npc) => ({
    id: npc.id,
    name: npc.name,
    role: npc.role,
    description: clipText(npc.description, 240) || undefined,
    affinity: npc.affinity,
    recentNote: npc.recentNote,
    details: (npc.details ?? []).slice(-6),
    firstRound: npc.firstRound,
    lastRound: npc.lastRound,
    appearances: npc.appearances,
  }));
}

function eventBeatRound(save: GameSave): number {
  return Math.max(0, Math.floor(Number(save.state.currentRound) || 0));
}

function updateBackpackByTool(save: GameSave, updater: (items: Item[]) => Item[]): GameSave {
  const current = freshSave(save);
  const nextBackpack = updater([...(current.state.backpack ?? [])]);
  useGameStore.getState().updateStateOf(current.id, {
    backpack: nextBackpack,
    needsDiscard: Math.max(0, nextBackpack.length - Math.max(1, current.config.itemCapacity ?? 8)),
  });
  return freshSave(current);
}

function itemToolResult(save: GameSave, item: Item | undefined, action: string): unknown {
  if (!item) return { error: '未找到目标能力/物品。' };
  return {
    ok: true,
    action,
    item: {
      id: item.id,
      name: item.name,
      type: item.type,
      acquiredAtRound: item.acquiredAtRound,
      description: clipText(item.description, 800),
    },
    backpackSize: save.state.backpack?.length ?? 0,
  };
}

async function getEntityDocFromArgs(save: GameSave, args: Record<string, unknown>): Promise<unknown> {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  if (rawPath) {
    const path = normalizeWorkspacePath(rawPath);
    return await getWorkspaceDocumentByPath(save.id, path) ?? { error: `未找到司书库文件：${path}` };
  }
  const rawType = String(args.entityType ?? '').trim();
  const entityType = ['character', 'item', 'scene', 'event'].includes(rawType) ? rawType : '';
  const name = String(args.name ?? '').trim();
  if (!name) return { error: 'get_entity_doc 需要 name 或 path。' };
  const candidates = entityType
    ? [normalizeWorkspacePath(defaultEntityPath(entityType, name))]
    : [
      normalizeWorkspacePath(defaultEntityPath('character', name)),
      normalizeWorkspacePath(defaultEntityPath('item', name)),
      normalizeWorkspacePath(defaultEntityPath('scene', name)),
      normalizeWorkspacePath(defaultEntityPath('event', name)),
    ];
  for (const path of candidates) {
    const doc = await getWorkspaceDocumentByPath(save.id, path);
    if (doc) return doc;
  }
  const found = await searchWorkspaceDocuments(save.id, name, 6);
  return found.length
    ? { candidatesTried: candidates, matches: found }
    : { error: `未找到实体档案：${entityType ? `${entityType}/` : ''}${name}`, candidatesTried: candidates };
}

export async function executeWorkspaceTool(
  name: WorkspaceToolName,
  rawArgs: Record<string, unknown> | undefined,
  ctx: WorkspaceToolContext,
): Promise<unknown> {
  const args = rawArgs ?? {};
  if (ctx.allowedTools && !ctx.allowedTools.has(name)) {
    return {
      error: `当前模型无权调用工具：${name}`,
      agentKind: ctx.agentKind ?? 'default',
    };
  }
  const save = freshSave(ctx.save);
  const resources = resolveWorkspaceSeedResources(save);
  switch (name) {
    case 'list_docs':
      return manifestFilter(await getWorkspaceManifest(save.id), args.path);
    case 'read_doc': {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const doc = await getWorkspaceDocumentByPath(save.id, path);
      if (!doc) return { error: `未找到司书库文件：${path}` };
      return doc;
    }
    case 'search_docs':
      return searchWorkspaceDocuments(save.id, String(args.query ?? ''), toInt(args.limit, 8, 1, 20));
    case 'get_entity_doc':
      return getEntityDocFromArgs(save, args);
    case 'get_recent_rounds': {
      const rounds = await getRounds(save.id);
      return recentRounds(rounds, toInt(args.n, 3, 1, 12));
    }
    case 'get_round_record': {
      const round = Math.max(0, Math.floor(Number(args.round) || 0));
      const rounds = await getRounds(save.id);
      return rounds.find((item) => item.round === round) ?? { error: `未找到第 ${round} 回合。` };
    }
    case 'get_current_round_agent_calls': {
      const calls = await getAgentCalls(save.id);
      return calls.filter((call) => call.round === save.state.currentRound).map(stripHugeInput);
    }
    case 'get_recent_agent_calls': {
      const calls = await getAgentCalls(save.id);
      return recentCalls(calls, toInt(args.n, 8, 1, 30)).map(stripHugeInput);
    }
    case 'get_agent_output': {
      const callId = String(args.callId ?? '').trim();
      const call = (await getAgentCalls(save.id)).find((item) => item.id === callId);
      if (!call) return { error: `未找到模型调用：${callId}` };
      return {
        id: call.id,
        round: call.round,
        kind: call.kind,
        label: call.label,
        thinking: call.thinking,
        output: call.output,
        usage: call.usage,
        cacheHit: call.cacheHit,
        createdAt: call.createdAt,
      };
    }
    case 'get_current_state':
      return {
        saveId: save.id,
        saveName: save.name,
        mode: save.content.mode ?? 'adventure',
        currentRound: save.state.currentRound,
        phase: save.state.phase,
        currentScene: save.state.currentScene,
        availableScenes: save.state.availableScenes,
        lastPlayerInput: save.state.lastPlayerInput,
        longTermMemory: save.state.longTermMemory,
        summary: save.state.summary,
        npcs: save.state.npcs,
        backpack: save.state.backpack,
        anchors: save.state.anchors,
      };
    case 'get_recent_history':
      return recentHistoryFromSave(save, toInt(args.n, 8, 1, 30));
    case 'get_story_outline':
      return resources.outline
        ? outlineSummary(resources.outline)
        : (await getWorkspaceDocumentByPath(save.id, 'director/outline.md'))
          ?? { error: '当前旅程没有可解析的故事大纲资源，也没有 director/outline.md。' };
    case 'get_initial_scene':
      return {
        outline: resources.outline ? { id: resources.outline.id, title: resources.outline.title } : undefined,
        background: resources.background ? { id: resources.background.id, name: resources.background.name } : undefined,
        characterName: save.content.characterName || '主角',
        startScene: resources.background?.startScene
          ?? (await getWorkspaceDocumentByPath(save.id, 'protagonist/profile.md'))?.content
          ?? '未找到开局文本。',
      };
    case 'get_background':
      return resources.background
        ? backgroundSummary(resources.background, save.content.characterName)
        : (await getWorkspaceDocumentByPath(save.id, 'protagonist/profile.md'))
          ?? { error: '当前旅程没有可解析的出身资源，也没有 protagonist/profile.md。' };
    case 'get_world_books':
      return compactWorldBooks(resources.worldBooks, args.includeEntries === true);
    case 'get_journey_content':
      return {
        mode: save.content.mode ?? 'adventure',
        outlineId: save.content.outlineId,
        backgroundId: save.content.backgroundId,
        worldBookIds: save.content.worldBookIds ?? [],
        eventIds: save.content.eventIds ?? [],
        characterName: save.content.characterName,
        authorRandomEvent: save.content.authorRandomEvent
          ? {
            mode: save.content.authorRandomEvent.mode,
            poolEventIds: save.content.authorRandomEvent.poolEventIds,
            dynamic: save.content.authorRandomEvent.dynamic,
          }
          : undefined,
        authorDirector: save.content.authorDirector,
        authorLogicCheck: save.content.authorLogicCheck,
        authorMasterArc: save.content.authorMasterArc,
        authorStageJudge: save.content.authorStageJudge,
        authorSettingGuard: save.content.authorSettingGuard,
        authorOrchestrator: save.content.authorOrchestrator,
        authorEventBeat: save.content.authorEventBeat,
        strictCustom: save.content.strictCustom
          ? {
            enabled: save.content.strictCustom.enabled,
            promptOverrideEnabled: save.content.strictCustom.promptOverrideEnabled,
          }
          : undefined,
        authorCustom: save.content.authorCustom
          ? {
            enabled: save.content.authorCustom.enabled,
            promptOverrideEnabled: save.content.authorCustom.promptOverrideEnabled,
          }
          : undefined,
      };
    case 'get_author_custom_config':
      return strictConfigSummary(
        save,
        args.includeTemplates === true,
        args.round === undefined ? undefined : Number(args.round),
      );
    case 'get_story_style':
      return save.content.storyStyle ?? { error: '当前旅程没有固化故事风格设置。' };
    case 'get_story_briefing': {
      const targetRound = args.round === undefined
        ? save.state.currentRound + 1
        : Math.max(0, Math.floor(Number(args.round) || 0));
      return {
        currentRound: save.state.currentRound,
        targetRound,
        mode: save.content.mode ?? 'adventure',
        characterName: save.content.characterName || '主角',
        outline: resources.outline
          ? outlineSummary(resources.outline)
          : (await getWorkspaceDocumentByPath(save.id, 'director/outline.md'))
            ?? { error: '未找到完整故事大纲资源；可继续 search_docs("大纲")。' },
        background: resources.background
          ? backgroundSummary(resources.background, save.content.characterName)
          : (await getWorkspaceDocumentByPath(save.id, 'protagonist/profile.md'))
            ?? { error: '未找到出身资源；可继续 search_docs("出身")。' },
        initialScene: resources.background?.startScene
          ?? (await getWorkspaceDocumentByPath(save.id, 'director/opening.md'))?.content
          ?? undefined,
        customRules: strictConfigSummary(save, false, targetRound),
        storyStyle: save.content.storyStyle,
        worldBooks: compactWorldBooks(resources.worldBooks, false),
        currentScene: save.state.currentScene,
        summary: clipText(save.state.summary, 2200),
        longTermMemory: clipText(save.state.longTermMemory, 2600),
        masterArc: save.state.authorNarrative?.masterArc,
        outlineMapping: save.state.authorNarrative?.outlineMapping,
        characterPlan: save.state.authorNarrative?.characterPlan,
        scenePlan: save.state.authorNarrative?.scenePlan,
        eventPlan: save.state.authorNarrative?.eventPlan,
        eventBeat: save.state.authorNarrative?.eventBeat,
        stageJudge: save.state.authorNarrative?.stageJudge,
        directorPlan: save.state.authorNarrative?.plan,
        settingGuard: save.state.authorNarrative?.settingGuard,
        activeEvents: {
          pendingEvent: save.state.authorRandomEventState?.pendingEvent,
          activeEvents: save.state.authorRandomEventState?.activeEvents ?? [],
          activeArcs: save.state.authorNarrative?.activeArcs ?? [],
        },
      };
    }
    case 'get_master_arc':
      return save.state.authorNarrative?.masterArc ?? { error: '当前旅程没有主弧。' };
    case 'get_director_plan':
      return save.state.authorNarrative?.plan ?? { error: '当前旅程没有叙事导演计划。' };
    case 'get_active_events':
      return {
        pendingEvent: save.state.authorRandomEventState?.pendingEvent,
        activeEvents: save.state.authorRandomEventState?.activeEvents ?? [],
        completedEvents: save.state.authorRandomEventState?.completedEvents ?? [],
        activeArcs: save.state.authorNarrative?.activeArcs ?? [],
      };
    case 'get_active_arcs': {
      const current = freshSave(save);
      return {
        currentRound: current.state.currentRound,
        activeArcs: current.state.authorNarrative?.activeArcs ?? [],
        completedArcs: (current.state.authorNarrative?.completedArcs ?? []).slice(-8),
        eventBeat: current.state.authorNarrative?.eventBeat ?? null,
      };
    }
    case 'get_npc_list':
      return compactNpcList(freshSave(save));
    case 'get_npc_detail': {
      const current = freshSave(save);
      const npc = findExistingNpc(current, args);
      return npc ?? { error: '未找到该 NPC；司事工具不会创建新 NPC。' };
    }
    case 'get_latest_planning_bundle':
      return latestPlanningBundle(save);
    case 'get_latest_character_plan':
      return latestPlanningEntry(save, 'characterPlan');
    case 'get_latest_scene_plan':
      return latestPlanningEntry(save, 'scenePlan');
    case 'get_latest_event_plan':
      return latestPlanningEntry(save, 'eventPlan');
    case 'get_latest_outline_mapping':
      return latestPlanningEntry(save, 'outlineMapping');
    case 'get_latest_stage_judge':
      return latestPlanningEntry(save, 'stageJudge');
    case 'get_latest_director_plan':
      return latestPlanningEntry(save, 'directorPlan');
    case 'get_active_event_docs':
      return getActiveEventDocs(save);
    case 'run_character_analysis':
    case 'run_scene_analysis':
    case 'run_event_analysis':
      return ctx.analysisToolHandler
        ? ctx.analysisToolHandler(name, args, ctx)
        : { error: `当前运行时没有配置分析工具执行器：${name}` };
    case 'set_npc_affinity': {
      const current = freshSave(save);
      const npc = findExistingNpc(current, args);
      if (!npc) return { error: '未找到该 NPC；set_npc_affinity 禁止创建新 NPC。' };
      const rawDelta = Number(args.delta);
      if (!Number.isFinite(rawDelta)) return { error: 'set_npc_affinity 需要有效 delta。' };
      const delta = clamp(Math.round(rawDelta), -30, 30);
      const reason = clipText(args.reason, 160);
      if (!reason) return { error: 'set_npc_affinity 需要 reason，并会写入 NPC.recentNote。' };
      const update: NpcUpdateRaw = {
        id: npc.id,
        name: npc.name,
        action: 'update',
        affinityDelta: delta,
        note: reason,
      };
      useGameStore.getState().applyNpcUpdates(current.id, [update], eventBeatRound(current));
      const fresh = freshSave(current);
      const updated = fresh.state.npcs.find((item) => item.id === npc.id);
      return {
        ok: true,
        npcId: npc.id,
        name: npc.name,
        requestedDelta: rawDelta,
        appliedDelta: delta,
        beforeAffinity: npc.affinity,
        afterAffinity: updated?.affinity,
        recentNote: updated?.recentNote,
      };
    }
    case 'add_npc_note': {
      const current = freshSave(save);
      const npc = findExistingNpc(current, args);
      if (!npc) return { error: '未找到该 NPC；add_npc_note 禁止创建新 NPC。' };
      const note = clipText(args.note, 180);
      if (!note) return { error: 'add_npc_note 需要 note。' };
      const details = args.appendToDetails === true ? [note] : undefined;
      const update: NpcUpdateRaw = {
        id: npc.id,
        name: npc.name,
        action: 'update',
        note,
        details,
      };
      useGameStore.getState().applyNpcUpdates(current.id, [update], eventBeatRound(current));
      const fresh = freshSave(current);
      const updated = fresh.state.npcs.find((item) => item.id === npc.id);
      return {
        ok: true,
        npcId: npc.id,
        name: npc.name,
        recentNote: updated?.recentNote,
        details: updated?.details,
      };
    }
    case 'grant_minor_item': {
      const current = freshSave(save);
      const nameText = clipText(args.name, 60);
      const category = String(args.category ?? '').trim();
      if (!nameText) return { error: 'grant_minor_item 需要 name。' };
      if (!['minor_ability', 'memento', 'note'].includes(category)) {
        return { error: 'grant_minor_item 的 category 只能是 minor_ability / memento / note，禁止 main_ability。' };
      }
      const descRaw = clipText(args.description, 500);
      if (!descRaw) return { error: 'grant_minor_item 需要 description，且必须明示“事件得来”。' };
      const description = descRaw.includes('事件得来')
        ? descRaw
        : `${descRaw}\n（事件得来：由当前事件弧结算获得。）`;
      let created: Item | undefined;
      const fresh = updateBackpackByTool(current, (items) => {
        const existing = items.find((item) => item.name === nameText);
        if (existing) {
          const note = `事件得来备注：${description}`;
          created = {
            ...existing,
            description: existing.description.includes(note)
              ? existing.description
              : `${existing.description}\n${note}`.trim(),
          };
          return items.map((item) => item.id === existing.id ? created! : item);
        }
        created = {
          id: genId('item'),
          name: nameText,
          description,
          type: 'reusable',
          acquiredAtRound: eventBeatRound(current),
        };
        return [...items, created];
      });
      return itemToolResult(fresh, created, 'grant_minor_item');
    }
    case 'update_item_note': {
      const current = freshSave(save);
      const itemId = String(args.itemId ?? args.id ?? '').trim();
      const nameText = String(args.name ?? '').trim();
      const note = clipText(args.note, 220);
      if (!itemId && !nameText) return { error: 'update_item_note 需要 itemId 或 name。' };
      if (!note) return { error: 'update_item_note 需要 note。' };
      let updated: Item | undefined;
      const fresh = updateBackpackByTool(current, (items) => items.map((item) => {
        const hit = (itemId && item.id === itemId) || (nameText && item.name === nameText);
        if (!hit) return item;
        const line = `事件备注：${note}`;
        updated = {
          ...item,
          description: item.description.includes(line)
            ? item.description
            : `${item.description}\n${line}`.trim(),
        };
        return updated;
      }));
      return itemToolResult(fresh, updated, 'update_item_note');
    }
    case 'write_doc': {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const existing = await getWorkspaceDocumentByPath(save.id, path);
      if (args.createOnly === true && existing) {
        return { error: `文件已存在，createOnly=true：${path}` };
      }
      const doc = await createWorkspaceDocument({
        saveId: save.id,
        path,
        title: typeof args.title === 'string' ? args.title : undefined,
        kind: normalizeToolKind(args.kind, existing?.kind ?? 'misc'),
        content: clipText(args.content, 50000),
        summary: typeof args.summary === 'string' ? clipText(args.summary, 500) : undefined,
        tags: tagsFromTool(args.tags),
        updatedAtRound: save.state.currentRound,
        updatedBy: 'tool',
        provenance: {
          round: save.state.currentRound,
          note: 'workspace tool: write_doc',
        },
      });
      return workspaceWriteResult(existing ? 'updated' : 'created', doc);
    }
    case 'patch_doc': {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const existing = await getWorkspaceDocumentByPath(save.id, path);
      if (!existing) return { error: `未找到司书库文件：${path}` };
      const doc = await patchWorkspaceDocument(existing.id, {
        title: typeof args.title === 'string' ? args.title : undefined,
        kind: args.kind === undefined ? undefined : normalizeToolKind(args.kind, existing.kind),
        content: args.content === undefined ? undefined : clipText(args.content, 50000),
        summary: args.summary === undefined ? undefined : clipText(args.summary, 500),
        tags: args.tags === undefined ? undefined : tagsFromTool(args.tags),
        archived: typeof args.archived === 'boolean' ? args.archived : undefined,
        stale: typeof args.stale === 'boolean' ? args.stale : undefined,
        updatedAtRound: save.state.currentRound,
        updatedBy: 'tool',
        provenance: {
          ...(existing.provenance ?? {}),
          round: save.state.currentRound,
          note: 'workspace tool: patch_doc',
        },
      });
      return doc ? workspaceWriteResult('patched', doc) : { error: `更新失败：${path}` };
    }
    case 'append_doc': {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const existing = await getWorkspaceDocumentByPath(save.id, path);
      const heading = String(args.heading ?? `第 ${save.state.currentRound} 回合更新`).trim();
      const appendContent = clipText(args.content, 20000);
      const nextContent = existing
        ? `${existing.content.trim()}\n\n## ${heading || `第 ${save.state.currentRound} 回合更新`}\n${appendContent}`.trim()
        : [
          `# ${typeof args.title === 'string' && args.title.trim() ? args.title.trim() : path.split('/').pop()?.replace(/\.[^.]+$/, '') || '新文件'}`,
          '',
          '> 司书库文件：本文件只属于当前旅程。模型可按需读取和维护。',
          '',
          `## ${heading || `第 ${save.state.currentRound} 回合更新`}`,
          appendContent,
        ].join('\n');
      const doc = await createWorkspaceDocument({
        saveId: save.id,
        path,
        title: typeof args.title === 'string' ? args.title : existing?.title,
        kind: normalizeToolKind(args.kind, existing?.kind ?? 'misc'),
        content: nextContent,
        summary: typeof args.summary === 'string' ? clipText(args.summary, 500) : existing?.summary,
        tags: args.tags === undefined ? existing?.tags : tagsFromTool(args.tags),
        updatedAtRound: save.state.currentRound,
        updatedBy: 'tool',
        provenance: {
          round: save.state.currentRound,
          note: 'workspace tool: append_doc',
        },
      });
      return workspaceWriteResult(existing ? 'appended' : 'created', doc);
    }
    case 'archive_doc': {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const existing = await getWorkspaceDocumentByPath(save.id, path);
      if (!existing) return { error: `未找到司书库文件：${path}` };
      const reason = String(args.reason ?? '').trim();
      const content = reason
        ? `${existing.content.trim()}\n\n## 第 ${save.state.currentRound} 回合归档说明\n${reason}`.trim()
        : existing.content;
      const doc = await patchWorkspaceDocument(existing.id, {
        content,
        archived: args.archived === undefined ? true : args.archived === true,
        stale: args.stale === true,
        updatedAtRound: save.state.currentRound,
        updatedBy: 'tool',
        provenance: {
          ...(existing.provenance ?? {}),
          round: save.state.currentRound,
          note: 'workspace tool: archive_doc',
        },
      });
      return doc ? workspaceWriteResult('archived', doc) : { error: `归档失败：${path}` };
    }
    case 'write_entity_doc': {
      const rawType = String(args.entityType ?? '').trim();
      const entityType = ['character', 'item', 'scene', 'event'].includes(rawType) ? rawType : 'misc';
      const name = String(args.name ?? '').trim();
      if (!name) return { error: 'write_entity_doc 需要 name。' };
      const path = normalizeWorkspacePath(String(args.path ?? defaultEntityPath(entityType, name)));
      const existing = await getWorkspaceDocumentByPath(save.id, path);
      const lifecycle = typeof args.lifecycle === 'string' ? args.lifecycle.trim() : undefined;
      const content = buildEntityDocContent({
        entityType,
        name,
        lifecycle,
        content: String(args.content ?? ''),
        round: save.state.currentRound,
        extra: args.extra,
      });
      const tags = [
        entityType === 'item' ? '能力' : entityType === 'event' ? '事件' : entityType === 'scene' ? '场景' : entityType === 'character' ? '角色' : '实体',
        lifecycle,
        ...tagsFromTool(args.tags),
      ].filter(Boolean) as string[];
      const mode = String(args.mode ?? 'replace').trim();
      const nextContent = existing && mode === 'append'
        ? `${existing.content.trim()}\n\n## 第 ${save.state.currentRound} 回合更新\n${clipText(args.content, 12000)}`.trim()
        : content;
      const doc = await createWorkspaceDocument({
        saveId: save.id,
        path,
        title: typeof args.title === 'string' ? args.title : entityTitle(entityType, name),
        kind: entityKind(entityType),
        content: nextContent,
        summary: typeof args.summary === 'string'
          ? clipText(args.summary, 500)
          : `${name} 的${entityType === 'item' ? '能力' : entityType === 'event' ? '事件' : entityType === 'scene' ? '场景' : '人物'}档案。`,
        tags,
        updatedAtRound: save.state.currentRound,
        updatedBy: 'tool',
        provenance: {
          round: save.state.currentRound,
          note: `workspace tool: write_entity_doc/${entityType}`,
        },
      });
      return workspaceWriteResult(existing ? (mode === 'append' ? 'appended' : 'updated') : 'created', doc);
    }
    default:
      return { error: `未知工具：${name}` };
  }
}

export async function buildWorkspaceToolRuntime(
  save: GameSave | undefined,
  options: BuildWorkspaceToolRuntimeOptions = {},
): Promise<WorkspaceToolRuntime> {
  if (!save) return {};
  const agentKind = options.agentKind ?? 'default';
  const allowedToolNames = workspaceToolNamesForAgent(agentKind, options.allowWrite === true);
  if (!allowedToolNames.length && options.includeManifest !== true) return {};

  await seedWorkspaceDocumentsFromSave(save, resolveWorkspaceSeedResources(save), { refreshSeeded: true }).catch((err) => {
    console.warn('[workspaceTools] seed runtime workspace failed', err);
  });
  const manifest = await getWorkspaceManifest(save.id).catch((err) => {
    console.warn('[workspaceTools] manifest failed', err);
    return [] as WorkspaceDocumentManifestItem[];
  });
  const allowedTools = new Set(allowedToolNames);
  return {
    systemRules: buildWorkspaceToolSystemRules(agentKind, allowedToolNames, options.allowWrite === true),
    userManifest: buildWorkspaceToolManifestPrompt(manifest),
    tools: filterToolSpecs(allowedToolNames),
    onToolCall: async (call) => executeWorkspaceTool(
      call.name as WorkspaceToolName,
      call.arguments,
      { save, agentKind, allowedTools, analysisToolHandler: options.analysisToolHandler },
    ),
  };
}

export function appendWorkspaceManifest(
  user: string,
  manifest: string | undefined,
  canUseTools = true,
  canWrite = false,
): string {
  if (!manifest?.trim()) return user;
  return [
    user,
    '',
    '【司书库文件结构】',
    canUseTools && canWrite
      ? '以下是当前旅程实时文件库的 manifest。它只列路径、类型、摘要和版本；需要全文时请调用 read_doc(path)，需要搜索时请调用 search_docs(query)；若本模型职责允许沉淀资料，可使用写入工具。'
      : canUseTools
        ? '以下是当前旅程实时文件库的 manifest。它只列路径、类型、摘要和版本；需要更多资料时请根据系统提示列出的可用工具调用对应工具；若 read_doc / search_docs / get_entity_doc 不在可用工具内，不要调用它们。当前模型没有司书库写入权限。'
        : '以下是当前旅程实时文件库的 manifest。它只列路径、类型、摘要和版本；当前调用只提供结构摘要，请按相关文件摘要保持设定与连续性。',
    manifest.trim(),
  ].join('\n');
}

export function appendWorkspaceSystem(system: string, rules: string | undefined): string {
  return rules?.trim() ? `${system.trim()}\n\n${rules.trim()}` : system;
}

export function buildWorkspaceToolManifestPrompt(docs: WorkspaceDocumentManifestItem[]): string {
  if (!docs.length) return '司书库当前为空。';
  return docs
    .filter((doc) => !doc.archived)
    .map((doc) => [
      `- ${doc.path}`,
      `  - title: ${doc.title}`,
      `  - kind: ${doc.kind}`,
      doc.summary ? `  - summary: ${doc.summary}` : undefined,
      doc.tags?.length ? `  - tags: ${doc.tags.join(' / ')}` : undefined,
      `  - updatedAtRound: ${doc.updatedAtRound}`,
      `  - version: ${doc.version}`,
    ].filter(Boolean).join('\n'))
    .join('\n');
}

export function clipWorkspaceDocsForPrompt(docs: WorkspaceDocument[], maxChars = 6000): string {
  const chunks: string[] = [];
  let used = 0;
  for (const doc of docs) {
    const chunk = [
      `## ${doc.path}`,
      `kind: ${doc.kind}`,
      doc.summary ? `summary: ${doc.summary}` : undefined,
      '',
      doc.content,
    ].filter((x) => x !== undefined).join('\n');
    if (used + chunk.length > maxChars) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join('\n\n---\n\n');
}
