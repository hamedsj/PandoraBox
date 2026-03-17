import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light'
export type DarkTheme = 'midnight' | 'charcoal' | 'slate' | 'obsidian' | 'deep'
export type LightTheme = 'day' | 'cream' | 'cool' | 'paper' | 'solar'
export type ThemeVariant = DarkTheme | LightTheme
export type FontFamily = 'system' | 'inter' | 'source-code' | 'jetbrains' | 'fira-code' | 'cascadia' | 'ibm-plex' | 'roboto-mono' | 'monospace'

export interface ThemeColors {
  background: string
  foreground: string
  card: string
  cardForeground: string
  border: string
  input: string
  primary: string
  primaryForeground: string
  muted: string
  mutedForeground: string
}

interface ThemeStore {
  // Theme mode
  mode: ThemeMode
  // Theme variant (depends on mode)
  variant: ThemeVariant
  // Font settings
  fontFamily: FontFamily
  fontSize: number // in pixels (10-20)
  // Accent color
  accentColor: AccentColor

  // Actions
  setMode: (m: ThemeMode) => void
  setVariant: (v: ThemeVariant) => void
  setFontFamily: (f: FontFamily) => void
  setFontSize: (s: number) => void
  setAccentColor: (c: AccentColor) => void
}

export type AccentColor = 'teal' | 'blue' | 'purple' | 'orange' | 'red' | 'green' | 'pink' | 'indigo' | 'cyan' | 'yellow'

// Default variants for each mode
const defaultVariants: Record<ThemeMode, ThemeVariant> = {
  dark: 'midnight',
  light: 'day',
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'dark',
      variant: 'midnight',
      fontFamily: 'jetbrains',
      fontSize: 13,
      accentColor: 'teal',
      setMode: (mode) => set({ mode, variant: defaultVariants[mode] }),
      setVariant: (variant) => set({ variant }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontSize: (fontSize) => set({ fontSize }),
      setAccentColor: (accentColor) => set({ accentColor }),
    }),
    { name: 'pandora-theme' }
  )
)

