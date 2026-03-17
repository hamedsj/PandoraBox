const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')
const zlib = require('zlib')

let mainWindow = null
let tray = null
let backendProcess = null

// Find the Go binary - in packaged app it's in resources/, in dev it's in ../bin/
function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pandorabox')
  }
  // In dev: repo root bin/pandorabox
  return path.join(__dirname, '../../bin/pandorabox')
}

function startBackend() {
  const binaryPath = getBackendPath()

  // Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    console.error('Backend binary not found at:', binaryPath)
    return
  }

  backendProcess = spawn(binaryPath, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backendProcess.stdout.on('data', (data) => {
    console.log('[backend]', data.toString().trim())
  })
  backendProcess.stderr.on('data', (data) => {
    console.error('[backend]', data.toString().trim())
  })
  backendProcess.on('exit', (code) => {
    console.log('[backend] exited with code', code)
  })
}

function waitForBackend(retries = 30) {
  return new Promise((resolve, reject) => {
    function check(n) {
      const req = http.get('http://localhost:7777/api/proxy/status', (res) => {
        resolve()
      })
      req.on('error', () => {
        if (n <= 0) {
          reject(new Error('Backend did not start in time'))
          return
        }
        setTimeout(() => check(n - 1), 500)
      })
      req.end()
    }
    check(retries)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111318',
    // 'default' gives a standard native title bar with traffic lights sitting
    // above the web content — they can never overlap the UI.
    titleBarStyle: 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  })

  mainWindow.loadURL('http://localhost:7777')

  // Maximize on ready to fill screen
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // On macOS, keep app running when window is closed
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  // Use a simple 16x16 template image or a bundled icon
  const iconPath = path.join(__dirname, 'icons', 'tray.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('empty')
  } catch {
    // Fallback: create a tiny programmatic icon
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('PandoraBox')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PandoraBox',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal('http://localhost:7777'),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// IPC handlers for native folder dialogs
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return result.filePaths[0] ?? null
})

ipcMain.handle('dialog:newFolder', async () => {
  const result = await dialog.showSaveDialog({
    properties: ['createDirectory'],
    buttonLabel: 'Create Project Here',
  })
  return result.filePath ?? null
})

ipcMain.handle('body:decode', async (_event, payload) => {
  const source = Buffer.from(payload.base64, 'base64')
  const encodings = String(payload.encoding || '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  try {
    let decoded = source

    for (const encoding of encodings.reverse()) {
      if (encoding === 'identity') {
        continue
      }

      if (encoding === 'br') {
        decoded = zlib.brotliDecompressSync(decoded)
        continue
      }

      if (encoding === 'gzip' || encoding === 'x-gzip') {
        decoded = zlib.gunzipSync(decoded)
        continue
      }

      if (encoding === 'deflate') {
        decoded = zlib.inflateSync(decoded)
        continue
      }

      if (encoding === 'zstd') {
        if (typeof zlib.zstdDecompressSync !== 'function') {
          throw new Error('Zstandard decoding is unavailable in this Electron runtime')
        }
        decoded = zlib.zstdDecompressSync(decoded)
        continue
      }

      throw new Error(`Unsupported content-encoding: ${encoding}`)
    }

    return { base64: decoded.toString('base64') }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to decode body',
    }
  }
})

app.whenReady().then(async () => {
  startBackend()

  try {
    await waitForBackend()
  } catch (e) {
    console.error('Backend failed to start:', e)
  }

  createTray()
  createWindow()

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
})
