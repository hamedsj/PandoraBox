export {}

declare global {
  interface Window {
    electron?: {
      openFolder: () => Promise<string | null>
      newFolder: () => Promise<string | null>
      decodeBody?: (
        base64: string,
        encoding: string
      ) => Promise<{ base64?: string; error?: string }>
      getCliStatus?: () => Promise<{ installed: boolean; path: string }>
      installCli?: () => Promise<{
        ok: boolean
        path?: string
        error?: string
        manualCommand?: string
        restartShell?: boolean
      }>
    }
  }
}
