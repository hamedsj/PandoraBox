import { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { FolderColorPicker } from './FolderColorPicker'
import type { OrganizerColor, OrganizerIcon, OrganizerFolder } from '@/api/client'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Partial<OrganizerFolder>
  parentId?: number | null
  onSave: (data: { name: string; color: OrganizerColor; icon: OrganizerIcon; note: string }) => Promise<void>
  onClose: () => void
}

export function FolderForm({ open, mode, initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<OrganizerColor>((initial?.color as OrganizerColor) ?? 'teal')
  const [icon, setIcon] = useState<OrganizerIcon>((initial?.icon as OrganizerIcon) ?? 'Folder')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setColor((initial?.color as OrganizerColor) ?? 'teal')
      setIcon((initial?.icon as OrganizerIcon) ?? 'Folder')
      setNote(initial?.note ?? '')
      setSaving(false)
      setTimeout(() => nameRef.current?.focus(), 50)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave({ name: name.trim() || 'New Folder', color, icon, note })
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-in fade-in duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[calc(100vw-2rem)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 animate-in zoom-in-95 fade-in duration-150">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-base font-semibold text-zinc-100">
              {mode === 'create' ? 'New Folder' : 'Edit Folder'}
            </Dialog.Title>
            <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs font-medium text-zinc-400 mb-1 block">Name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Folder name"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Color + Icon */}
            <div>
              <label className="text-xs font-medium text-zinc-400 mb-1.5 block">Appearance</label>
              <FolderColorPicker
                color={color}
                icon={icon}
                onChange={(c, i) => { setColor(c); setIcon(i) }}
              />
            </div>

            {/* Note */}
            <div>
              <label className="text-xs font-medium text-zinc-400 mb-1 block">Note <span className="font-normal text-zinc-600">(Markdown)</span></label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note..."
                rows={4}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-sm rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
