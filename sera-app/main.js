// 오늘 밤은 Electron 껍데기 — 디스크·시간 때문에 (결정 87·88, teams/dev/out/floating-sera-approach.md).
// 화면(index.html·app.js·style.css)은 Tauri 뼈대와 그대로 같이 쓴다 — 서버 계약도 안 바꾼다.
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 220,
    height: 280,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,   // 없으면 투명 배경에 네모 그림자가 생긴다.
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
