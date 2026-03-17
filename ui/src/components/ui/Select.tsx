import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  className?: string
  placeholder?: string
}

export function Select({ value, onChange, options, className, placeholder }: SelectProps) {
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center justify-between gap-1.5 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary hover:border-primary/50 transition-colors cursor-pointer',
            className
          )}
        >
          <span className="truncate">{current?.label ?? placeholder ?? value}</span>
          <ChevronDown size={11} className="text-muted-foreground flex-shrink-0" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[8rem] rounded-lg border border-border bg-card shadow-xl py-1 text-xs animate-in fade-in-0 zoom-in-95"
          sideOffset={4}
          align="start"
          avoidCollisions
        >
          {options.map((opt) => (
            <DropdownMenu.Item
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none outline-none transition-colors',
                opt.value === value
                  ? 'text-primary bg-primary/10'
                  : 'text-foreground hover:bg-muted focus:bg-muted'
              )}
            >
              <span className="flex-1">{opt.label}</span>
              {opt.value === value && (
                <Check size={11} className="text-primary flex-shrink-0" />
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
