import React, { useRef, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { Upload, AlertCircle, Archive } from 'lucide-react';
import { useContentStore } from '@/store/useContentStore';
import type { ImportBundle } from '@/types/content';
import { parseLedgerJourneyZip } from '@/lib/ledgerJourneyPackage';
import { genId } from '@/lib/utils';
import { workspaceTemplateFromDocuments } from '@/lib/workspaceTemplates';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

const SAMPLE = `{
  "worldBooks": [
    {
      "id": "wb_campus_secret",
      "name": "错位青春 · 世界书",
      "description": "只保存会长期影响故事的硬设定；临时场景细节更适合写入旅程内的司书库。",
      "entries": [
        {
          "id": "wbe_campus_base",
          "name": "世界基调",
          "keywords": [],
          "alwaysActive": true,
          "priority": 100,
          "content": "故事发生在现代校园。超常能力存在但不公开，叙事应优先保持日常真实感，再逐步揭示异常。"
        },
        {
          "id": "wbe_ability",
          "name": "错位能力",
          "keywords": ["异能", "错位", "女厕", "能力觉醒"],
          "alwaysActive": false,
          "priority": 80,
          "content": "主角的能力与一次尴尬且危险的开局事件有关。回忆或补写该事件时，需要谨慎参考大纲与开局文本，不要随意改写起因。"
        }
      ]
    }
  ],
  "outlines": [
    {
      "id": "outline_campus_love",
      "title": "错位青春",
      "synopsis": "主角在校园误入危机并觉醒能力，随后在隐藏秘密、修复关系与恋爱情节中逐渐接近真相。",
      "acts": [
        "第一幕：开局危机与能力觉醒，主角脱险但留下误会和线索。",
        "第二幕：日常关系推进，能力带来便利也制造新的风险。",
        "第三幕：秘密逼近公开边缘，主角需要在感情、真相与自我选择间收束。"
      ],
      "tone": "校园恋爱、细腻心理、轻悬疑，重视上下文承接。",
      "worldBookIds": ["wb_campus_secret"],
      "coverEmoji": "🌸"
    }
  ],
  "backgrounds": [
    {
      "id": "bg_transfer_student",
      "name": "普通转校生",
      "description": "看似普通的高中生，社交谨慎，习惯先观察再行动。",
      "traits": ["谨慎", "观察力", "容易卷入误会"],
      "startItems": ["学生证", "旧手机"],
      "startScene": "开学第一天，主角在陌生校舍里迷路。走廊尽头传来脚步声，错误的门牌、慌乱的心跳和即将撞见的人，让一切从尴尬的危机开始。",
      "coverEmoji": "🎒"
    }
  ],
  "events": [
    {
      "id": "ev_after_school_invite",
      "name": "放学邀约",
      "directive": "结合最近关系进展，让某位与主角关系升温的角色主动发出放学后的邀约。事件应服务当前主线，不要凭空打断正在进行的危机。",
      "probability": 0.12,
      "minRound": 4,
      "cooldown": 8,
      "once": false,
      "tags": ["恋爱", "校园", "关系推进"]
    }
  ],
  "workspaceTemplates": [
    {
      "id": "wst_campus_cast",
      "name": "错位青春 · 角色与场景模板",
      "description": "启程时可勾选，导入后会写入当前旅程自己的司书库；不会污染其他旅程。",
      "outlineIds": ["outline_campus_love"],
      "worldBookIds": ["wb_campus_secret"],
      "tags": ["校园", "角色预设", "司书库"],
      "docs": [
        {
          "path": "characters/小晴/profile.md",
          "title": "小晴 · 人物档案",
          "kind": "character",
          "summary": "主角的高中初恋，关系微妙，需要以主角已知视角维护。",
          "tags": ["角色", "恋爱对象", "高中初恋"],
          "content": "# 小晴\\n\\n> 司书库文件：本文件只属于当前旅程。模型可按需读取；不要把它当成所有故事共享的书库预设。\\n\\n- 用途：记录小晴在本旅程中的人物设定、关系变化、外观细节和主角已知信息。\\n- 当前可信度：玩家设定优先；主角不知道的内容需要标注为未知/猜测。\\n- 更新原则：关系推进、服装外观、承诺、误会和好感变化时更新。\\n\\n## 基础身份\\n\\n- 姓名：小晴\\n- 身份：{{characterName}} 的高中初恋\\n- 初始关系：曾经亲近，如今略显生疏\\n\\n## 主角已知描述\\n\\n小晴说话轻柔，情绪藏得很深。{{characterName}} 记得她常常做粉色美甲。\\n\\n## 稳定细节\\n\\n- 常有粉色美甲\\n- 上次见面穿过 JK 制服\\n- 对 {{characterName}} 的态度温柔但有距离感\\n\\n## 主角不了解的信息\\n\\n- 她是否仍喜欢 {{characterName}}：我不知道\\n- 她接近 {{characterName}} 是否另有目的：我不了解\\n"
        },
        {
          "path": "scenes/旧教学楼.md",
          "title": "旧教学楼 · 场景",
          "kind": "scene",
          "summary": "适合秘密、误会、放学后邀约和能力线索的校园场景。",
          "tags": ["场景", "校园", "秘密"],
          "content": "# 旧教学楼\\n\\n> 司书库文件：本文件只属于当前旅程。模型可按需读取。\\n\\n- 用途：记录旧教学楼的稳定场景细节，供故事模型在相关剧情中查阅。\\n- 当前可信度：玩家预设；具体时间天气以正文当前状态为准。\\n- 更新原则：出现新房间、线索、封锁情况时追加当前状态，不要覆盖历史事实。\\n\\n## 描述\\n\\n旧教学楼位于校园边缘，傍晚后人很少。走廊灯偶尔闪烁，适合发生秘密谈话、误会撞见和能力线索。\\n"
        }
      ]
    }
  ]
}`;

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importBundle = useContentStore((s) => s.importBundle);

  const doImport = () => {
    setError(undefined);
    try {
      const obj = JSON.parse(text) as ImportBundle;
      const { added } = importBundle(obj);
      setText('');
      onClose();
      alert(`成功导入 ${added} 项内容。`);
    } catch (e: any) {
      setError('JSON 解析失败：' + (e?.message ?? String(e)));
    }
  };

  const importLedgerZipAsPreset = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    try {
      const pkg = parseLedgerJourneyZip(await file.arrayBuffer());
      const resources = pkg.resources as Partial<ImportBundle> | undefined;
      const saveName = pkg.save?.name || '旅程卷宗';
      const workspaceDocs = pkg.workspaceDocs ?? [];
      const template = workspaceTemplateFromDocuments({
        id: genId('wst'),
        name: `${saveName} · 司书库模板`,
        description: '从旅程卷宗 ZIP 提取。启程时勾选后，会把这些文件复制到新旅程自己的司书库。',
        outlineIds: [pkg.save?.content?.outlineId].filter(Boolean) as string[],
        backgroundIds: [pkg.save?.content?.backgroundId].filter(Boolean) as string[],
        worldBookIds: pkg.save?.content?.worldBookIds ?? [],
        tags: ['旅程卷宗', '司书库模板'],
        docs: workspaceDocs,
      });
      const bundle: ImportBundle = {
        outlines: resources?.outlines ?? [],
        backgrounds: resources?.backgrounds ?? [],
        worldBooks: resources?.worldBooks ?? [],
        events: resources?.events ?? [],
        workspaceTemplates: template.docs.length ? [template] : [],
      };
      const { added } = importBundle(bundle);
      onClose();
      alert(`已从旅程卷宗提取 ${added} 项内容${template.docs.length ? `，其中司书库模板包含 ${template.docs.length} 份文件。` : '。该卷宗没有可提取的司书库文件。'}`);
    } catch (e: any) {
      setError('旅程卷宗解析失败：' + (e?.message ?? String(e)));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="导入自定义内容" widthClass="max-w-3xl">
      <div className="text-sm text-parchment-200/80 mb-3 leading-relaxed">
        粘贴下方格式的 JSON，可同时导入多类内容（任一字段可缺省）。也可以从旅程卷宗 ZIP 提取资源和司书库模板。已存在同 id 的内容会被跳过。
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        placeholder={SAMPLE}
        className="font-mono text-xs"
      />
      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>{error}</div>
        </div>
      )}
      <div className="mt-4 flex justify-between items-center">
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setText(SAMPLE)}>填入示例</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Archive size={16} /> 从旅程卷宗提取
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => importLedgerZipAsPreset(e.target.files?.[0])}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={doImport} disabled={!text.trim()}>
            <Upload size={16} /> 导入
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
