import {
  Folder,
  FolderOpen,
  Star,
  Bookmark,
  Flag,
  Target,
  Zap,
  Shield,
  Bug,
  FlaskConical,
  Lock,
  Globe,
  Code,
  Database,
  Server,
  type LucideIcon,
} from 'lucide-react'
import type { OrganizerColor, OrganizerIcon } from '@/api/client'

export const ORGANIZER_ICONS: Record<string, LucideIcon> = {
  Folder,
  FolderOpen,
  Star,
  Bookmark,
  Flag,
  Target,
  Zap,
  Shield,
  Bug,
  FlaskConical,
  Lock,
  Globe,
  Code,
  Database,
  Server,
}

export const FOLDER_COLOR_CLASSES: Record<OrganizerColor, { text: string; bg: string; border: string; ring: string; swatch: string }> = {
  teal:   { text: 'text-teal-400',   bg: 'bg-teal-500/20',   border: 'border-teal-500/40',   ring: 'ring-teal-400',   swatch: 'bg-teal-400'   },
  blue:   { text: 'text-blue-400',   bg: 'bg-blue-500/20',   border: 'border-blue-500/40',   ring: 'ring-blue-400',   swatch: 'bg-blue-400'   },
  purple: { text: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/40', ring: 'ring-purple-400', swatch: 'bg-purple-400' },
  indigo: { text: 'text-indigo-400', bg: 'bg-indigo-500/20', border: 'border-indigo-500/40', ring: 'ring-indigo-400', swatch: 'bg-indigo-400' },
  pink:   { text: 'text-pink-400',   bg: 'bg-pink-500/20',   border: 'border-pink-500/40',   ring: 'ring-pink-400',   swatch: 'bg-pink-400'   },
  red:    { text: 'text-red-400',    bg: 'bg-red-500/20',    border: 'border-red-500/40',    ring: 'ring-red-400',    swatch: 'bg-red-400'    },
  orange: { text: 'text-orange-400', bg: 'bg-orange-500/20', border: 'border-orange-500/40', ring: 'ring-orange-400', swatch: 'bg-orange-400' },
  yellow: { text: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40', ring: 'ring-yellow-400', swatch: 'bg-yellow-400' },
  green:  { text: 'text-green-400',  bg: 'bg-green-500/20',  border: 'border-green-500/40',  ring: 'ring-green-400',  swatch: 'bg-green-400'  },
  cyan:   { text: 'text-cyan-400',   bg: 'bg-cyan-500/20',   border: 'border-cyan-500/40',   ring: 'ring-cyan-400',   swatch: 'bg-cyan-400'   },
}

export const ALL_COLORS = Object.keys(FOLDER_COLOR_CLASSES) as OrganizerColor[]
export const ALL_ICONS = Object.keys(ORGANIZER_ICONS) as OrganizerIcon[]

interface OrganizerIconDisplayProps {
  iconName: string
  size?: number
  className?: string
}

export function OrganizerIconDisplay({ iconName, size = 16, className = '' }: OrganizerIconDisplayProps) {
  const Icon = ORGANIZER_ICONS[iconName] ?? Folder
  return <Icon size={size} className={className} />
}
