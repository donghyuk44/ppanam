// 오늘 밤은 Electron 껍데기 — 디스크·시간 때문에 (결정 87·88, teams/dev/out/floating-sera-approach.md).
// 화면(index.html·app.js·style.css)은 Tauri 뼈대와 그대로 같이 쓴다 — 서버 계약도 안 바꾼다.
const { app, BrowserWindow, screen } = require('electron');

const W = 220;
const H = 280;
const MARGIN = 24;

function createWindow() {
  // 화면 오른쪽 위 — 메뉴 막대 밑. 작업 영역 기준이라 독·메뉴 막대를 안 가린다.
  const area = screen.getPrimaryDisplay().workArea;

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: area.x + area.width - W - MARGIN,
    y: area.y + MARGIN,
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

  // alwaysOnTop 만으로는 모자란다 — 대표가 공간(Space)을 옮기거나 전체 화면으로 가면 세라가 사라진다.
  // 이 두 줄이 "늘 보인다" 를 실제로 만든다.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'floating');

  win.loadFile('index.html');
  return win;
}

app.whenReady().then(() => {
  createWindow();
  // 독 아이콘을 안 띄운다 — 떠 있는 비서지 앱이 아니다.
  if (app.dock) app.dock.hide();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
