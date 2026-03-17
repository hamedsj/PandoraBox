import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
  title?: string
}

export function Checkbox({ checked, onChange, className, title }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background cursor-pointer',
        checked
          ? 'bg-primary border-primary'
          : 'bg-background border-border hover:border-primary/60'
      ,className)}
    >
      {checked && <Check size={10} strokeWidth={3} className="text-primary-foreground" />}
    </button>
  )
}
