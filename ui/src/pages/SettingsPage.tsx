import { api, type MCPStatus } from '@/api/client'
import { useThemeStore, fontFamilyMap, accentColorMap, getAvailableVariants, darkThemeColors, lightThemeColors, type ThemeMode, type FontFamily, type AccentColor, type ThemeVariant, DarkTheme, LightTheme } from '@/store/theme'
import { useShortcutStore } from '@/store/shortcuts'
import { useReplayStore } from '@/store/replay'
import { useProxyStore } from '@/store/proxy'
import { shortcutDefinitions, type ShortcutActionId } from '@/shortcuts/actions'
import { eventToShortcut, formatShortcut } from '@/lib/shortcuts'
import { Download, Sun, Moon, Palette, Type, Check, Shield, Server, Globe, LayoutDashboard, Keyboard, RotateCcw, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'

const accentColors: { value: AccentColor; label: string }[] = [
  { value: 'teal', label: 'Teal' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'pink', label: 'Pink' },
  { value: 'red', label: 'Red' },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
  { value: 'cyan', label: 'Cyan' },
]

const fontOptions: { value: FontFamily; label: string; description: string }[] = [
  { value: 'system', label: 'System UI', description: 'Operating system default font' },
  { value: 'inter', label: 'Inter', description: 'Clean sans-serif font' },
  { value: 'source-code', label: 'Source Code Pro', description: 'Optimized for code' },
  { value: 'jetbrains', label: 'JetBrains Mono', description: 'Popular developer font' },
  { value: 'fira-code', label: 'Fira Code', description: 'With ligatures support' },
  { value: 'cascadia', label: 'Cascadia Code', description: 'Microsoft designed' },
  { value: 'ibm-plex', label: 'IBM Plex Mono', description: 'IBM\'s open source font' },
  { value: 'roboto-mono', label: 'Roboto Mono', description: 'Google\'s monospace font' },
  { value: 'monospace', label: 'Monospace', description: 'Browser default monospace' },
]

const sampleText = `The quick brown fox jumps over the lazy dog.
1234567890
!@#$%^&*()_+-=[]{}|;:,.<>?

// Sample code
function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return true;
}

const status = {
  code: 200,
  message: "OK"
};`

type SettingsTab = 'appearance' | 'shortcuts' | 'certificate' | 'proxy' | 'mcp'

interface MCPClientTip {
  name: string
  summary: string
  command?: string
  configLabel?: string
  config?: string
  notes: string[]
}

function buildMCPClientTips(endpoint: string): MCPClientTip[] {
  return [
    {
      name: 'Claude Code',
      summary: 'Add PandoraBox as a remote HTTP MCP server from the Claude Code CLI.',
      command: `claude mcp add --transport http pandorabox ${endpoint}`,
      notes: [
        'Run `claude mcp list` to verify it was added.',
        'If you want it across projects, add `--scope user`.',
        'If the server ever requires auth in the future, use `/mcp` inside Claude Code.',
      ],
    },
    {
      name: 'Gemini CLI',
      summary: 'Gemini supports remote MCP over HTTP and can add it directly from the terminal.',
      command: `gemini mcp add --transport http pandorabox ${endpoint}`,
      notes: [
        'Use `--scope user` if you want the server in `~/.gemini/settings.json` instead of project scope.',
        'Run `gemini mcp list` after adding it.',
        'Restart Gemini in the project after changing MCP config.',
      ],
    },
    {
      name: 'Codex',
      summary: 'Codex can add remote MCP servers from the CLI or through `~/.codex/config.toml`.',
      command: `codex mcp add pandorabox --url ${endpoint}`,
      configLabel: '~/.codex/config.toml',
      config: `[mcp_servers.pandorabox]
url = "${endpoint}"`,
      notes: [
        'Run `codex mcp list` to confirm the server is registered.',
        'CLI and IDE extension share the same Codex MCP configuration.',
      ],
    },
    {
      name: 'Qwen Code',
      summary: 'Qwen supports remote streamable HTTP MCP servers from CLI or settings JSON.',
      command: `qwen mcp add --transport http pandorabox ${endpoint}`,
      configLabel: '.qwen/settings.json or ~/.qwen/settings.json',
      config: `{
  "mcpServers": {
    "pandorabox": {
      "httpUrl": "${endpoint}"
    }
  }
}`,
      notes: [
        'Use `--scope user` if you want the server available across projects.',
        'Open `qwen mcp` to manage configured servers.',
        'Restart Qwen Code after adding the server.',
      ],
    },
  ]
}

export function SettingsPage() {
  const {
    mode,
    variant,
    fontFamily,
    fontSize,
    accentColor,
    setMode,
    setVariant,
    setFontFamily,
    setFontSize,
    setAccentColor,
  } = useThemeStore()
  const shortcutEnabled = useShortcutStore((state) => state.enabled)
  const shortcutBindings = useShortcutStore((state) => state.bindings)
  const setShortcutEnabled = useShortcutStore((state) => state.setEnabled)
  const setShortcutBinding = useShortcutStore((state) => state.setBinding)
  const resetShortcutBindings = useShortcutStore((state) => state.resetBindings)
  const autoContentLength = useReplayStore((state) => state.autoContentLength)
  const setAutoContentLength = useReplayStore((state) => state.setAutoContentLength)
  const project = useProxyStore((state) => state.project)
  const setProject = useProxyStore((state) => state.setProject)

  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [mcpTogglePending, setMcpTogglePending] = useState(false)
  const [upstreamURL, setUpstreamURL] = useState(project?.proxy?.upstream_url ?? '')
  const [upstreamSaving, setUpstreamSaving] = useState(false)
  const [upstreamError, setUpstreamError] = useState<string | null>(null)
  const [proxyPort, setProxyPort] = useState(String(project?.proxy?.port ?? 8080))
  const [proxyPortSaving, setProxyPortSaving] = useState(false)
  const [proxyPortMsg, setProxyPortMsg] = useState<{ ok?: string; err?: string } | null>(null)
  const [mcpPort, setMcpPort] = useState(String(project?.mcp_port ?? 9090))
  const [mcpPortSaving, setMcpPortSaving] = useState(false)
  const [mcpPortMsg, setMcpPortMsg] = useState<{ ok?: string; err?: string } | null>(null)
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(project?.mcp_status ?? null)

  useEffect(() => {
    setUpstreamURL(project?.proxy?.upstream_url ?? '')
  }, [project?.proxy?.upstream_url])

  useEffect(() => {
    setProxyPort(String(project?.proxy?.port ?? 8080))
  }, [project?.proxy?.port])

  useEffect(() => {
    setMcpPort(String(project?.mcp_port ?? 9090))
  }, [project?.mcp_port])

  useEffect(() => {
    setMcpStatus(project?.mcp_status ?? null)
  }, [project?.mcp_status])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const status = await api.mcp.status()
        if (!cancelled) setMcpStatus(status)
      } catch {
        if (!cancelled) {
          setMcpStatus((current) => current ? { ...current, running: false, last_error: 'Failed to load MCP status' } : null)
        }
      }
    }

    void load()
    timer = setInterval(() => {
      void load()
    }, 5000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [project?.mcp_port, project?.mcp_disabled])
  const availableVariants = getAvailableVariants(mode)
  const [fontSizeValue, setFontSizeValue] = useState(fontSize.toString())

  // Get current theme colors for preview
  const currentThemeColors = mode === 'dark'
    ? darkThemeColors[variant as DarkTheme]
    : lightThemeColors[variant as LightTheme]

  // Update font size on slider change
  const handleFontSizeChange = (value: string) => {
    setFontSizeValue(value)
    setFontSize(parseInt(value, 10))
  }

  async function saveUpstreamProxy() {
    if (!project) return
    setUpstreamSaving(true)
    setUpstreamError(null)
    try {
      const updated = await api.project.update({
        proxy: { ...project.proxy, upstream_url: upstreamURL.trim() || undefined }
      })
      setProject(updated)
    } catch (e: unknown) {
      setUpstreamError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setUpstreamSaving(false)
    }
  }

  async function saveProxyPort() {
    if (!project) return
    const port = parseInt(proxyPort, 10)
    if (!port || port < 1 || port > 65535) {
      setProxyPortMsg({ err: 'Invalid port number.' })
      return
    }
    setProxyPortSaving(true)
    setProxyPortMsg(null)
    try {
      const updated = await api.project.update({ proxy: { ...project.proxy, port } })
      setProject(updated)
      setProxyPortMsg({ ok: 'Port changed.' })
    } catch (e: unknown) {
      setProxyPortMsg({ err: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setProxyPortSaving(false)
    }
  }

  async function saveMcpPort() {
    if (!project) return
    const port = parseInt(mcpPort, 10)
    if (!port || port < 1 || port > 65535) {
      setMcpPortMsg({ err: 'Invalid port number.' })
      return
    }
    setMcpPortSaving(true)
    setMcpPortMsg(null)
    try {
      const updated = await api.project.update({ mcp_port: port })
      setProject(updated)
      setMcpStatus(updated.mcp_status)
      setMcpPortMsg({ ok: 'Port changed.' })
    } catch (e: unknown) {
      setMcpPortMsg({ err: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setMcpPortSaving(false)
    }
  }

  const mcpHealthTone = !mcpStatus?.running
    ? 'border-red-500/30 bg-red-500/10 text-red-300'
    : !mcpStatus.access_enabled
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  const mcpHealthLabel = !mcpStatus?.running
    ? 'Offline'
    : !mcpStatus.access_enabled
      ? 'Listening, access disabled'
      : 'Ready'
  const mcpEndpoint = mcpStatus?.endpoint || `http://localhost:${mcpPort}/mcp`
  const legacySSEEndpoint = mcpStatus?.legacy_sse_endpoint || `http://localhost:${mcpPort}/sse`
  const mcpClientTips = buildMCPClientTips(mcpEndpoint)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-lg font-semibold">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-muted rounded-lg mb-6">
        <TabButton
          icon={Palette}
          label="Appearance"
          active={activeTab === 'appearance'}
          onClick={() => setActiveTab('appearance')}
        />
        <TabButton
          icon={Keyboard}
          label="Shortcuts"
          active={activeTab === 'shortcuts'}
          onClick={() => setActiveTab('shortcuts')}
        />
        <TabButton
          icon={Shield}
          label="Certificate"
          active={activeTab === 'certificate'}
          onClick={() => setActiveTab('certificate')}
        />
        <TabButton
          icon={Server}
          label="Proxy"
          active={activeTab === 'proxy'}
          onClick={() => setActiveTab('proxy')}
        />
        <TabButton
          icon={Bot}
          label="MCP"
          active={activeTab === 'mcp'}
          onClick={() => setActiveTab('mcp')}
        />
      </div>

      {/* Appearance Tab */}
      {activeTab === 'appearance' && (
        <>
          {/* Theme Mode & Colors */}
          <section className="bg-card rounded-lg border border-border p-5 space-y-6">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              <h2 className="text-sm font-medium">Theme</h2>
            </div>

            {/* Dark/Light Mode Toggle */}
            <div>
              <label className="text-xs text-muted-foreground block mb-3">Theme Mode</label>
              <div className="flex gap-2 p-1 bg-muted rounded-lg">
                <button
                  onClick={() => setMode('dark')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all',
                    mode === 'dark'
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Moon className="w-4 h-4" />
                  Dark
                </button>
                <button
                  onClick={() => setMode('light')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all',
                    mode === 'light'
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Sun className="w-4 h-4" />
                  Light
                </button>
              </div>
            </div>

            {/* Theme Variants */}
            <div>
              <label className="text-xs text-muted-foreground block mb-3">Theme Style</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {availableVariants.map((v) => {
                  const isSelected = variant === v.value
                  const bgColor = mode === 'dark'
                    ? darkThemeColors[v.value as DarkTheme]?.background
                    : lightThemeColors[v.value as LightTheme]?.background
                  return (
                    <button
                      key={v.value}
                      onClick={() => setVariant(v.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all group',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      )}
                    >
                      <div
                        className="w-8 h-8 rounded-full ring-2 ring-border"
                        style={{ backgroundColor: bgColor ? `hsl(${bgColor})` : undefined }}
                      />
                      <div className="text-xs font-medium">{v.label}</div>
                      <div className="text-[10px] text-muted-foreground text-center leading-tight">{v.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Accent Colors */}
            <div>
              <label className="text-xs text-muted-foreground block mb-3">Accent Color</label>
              <div className="flex flex-wrap gap-3">
                {accentColors.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setAccentColor(c.value)}
                    title={c.label}
                    className={cn(
                      'w-9 h-9 rounded-full border-2 transition-all hover:scale-110 relative',
                      accentColor === c.value ? 'border-foreground ring-2 ring-offset-2 ring-offset-background ring-foreground/20' : 'border-transparent'
                    )}
                    style={{ backgroundColor: `hsl(${accentColorMap[c.value]})` }}
                  >
                    {accentColor === c.value && (
                      <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-md" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Typography */}
          <section className="bg-card rounded-lg border border-border p-5 space-y-6">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4" />
              <h2 className="text-sm font-medium">Typography</h2>
            </div>

            {/* Font Size Slider */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-muted-foreground">Font Size</label>
                <span className="text-xs text-primary font-medium">{fontSize}px</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">10px</span>
                <input
                  type="range"
                  min="10"
                  max="20"
                  step="1"
                  value={fontSizeValue}
                  onChange={(e) => handleFontSizeChange(e.target.value)}
                  className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer outline-none"
                  style={{
                    background: `linear-gradient(to right, hsl(${accentColorMap[accentColor]}) 0%, hsl(${accentColorMap[accentColor]}) ${((fontSize - 10) / 10) * 100}%, hsl(var(--border)) ${((fontSize - 10) / 10) * 100}%, hsl(var(--border)) 100%)`,
                  }}
                />
                <span className="text-xs text-muted-foreground">20px</span>
              </div>
              <div className="flex justify-between mt-1">
                {['10', '12', '14', '16', '18', '20'].map((size) => (
                  <button
                    key={size}
                    onClick={() => handleFontSizeChange(size)}
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                      fontSize === parseInt(size, 10)
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className="text-xs text-muted-foreground block mb-3">Font Family</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fontOptions.map((font) => (
                  <button
                    key={font.value}
                    onClick={() => setFontFamily(font.value)}
                    className={cn(
                      'flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all',
                      fontFamily === font.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    )}
                  >
                    <div className="font-medium text-sm" style={{ fontFamily: fontFamilyMap[font.value].stack }}>
                      {font.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{font.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Text Preview */}
            <div>
              <label className="text-xs text-muted-foreground block mb-2">Preview</label>
              <div className="bg-muted/50 rounded-lg p-4 border border-border overflow-hidden">
                <pre className="whitespace-pre-wrap break-words leading-relaxed" style={{ fontFamily: fontFamilyMap[fontFamily].stack, fontSize: `${fontSize}px` }}>
                  {sampleText}
                </pre>
              </div>
            </div>
          </section>

        </>
      )}

      {activeTab === 'shortcuts' && (
        <section className="space-y-5">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-[0_18px_60px_rgba(0,0,0,0.14)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_35%)]" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">Keyboard Shortcuts</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  IDE-style shortcuts for navigation and core workflows. Customize each binding below or disable the system entirely.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setShortcutEnabled(!shortcutEnabled)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all',
                    shortcutEnabled
                      ? 'border-primary/40 bg-primary/12 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Keyboard size={15} />
                  {shortcutEnabled ? 'Shortcuts Enabled' : 'Shortcuts Disabled'}
                </button>
                <button
                  onClick={resetShortcutBindings}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RotateCcw size={15} />
                  Reset Defaults
                </button>
              </div>
            </div>
          </div>

          {(['Navigation', 'Common', 'Intercept', 'Replay'] as const).map((group) => {
            const items = shortcutDefinitions.filter((definition) => definition.group === group)
            return (
              <section key={group} className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{group}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {group === 'Navigation' && 'Fast movement between core views.'}
                      {group === 'Common' && 'Context-aware actions shared across request views.'}
                      {group === 'Intercept' && 'Safe combined-key actions for the intercept workflow.'}
                      {group === 'Replay' && 'Keyboard actions for replay execution.'}
                    </p>
                  </div>
                  <div className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {items.length} actions
                  </div>
                </div>

                <div className="space-y-3">
                  {items.map((definition) => (
                    <ShortcutRow
                      key={definition.id}
                      actionId={definition.id}
                      label={definition.label}
                      description={definition.description}
                      binding={shortcutBindings[definition.id]}
                      onChange={setShortcutBinding}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </section>
      )}

      {/* Certificate Tab */}
      {activeTab === 'certificate' && (
        <section className="bg-card rounded-lg border border-border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <h2 className="text-sm font-medium">CA Certificate</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Install PandoraBox CA certificate in your browser to intercept HTTPS traffic.
          </p>

          <div className="flex gap-2">
            <a
              href={api.ca.certUrl()}
              download="pandorabox-ca.crt"
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              <Download size={14} />
              Download CA Certificate
            </a>
          </div>

          <div className="space-y-2 text-sm">
            <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Browser Installation</div>
            <InstallStep
              title="macOS (Chrome / Edge / Safari)"
              steps={[
                'Download the .crt file above',
                'Double-click it → it opens Keychain Access',
                'IMPORTANT: Change destination to "System" keychain (not "login")',
                'Enter your password',
                'Find "PandoraBox CA" in System keychain → double-click',
                'Expand "Trust" → "When using this certificate: Always Trust"',
                'Restart browser completely',
              ]}
            />
            <InstallStep
              title="Firefox (all platforms)"
              steps={[
                'Settings → Privacy & Security → Certificates → View Certificates',
                'Authorities tab → Import → select pandorabox-ca.crt',
                'Check "Trust this CA to identify websites"',
              ]}
            />
            <InstallStep
              title="Windows (Chrome / Edge)"
              steps={[
                'Double-click pandorabox-ca.crt → Install Certificate',
                'Select "Local Machine" → Next',
                'Place in "Trusted Root Certification Authorities"',
                'Restart browser',
              ]}
            />
            <InstallStep
              title="Linux (Chrome)"
              steps={[
                'chrome://settings/certificates → Authorities → Import',
                'Select pandorabox-ca.crt',
                'Check "Trust this certificate for identifying websites"',
              ]}
            />
          </div>
        </section>
      )}

      {/* Proxy Tab */}
      {activeTab === 'proxy' && (
        <section className="bg-card rounded-lg border border-border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            <h2 className="text-sm font-medium">Proxy Configuration</h2>
          </div>

          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 border border-border space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <div className="text-sm font-medium">HTTP/HTTPS Proxy</div>
              </div>
              <p className="text-sm text-muted-foreground">
                Configure your browser or system to use this proxy. Changes take effect immediately.
              </p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Proxy Port</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground font-mono">127.0.0.1:</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={proxyPort}
                    onChange={(e) => setProxyPort(e.target.value)}
                    className="w-24 bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(`127.0.0.1:${proxyPort}`)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                </div>
                {proxyPortMsg?.ok && <p className="text-xs text-green-400">{proxyPortMsg.ok}</p>}
                {proxyPortMsg?.err && <p className="text-xs text-red-400">{proxyPortMsg.err}</p>}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveProxyPort}
                  disabled={proxyPortSaving || !project}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                    proxyPortSaving
                      ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
                      : 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20'
                  )}
                >
                  {proxyPortSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>


            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Replay Editor</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Automatically update the `Content-Length` header when sending a modified raw replay packet.
                  </p>
                </div>
                <button
                  onClick={() => setAutoContentLength(!autoContentLength)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all',
                    autoContentLength
                      ? 'border-primary/40 bg-primary/12 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {autoContentLength ? 'Auto Content-Length On' : 'Auto Content-Length Off'}
                </button>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 border border-border space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <div className="text-sm font-medium">Upstream Proxy</div>
              </div>
              <p className="text-xs text-muted-foreground">
                Route all outbound traffic through another proxy.
                Supported: <code className="font-mono">http://</code>, <code className="font-mono">socks5://</code>.
                Leave empty to connect directly.
              </p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Proxy URL</label>
                <input
                  type="text"
                  value={upstreamURL}
                  onChange={(e) => setUpstreamURL(e.target.value)}
                  placeholder="http://127.0.0.1:8080  or  socks5://user:pass@host:1080"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {upstreamError && <p className="text-xs text-red-400">{upstreamError}</p>}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {upstreamURL.trim() ? 'Traffic routes through the proxy above.' : 'Direct connections (no upstream proxy).'}
                </p>
                <button
                  onClick={saveUpstreamProxy}
                  disabled={upstreamSaving || !project}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                    upstreamSaving
                      ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
                      : 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20'
                  )}
                >
                  {upstreamSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MCP Tab */}
      {activeTab === 'mcp' && (
        <section className="bg-card rounded-lg border border-border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            <h2 className="text-sm font-medium">MCP Integration</h2>
          </div>

          <div className="space-y-4">
            {/* Access toggle */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Enable MCP Access</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This controls whether MCP clients may use the project tools after they connect.
                  </p>
                </div>
                <button
                  disabled={mcpTogglePending || !project}
                  onClick={async () => {
                    if (!project) return
                    const next = !project.mcp_disabled
                    setMcpTogglePending(true)
                    try {
                      const updated = await api.project.update({ mcp_disabled: next })
                      setProject(updated)
                    } finally {
                      setMcpTogglePending(false)
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all',
                    mcpTogglePending && 'opacity-50 cursor-not-allowed',
                    !project?.mcp_disabled
                      ? 'border-primary/40 bg-primary/12 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {mcpTogglePending ? 'Saving...' : !project?.mcp_disabled ? 'MCP Enabled' : 'MCP Disabled'}
                </button>
              </div>
            </div>

            {/* MCP health */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="w-4 h-4 text-primary" />
                    <div className="text-sm font-medium">Connection Status</div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The server now listens on Streamable HTTP and also keeps the older SSE transport for compatibility.
                  </p>
                </div>
                <div className={cn('rounded-full border px-3 py-1 text-xs font-medium', mcpHealthTone)}>
                  {mcpHealthLabel}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Transport</div>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {mcpStatus?.transport || 'streamable-http+legacy-sse'}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Port</div>
                  <div className="mt-2 font-mono text-sm text-foreground">{mcpStatus?.port || mcpPort}</div>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Access</div>
                  <div className="mt-2 text-sm text-foreground">
                    {mcpStatus?.access_enabled ? 'Allowed for this project' : 'Blocked by project setting'}
                  </div>
                </div>
              </div>

              {mcpStatus?.last_error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {mcpStatus.last_error}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Primary MCP Endpoint</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto font-mono text-primary bg-background px-3 py-2 rounded-md text-sm">
                    {mcpEndpoint}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(mcpEndpoint)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use this URL for modern MCP clients. The legacy compatibility endpoint remains available at <code className="font-mono">{legacySSEEndpoint}</code>.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">MCP Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={mcpPort}
                  onChange={(e) => setMcpPort(e.target.value)}
                  className="w-24 bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {mcpPortMsg?.ok && <p className="text-xs text-green-400">{mcpPortMsg.ok}</p>}
                {mcpPortMsg?.err && <p className="text-xs text-red-400">{mcpPortMsg.err}</p>}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveMcpPort}
                  disabled={mcpPortSaving || !project}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                    mcpPortSaving
                      ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
                      : 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20'
                  )}
                >
                  {mcpPortSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Generic client config snippet */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border space-y-2">
              <div className="text-sm font-medium">MCP Client Config</div>
              <p className="text-xs text-muted-foreground">
                Use the Streamable HTTP endpoint in any MCP client that supports remote HTTP servers.
              </p>
              <div className="relative">
                <pre className="bg-background rounded-md border border-border p-3 text-xs font-mono text-foreground overflow-x-auto leading-relaxed">
{`{
  "mcpServers": {
    "pandorabox": {
      "url": "${mcpEndpoint}"
    }
  }
}`}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(`{\n  "mcpServers": {\n    "pandorabox": {\n      "url": "${mcpEndpoint}"\n    }\n  }\n}`)}
                  className="absolute top-2 right-2 text-xs text-muted-foreground hover:text-foreground"
                  title="Copy to clipboard"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* Assistant-specific setup tips */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border space-y-4">
              <div>
                <div className="text-sm font-medium">Assistant Setup Tips</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quick copy-paste commands and config snippets for common MCP clients.
                </p>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {mcpClientTips.map((tip) => (
                  <div key={tip.name} className="rounded-xl border border-border bg-background/70 p-4 space-y-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">{tip.name}</div>
                      <p className="text-xs text-muted-foreground">{tip.summary}</p>
                    </div>

                    {tip.command && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">CLI Command</div>
                          <button
                            onClick={() => navigator.clipboard.writeText(tip.command!)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Copy to clipboard"
                          >
                            Copy
                          </button>
                        </div>
                        <pre className="overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all">
{tip.command}
                        </pre>
                      </div>
                    )}

                    {tip.config && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            Config Snippet
                            {tip.configLabel ? ` · ${tip.configLabel}` : ''}
                          </div>
                          <button
                            onClick={() => navigator.clipboard.writeText(tip.config!)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                            title="Copy to clipboard"
                          >
                            Copy
                          </button>
                        </div>
                        <pre className="overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all">
{tip.config}
                        </pre>
                      </div>
                    )}

                    <div className="space-y-1">
                      {tip.notes.map((note) => (
                        <p key={note} className="text-xs text-muted-foreground">
                          {note}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                Prefer the primary HTTP endpoint when the client supports it. The SSE endpoint is shown above only for older compatibility cases.
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function TabButton({ icon: Icon, label, active, onClick }: { icon: any; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
        active
          ? 'bg-background shadow-sm text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon size={16} />
      {label}
    </button>
  )
}

function ShortcutRow({
  actionId,
  label,
  description,
  binding,
  onChange,
}: {
  actionId: ShortcutActionId
  label: string
  description: string
  binding: string
  onChange: (actionId: ShortcutActionId, binding: string) => void
}) {
  const [capturing, setCapturing] = useState(false)

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!capturing) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setCapturing(false)
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      onChange(actionId, '')
      setCapturing(false)
      return
    }

    const shortcut = eventToShortcut(event.nativeEvent)
    if (!shortcut) return

    onChange(actionId, shortcut)
    setCapturing(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/25 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-shortcut-capture="true"
          onClick={() => setCapturing((value) => !value)}
          onKeyDown={handleKeyDown}
          className={cn(
            'min-w-40 rounded-xl border px-3 py-2 text-left font-mono text-xs transition-all',
            capturing
              ? 'border-primary bg-primary/12 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]'
              : 'border-border bg-background text-foreground hover:bg-muted'
          )}
        >
          {capturing ? 'Press keys...' : binding ? formatShortcut(binding) : 'Unassigned'}
        </button>
        {binding && (
          <button
            type="button"
            onClick={() => onChange(actionId, '')}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function InstallStep({ title, steps }: { title: string; steps: string[] }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-foreground/80 hover:text-foreground py-1 select-none">
        {title}
      </summary>
      <ol className="mt-1 ml-4 space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="text-xs text-muted-foreground list-decimal list-inside">{s}</li>
        ))}
      </ol>
    </details>
  )
}
