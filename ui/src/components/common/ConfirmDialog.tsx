import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 flex h-10 w-10 items-center justify-center rounded-full border',
                tone === 'danger'
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : 'border-primary/30 bg-primary/10 text-primary'
              )}>
                <AlertTriangle size={18} />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-muted-foreground">
                  {description}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={busy}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={cn(
                'rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                tone === 'danger'
                  ? 'bg-red-500 text-white hover:bg-red-500/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              {busy ? 'Working...' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
