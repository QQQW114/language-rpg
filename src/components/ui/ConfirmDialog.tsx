import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'normal' | 'danger';
}

/**
 * 项目内统一的确认对话框，替代 native window.confirm()。
 *
 * 用法：
 *   const ok = await confirmDialog({ title: '删除', message: '确定吗？', variant: 'danger' });
 *   if (ok) doDelete();
 *
 * 实现：每次调用挂一个临时 portal 节点；用户做出选择 / 关闭后自动卸载。
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      // 给 dialog 一点退场动画时间再卸载
      window.setTimeout(() => {
        try {
          root?.unmount();
        } catch {
          /* noop */
        }
        host.remove();
      }, 200);
    };

    const onResolve = (ok: boolean) => {
      resolve(ok);
      cleanup();
    };

    root = createRoot(host);
    root.render(<ConfirmRenderer options={opts} onResolve={onResolve} />);
  });
}

function ConfirmRenderer({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (ok: boolean) => void;
}) {
  const { title, message, confirmText = '确认', cancelText = '取消', variant = 'normal' } = options;
  const [open, setOpen] = useState(true);

  // ESC 关闭由 Dialog 内部处理；这里在 onClose 时视作取消
  const close = (ok: boolean) => {
    setOpen(false);
    onResolve(ok);
  };

  // 自动聚焦 confirm 按钮
  const [confirmRef, setConfirmRef] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef?.focus();
  }, [confirmRef]);

  return (
    <Dialog
      open={open}
      onClose={() => close(false)}
      title={title ?? (variant === 'danger' ? '请再三确认' : '请确认')}
      widthClass="max-w-md"
    >
      <div className="flex items-start gap-4 pb-2">
        {variant === 'danger' && (
          <div className="shrink-0">
            <AlertTriangle size={28} className="text-blood drop-shadow-[0_0_8px_rgba(138,47,47,0.5)]" />
          </div>
        )}
        <div className="flex-1 font-serif text-sm leading-relaxed text-parchment-100 whitespace-pre-line">
          {message}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close(false)}>
          {cancelText}
        </Button>
        <Button
          ref={setConfirmRef as any}
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={() => close(true)}
        >
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
}
