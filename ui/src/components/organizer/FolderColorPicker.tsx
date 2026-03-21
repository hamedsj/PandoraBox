import { FOLDER_COLOR_CLASSES, ORGANIZER_ICONS, ALL_COLORS, ALL_ICONS, OrganizerIconDisplay } from './OrganizerIcons'
import type { OrganizerColor, OrganizerIcon } from '@/api/client'

interface Props {
  color: OrganizerColor
  icon: OrganizerIcon
  onChange: (color: OrganizerColor, icon: OrganizerIcon) => void
}

export function FolderColorPicker({ color, icon, onChange }: Props) {
  const colorCls = FOLDER_COLOR_CLASSES[color]

  return (
    <div className="space-y-3">
      {/* Color swatches */}
      <div className="flex gap-1.5 flex-wrap">
        {ALL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c, icon)}
            className={`w-5 h-5 rounded-full transition-all ${FOLDER_COLOR_CLASSES[c].swatch} ${
              c === color ? `ring-2 ring-offset-2 ring-offset-zinc-900 ${FOLDER_COLOR_CLASSES[c].ring}` : 'opacity-60 hover:opacity-100'
            }`}
            title={c}
          />
        ))}
      </div>

      {/* Icon grid */}
      <div className="grid grid-cols-8 gap-1">
        {ALL_ICONS.map((ic) => (
          <button
            key={ic}
            type="button"
            onClick={() => onChange(color, ic)}
            className={`p-1.5 rounded transition-all flex items-center justify-center ${
              ic === icon
                ? `${colorCls.bg} ${colorCls.border} border ring-1 ${colorCls.ring}`
                : 'hover:bg-zinc-700/50'
            }`}
            title={ic}
          >
            <OrganizerIconDisplay iconName={ic} size={16} className={ic === icon ? colorCls.text : 'text-zinc-400'} />
          </button>
        ))}
      </div>
    </div>
  )
}
