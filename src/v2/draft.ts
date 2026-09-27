/**
 * 未发送输入的草稿保留。
 *
 * 需求：玩家在输入框里写了一半的内容，在打开设置页、返回主页、或刷新后重新进入
 * 对话时应当还在，而不是被直接丢弃。此前输入只存在组件 state 里，任何一次导航
 * 都会让它消失。
 *
 * 存储位置：localStorage 的 `lrpg.draft.<saveId>`，每个存档一份，互不干扰。
 * 单独放一个键而不是塞进 `lrpg.v2`（存档本体）：草稿是易失的界面状态，
 * 不该参与存档体积与写入可靠性那套机制，也不该让一次草稿写入失败影响存档。
 */

const PREFIX = 'lrpg.draft.';
const MAX_DRAFT_LENGTH = 20_000;

function storage(): Storage | undefined {
  try {
    // 隐私模式或沙箱下访问 localStorage 可能直接抛错。
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function draftKey(saveId: string): string {
  return `${PREFIX}${saveId}`;
}

export function readDraft(saveId: string | undefined): string {
  if (!saveId) return '';
  try {
    const raw = storage()?.getItem(draftKey(saveId));
    return typeof raw === 'string' ? raw.slice(0, MAX_DRAFT_LENGTH) : '';
  } catch {
    return '';
  }
}

export function writeDraft(saveId: string | undefined, value: string): void {
  if (!saveId) return;
  try {
    const store = storage();
    if (!store) return;
    if (!value) store.removeItem(draftKey(saveId));
    else store.setItem(draftKey(saveId), value.slice(0, MAX_DRAFT_LENGTH));
  } catch {
    /* 草稿写入失败不应影响任何功能；最坏情况只是这次草稿没保留。 */
  }
}

export function clearDraft(saveId: string | undefined): void {
  writeDraft(saveId, '');
}
