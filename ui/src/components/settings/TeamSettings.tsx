import { useState, useEffect } from 'react'
import { api, type TeamStatus, type AdminStatus, type AdminMember } from '@/api/client'
import { useTeamStore, memberColor, memberInitials } from '@/store/team'
import { cn } from '@/lib/utils'
import { Wifi, WifiOff, Loader2, Users, RefreshCw, Download, AlertTriangle, Shield, Server, FolderOpen, RotateCcw } from 'lucide-react'

// ── Client connection card ─────────────────────────────────────────────────────

function ConnectionCard() {
  const syncStatus = useTeamStore((s) => s.syncStatus)
  const members = useTeamStore((s) => s.members)
  const myUserId = useTeamStore((s) => s.myUserId)

  const [teamStatus, setTeamStatus] = useState<TeamStatus | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    api.team.status().then((s) => {
      setTeamStatus(s)
      if (s.server_url) setServerUrl(s.server_url)
    }).catch(() => {})
  }, [])

  const isConnected = syncStatus === 'connected'
  const isConnecting = syncStatus === 'connecting'

  async function handleConnect() {
    if (!serverUrl.trim() || !password.trim()) {
      setError('Server URL and password are required.')
      return
    }
    setConnecting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.team.connect({ server_url: serverUrl.trim(), password, display_name: displayName.trim() || undefined })
      setSuccess('Connected to team server.')
      setPassword('')
      const updated = await api.team.status()
      setTeamStatus(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed.')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError(null)
    try {
      await api.team.disconnect()
      setSuccess('Disconnected.')
      setTeamStatus(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Disconnect failed.')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className="bg-card rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4" />
        <h2 className="text-sm font-medium">Connect to Team Server</h2>
        <span
          className={cn(
            'ml-auto flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border',
            isConnected ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' :
            isConnecting ? 'text-amber-300 bg-amber-500/10 border-amber-500/30' :
            'text-muted-foreground bg-muted/50 border-border'
          )}
        >
          {isConnected && <><Wifi className="w-3 h-3" /> Connected</>}
          {isConnecting && <><Loader2 className="w-3 h-3 animate-spin" /> Connecting…</>}
          {!isConnected && !isConnecting && <><WifiOff className="w-3 h-3" /> Disconnected</>}
        </span>
      </div>

      {!isConnected ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Server URL</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://your-server:7778"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Team server password"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Your Display Name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {error}</p>
          )}
          {success && <p className="text-xs text-emerald-400">{success}</p>}
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {connecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Connect
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Connected to <span className="text-foreground font-medium">{teamStatus?.server_url || serverUrl}</span>
          </div>
          {/* Member list */}
          {members.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Team Members</p>
              <div className="space-y-1.5">
                {members.map((m) => {
                  const color = memberColor(m)
                  const initials = memberInitials(m.display_name || m.user_id)
                  const isMe = m.user_id === myUserId
                  return (
                    <div key={m.user_id} className="flex items-center gap-2.5">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: `hsl(${color})` }}
                      >
                        {initials}
                      </span>
                      <span className="text-sm truncate">{m.display_name || m.user_id}</span>
                      {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">You</span>}
                      <span className={cn('ml-auto h-2 w-2 rounded-full shrink-0', m.online ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {error}</p>}
          {success && <p className="text-xs text-emerald-400">{success}</p>}
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          >
            {disconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Disconnect
          </button>
        </div>
      )}
    </section>
  )
}

// ── Server admin card ──────────────────────────────────────────────────────────

function AdminCard() {
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null)
  const [adminMembers, setAdminMembers] = useState<AdminMember[]>([])
  const [loading, setLoading] = useState(true)

  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ ok?: string; err?: string } | null>(null)

  const [teamName, setTeamName] = useState('')
  const [maxMembers, setMaxMembers] = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const [configMsg, setConfigMsg] = useState<{ ok?: string; err?: string } | null>(null)

  const [migrateDir, setMigrateDir] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [migrateMsg, setMigrateMsg] = useState<{ ok?: string; err?: string } | null>(null)

  const [restarting, setRestarting] = useState(false)
  const [restartConfirm, setRestartConfirm] = useState(false)

  async function reload() {
    try {
      const [status, members] = await Promise.all([api.admin.status(), api.admin.listMembers()])
      setAdminStatus(status)
      setAdminMembers(members)
      setTeamName(status.team_name || '')
      setMaxMembers(String(status.member_count || ''))
    } catch {
      // server mode may not be active
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  async function handlePasswordChange() {
    if (!newPassword.trim()) return
    if (newPassword !== newPasswordConfirm) {
      setPasswordMsg({ err: 'Passwords do not match.' })
      return
    }
    setPasswordSaving(true)
    setPasswordMsg(null)
    try {
      await api.admin.setPassword(newPassword)
      setPasswordMsg({ ok: 'Password changed.' })
      setNewPassword('')
      setNewPasswordConfirm('')
    } catch (e: unknown) {
      setPasswordMsg({ err: e instanceof Error ? e.message : 'Failed.' })
    } finally {
      setPasswordSaving(false)
    }
  }

  async function handleConfigSave() {
    setConfigSaving(true)
    setConfigMsg(null)
    try {
      await api.admin.updateConfig({
        team_name: teamName || undefined,
        max_members: maxMembers ? parseInt(maxMembers, 10) : undefined,
      })
      setConfigMsg({ ok: 'Config saved.' })
      void reload()
    } catch (e: unknown) {
      setConfigMsg({ err: e instanceof Error ? e.message : 'Failed.' })
    } finally {
      setConfigSaving(false)
    }
  }

  async function handleMigrate() {
    if (!migrateDir.trim()) return
    setMigrating(true)
    setMigrateMsg(null)
    try {
      const res = await api.admin.migrateData(migrateDir.trim())
      setMigrateMsg({ ok: `Migrated to ${res.new_data_dir}` })
      setMigrateDir('')
    } catch (e: unknown) {
      setMigrateMsg({ err: e instanceof Error ? e.message : 'Failed.' })
    } finally {
      setMigrating(false)
    }
  }

  async function handleRestart() {
    if (!restartConfirm) { setRestartConfirm(true); return }
    setRestarting(true)
    try {
      await api.admin.restartServer()
    } finally {
      setRestarting(false)
      setRestartConfirm(false)
    }
  }

  async function handleKick(userId: string) {
    try {
      await api.admin.kickMember(userId)
      void reload()
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <section className="bg-card rounded-lg border border-border p-5 flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading server status…
      </section>
    )
  }

  if (!adminStatus) return null

  const uptimeH = Math.floor(adminStatus.uptime_seconds / 3600)
  const uptimeM = Math.floor((adminStatus.uptime_seconds % 3600) / 60)
  const uptimeStr = uptimeH > 0 ? `${uptimeH}h ${uptimeM}m` : `${uptimeM}m`

  return (
    <div className="space-y-4">
      {/* Server status */}
      <section className="bg-card rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4" />
          <h2 className="text-sm font-medium">Server Status</h2>
          <button onClick={reload} className="ml-auto text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Team Name</span>
            <span className="font-medium">{adminStatus.team_name || '—'}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Uptime</span>
            <span className="font-medium">{uptimeStr}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Team Port</span>
            <span className="font-medium">{adminStatus.team_port}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">API Port</span>
            <span className="font-medium">{adminStatus.api_port}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Data Directory</span>
            <span className="font-medium text-xs break-all">{adminStatus.data_dir}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Config Version</span>
            <span className="font-medium">{adminStatus.config_version}</span>
          </div>
        </div>

        {/* Connected members */}
        {adminMembers.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Members</p>
            <div className="space-y-1.5">
              {adminMembers.map((m) => {
                const color = memberColor(m)
                const initials = memberInitials(m.display_name || m.user_id)
                return (
                  <div key={m.user_id} className="flex items-center gap-2.5">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0"
                      style={{ backgroundColor: `hsl(${color})` }}
                    >
                      {initials}
                    </span>
                    <span className="text-sm truncate flex-1">{m.display_name || m.user_id}</span>
                    <span className={cn('h-2 w-2 rounded-full shrink-0', m.online ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
                    {m.online && (
                      <button
                        onClick={() => handleKick(m.user_id)}
                        className="text-xs text-red-400 hover:text-red-300 shrink-0"
                        title="Kick member"
                      >
                        Kick
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Config editor */}
      <section className="bg-card rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4" />
          <h2 className="text-sm font-medium">Server Config</h2>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Team Name</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Team"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Max Members</label>
            <input
              type="number"
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              placeholder="20"
              min={1}
              max={100}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {configMsg?.ok && <p className="text-xs text-emerald-400">{configMsg.ok}</p>}
          {configMsg?.err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{configMsg.err}</p>}
          <button
            onClick={handleConfigSave}
            disabled={configSaving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {configSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Config
          </button>
        </div>
      </section>

      {/* Change password */}
      <section className="bg-card rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4" />
          <h2 className="text-sm font-medium">Change Password</h2>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Confirm Password</label>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              placeholder="Confirm password"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {passwordMsg?.ok && <p className="text-xs text-emerald-400">{passwordMsg.ok}</p>}
          {passwordMsg?.err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{passwordMsg.err}</p>}
          <button
            onClick={handlePasswordChange}
            disabled={passwordSaving || !newPassword}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          >
            {passwordSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Change Password
          </button>
        </div>
      </section>

      {/* Export project */}
      <section className="bg-card rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4" />
          <h2 className="text-sm font-medium">Export Project</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Download a ZIP archive containing <code className="text-foreground">project.json</code> and <code className="text-foreground">pandora.db</code>.
          Use this to migrate the server or create a backup.
        </p>
        <a
          href={api.admin.exportProjectUrl()}
          download="pandorabox-project.zip"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
        >
          <Download className="w-3.5 h-3.5" />
          Download ZIP
        </a>
      </section>

      {/* Migrate data dir */}
      <section className="bg-card rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4" />
          <h2 className="text-sm font-medium">Migrate Data Directory</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Move the server's data to a new directory path. Current: <code className="text-foreground">{adminStatus.data_dir}</code>
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">New Path</label>
          <input
            type="text"
            value={migrateDir}
            onChange={(e) => setMigrateDir(e.target.value)}
            placeholder="/new/data/path"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {migrateMsg?.ok && <p className="text-xs text-emerald-400">{migrateMsg.ok}</p>}
        {migrateMsg?.err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{migrateMsg.err}</p>}
        <button
          onClick={handleMigrate}
          disabled={migrating || !migrateDir.trim()}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
        >
          {migrating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Migrate
        </button>
      </section>

      {/* Restart server */}
      <section className="bg-card rounded-lg border border-red-500/20 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-medium text-red-400">Restart Server</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Gracefully restarts the team server process. All connected clients will be disconnected briefly and will auto-reconnect.
        </p>
        {restartConfirm && (
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Click again to confirm restart.
          </p>
        )}
        <button
          onClick={handleRestart}
          disabled={restarting}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50',
            restartConfirm
              ? 'bg-red-500/80 text-white hover:bg-red-500'
              : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
          )}
        >
          {restarting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {restartConfirm ? 'Confirm Restart' : 'Restart Server'}
        </button>
      </section>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export function TeamSettings() {
  const isServerMode = useTeamStore((s) => s.isServerMode)

  return (
    <div className="space-y-5">
      <ConnectionCard />
      {isServerMode && <AdminCard />}
    </div>
  )
}
