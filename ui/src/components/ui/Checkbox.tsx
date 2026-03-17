import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  indeterminate?: boolean
  className?: string
  title?: string
}

export function Checkbox({ checked, onChange, indeterminate, className, title }: CheckboxProps) {
  const isActive = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background cursor-pointer',
        isActive
          ? 'bg-primary border-primary'
          : 'bg-background border-border hover:border-primary/60'
      ,className)}
    >
      {indeterminate && !checked
        ? <Minus size={10} strokeWidth={3} className="text-primary-foreground" />
        : checked
          ? <Check size={10} strokeWidth={3} className="text-primary-foreground" />
          : null}
    </button>
  )
}
