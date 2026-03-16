const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const fs = require('fs')

let mainWindow = null
let tray = null
let backendProcess = null

// Find the Go binary - in packaged app it's in resources/, in dev it's in ../bin/
function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pitokmonitor')
  }
  // In dev: repo root bin/pitokmonitor
  return path.join(__dirname, '../../bin/pitokmonitor')
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
  tray.setToolTip('PitokMonitor')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PitokMonitor',
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
