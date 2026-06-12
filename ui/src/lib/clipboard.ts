import { toast } from 'sonner'

export function copyText(text: string, successMessage = 'Copied to clipboard'): Promise<void> {
  return navigator.clipboard
    .writeText(text)
    .then(() => { toast.success(successMessage) })
    .catch(() => { toast.error('Copy failed') })
}
