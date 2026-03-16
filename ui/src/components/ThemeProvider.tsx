import { useEffect } from 'react'
import { useThemeStore, fontFamilyMap, accentColorMap, getThemeColors } from '@/store/theme'
import { createPortal } from 'react-dom'

// Inject Google Fonts dynamically
function FontImports({ fontFamily }: { fontFamily: string }) {
  const css = fontFamilyMap[fontFamily as keyof typeof fontFamilyMap]?.css || ''
  if (!css) return null
  return createPortal(
    <style dangerouslySetInnerHTML={{ __html: css }} />,
    document.head
  )
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { mode, variant, fontFamily, fontSize, accentColor } = useThemeStore()

  useEffect(() => {
    const root = document.documentElement
    const colors = getThemeColors(mode, variant)

    // Apply theme colors
    root.style.setProperty('--background', colors.background)
    root.style.setProperty('--foreground', colors.foreground)
    root.style.setProperty('--card', colors.card)
    root.style.setProperty('--card-foreground', colors.cardForeground)
    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--input', colors.input)
    root.style.setProperty('--primary', accentColorMap[accentColor])
    root.style.setProperty('--primary-foreground', colors.primaryForeground)
    root.style.setProperty('--muted', colors.muted)
    root.style.setProperty('--muted-foreground', colors.mutedForeground)
    root.style.setProperty('--accent', accentColorMap[accentColor])
    root.style.setProperty('--accent-foreground', colors.primaryForeground)

    // Apply font settings
    root.style.setProperty('--font-mono', fontFamilyMap[fontFamily].stack)
    root.style.setProperty('--font-size-base', `${fontSize}px`)

    // Apply dark mode class
    if (mode === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [mode, variant, fontFamily, fontSize, accentColor])

  return (
    <>
      <FontImports fontFamily={fontFamily} />
      {children}
    </>
  )
}