// Font families with Google Fonts imports
export const fontFamilyMap: Record<FontFamily, { css: string; stack: string; name: string }> = {
  system: { css: '', stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif', name: 'System UI' },
  inter: { css: '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");', stack: "'Inter', system-ui, sans-serif", name: 'Inter' },
  'source-code': { css: '@import url("https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&display=swap");', stack: "'Source Code Pro', monospace", name: 'Source Code Pro' },
  jetbrains: { css: '@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap");', stack: "'JetBrains Mono', monospace", name: 'JetBrains Mono' },
  'fira-code': { css: '@import url("https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&display=swap");', stack: "'Fira Code', monospace", name: 'Fira Code' },
  cascadia: { css: '@import url("https://fonts.googleapis.com/css2?family=Cascadia+Code:wght@400;500;600&display=swap");', stack: "'Cascadia Code', monospace", name: 'Cascadia Code' },
  'ibm-plex': { css: '@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap");', stack: "'IBM Plex Mono', monospace", name: 'IBM Plex Mono' },
  'roboto-mono': { css: '@import url("https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600&display=swap");', stack: "'Roboto Mono', monospace", name: 'Roboto Mono' },
  monospace: { css: '', stack: 'monospace', name: 'Monospace (browser default)' },
}

// Accent color HSL values
export const accentColorMap: Record<AccentColor, string> = {
  teal: '174 72% 46%',
  blue: '214 84% 56%',
  purple: '262 83% 64%',
  orange: '25 95% 53%',
  red: '0 72% 51%',
  green: '142 71% 45%',
  pink: '330 81% 60%',
  indigo: '238 84% 67%',
  cyan: '188 94% 52%',
  yellow: '43 96% 56%',
}

// Dark theme colors
export const darkThemeColors: Record<DarkTheme, ThemeColors> = {
  midnight: {
    background: '222 20% 8%',
    foreground: '210 20% 88%',
    card: '220 18% 11%',
    cardForeground: '210 20% 88%',
    border: '215 15% 18%',
    input: '215 15% 16%',
    primary: '174 72% 46%',
    primaryForeground: '222 20% 8%',
    muted: '215 15% 14%',
    mutedForeground: '215 12% 52%',
  },
  charcoal: {
    background: '210 15% 12%',
    foreground: '220 10% 85%',
    card: '215 14% 14%',
    cardForeground: '220 10% 85%',
    border: '220 12% 20%',
    input: '220 12% 18%',
    primary: '174 72% 46%',
    primaryForeground: '210 15% 12%',
    muted: '220 12% 18%',
    mutedForeground: '220 8% 60%',
  },
  slate: {
    background: '220 14% 10%',
    foreground: '215 8% 90%',
    card: '222 13% 12%',
    cardForeground: '215 8% 90%',
    border: '217 10% 22%',
    input: '217 10% 20%',
    primary: '174 72% 46%',
    primaryForeground: '220 14% 10%',
    muted: '217 10% 20%',
    mutedForeground: '217 6% 58%',
  },
  obsidian: {
    background: '240 10% 6%',
    foreground: '235 10% 85%',
    card: '242 9% 9%',
    cardForeground: '235 10% 85%',
    border: '240 8% 14%',
    input: '240 8% 12%',
    primary: '174 72% 46%',
    primaryForeground: '240 10% 6%',
    muted: '240 8% 12%',
    mutedForeground: '240 6% 55%',
  },
  deep: {
    background: '230 15% 5%',
    foreground: '225 15% 90%',
    card: '235 14% 8%',
    cardForeground: '225 15% 90%',
    border: '230 12% 15%',
    input: '230 12% 13%',
    primary: '174 72% 46%',
    primaryForeground: '230 15% 5%',
    muted: '230 12% 13%',
    mutedForeground: '230 8% 60%',
  },
}

// Light theme colors
export const lightThemeColors: Record<LightTheme, ThemeColors> = {
  day: {
    background: '0 0% 100%',
    foreground: '222 47% 11%',
    card: '0 0% 100%',
    cardForeground: '222 47% 11%',
    border: '214 32% 91%',
    input: '214 32% 91%',
    primary: '174 72% 46%',
    primaryForeground: '0 0% 100%',
    muted: '210 40% 96%',
    mutedForeground: '215 16% 47%',
  },
  cream: {
    background: '38 30% 97%',
    foreground: '35 15% 15%',
    card: '38 25% 98%',
    cardForeground: '35 15% 15%',
    border: '38 20% 88%',
    input: '38 20% 88%',
    primary: '174 72% 46%',
    primaryForeground: '38 30% 97%',
    muted: '38 20% 90%',
    mutedForeground: '35 12% 50%',
  },
  cool: {
    background: '210 20% 98%',
    foreground: '215 25% 10%',
    card: '210 15% 99%',
    cardForeground: '215 25% 10%',
    border: '214 30% 90%',
    input: '214 30% 90%',
    primary: '174 72% 46%',
    primaryForeground: '210 20% 98%',
    muted: '210 25% 94%',
    mutedForeground: '215 16% 45%',
  },
  paper: {
    background: '30 10% 96%',
    foreground: '25 15% 12%',
    card: '30 8% 98%',
    cardForeground: '25 15% 12%',
    border: '30 10% 88%',
    input: '30 10% 88%',
    primary: '174 72% 46%',
    primaryForeground: '30 10% 96%',
    muted: '30 8% 90%',
    mutedForeground: '25 12% 48%',
  },
  solar: {
    background: '48 96% 97%',
    foreground: '30 15% 10%',
    card: '48 90% 98%',
    cardForeground: '30 15% 10%',
    border: '48 70% 85%',
    input: '48 70% 85%',
    primary: '174 72% 46%',
    primaryForeground: '48 96% 97%',
    muted: '48 80% 90%',
    mutedForeground: '30 12% 50%',
  },
}

// Get theme colors based on mode and variant
export function getThemeColors(mode: ThemeMode, variant: ThemeVariant): ThemeColors {
  if (mode === 'dark') {
    return darkThemeColors[variant as DarkTheme] || darkThemeColors.midnight
  }
  return lightThemeColors[variant as LightTheme] || lightThemeColors.day
}

// Get available variants for current mode
export function getAvailableVariants(mode: ThemeMode): { value: ThemeVariant; label: string; description: string }[] {
  if (mode === 'dark') {
    return [
      { value: 'midnight', label: 'Midnight', description: 'Deep blue-black tones' },
      { value: 'charcoal', label: 'Charcoal', description: 'Rich dark gray' },
      { value: 'slate', label: 'Slate', description: 'Cool bluish gray' },
      { value: 'obsidian', label: 'Obsidian', description: 'Very dark purple-black' },
      { value: 'deep', label: 'Deep', description: 'Dark blue-gray' },
    ]
  }
  return [
    { value: 'day', label: 'Day', description: 'Clean white background' },
    { value: 'cream', label: 'Cream', description: 'Warm off-white' },
    { value: 'cool', label: 'Cool', description: 'Light blue-gray' },
    { value: 'paper', label: 'Paper', description: 'Warm paper tone' },
    { value: 'solar', label: 'Solar', description: 'Bright yellow-white' },
  ]
}
