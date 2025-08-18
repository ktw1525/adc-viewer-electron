// main.js
// 메인 프로세스: 시리얼 포트 검색/연결, 데이터 파싱(배치), 렌더러로 IPC 전송

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

let win;
let port = null;
let parser = null;

// 퍼포먼스: 데이터 누락 없이 전달하되 IPC 과부하를 막기 위해
// 짧은 주기로 배치 전송(모든 샘플 포함)
const batch = [];
let batchTimer = null;
const BATCH_INTERVAL_MS = 5;        // 5ms마다 한 번에 푸시
const MAX_BACKLOG = 200000;         // 비정상적 누적 방지 (디버그용)

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 보안 설정
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (port && port.isOpen) {
    try { port.close(); } catch (e) {}
  }
  if (process.platform !== 'darwin') app.quit();
});

// 시리얼 포트 목록
ipcMain.handle('serial:list', async () => {
  const list = await SerialPort.list();
  return list.map(p => ({
    path: p.path,
    manufacturer: p.manufacturer || '',
    serialNumber: p.serialNumber || '',
    friendly: `${p.path}${p.manufacturer ? ' ('+p.manufacturer+')' : ''}`
  }));
});

// 연결
ipcMain.handle('serial:connect', async (e, { path: devicePath, baudRate }) => {
  if (port && port.isOpen) {
    return { ok: false, error: '이미 연결되어 있습니다.' };
  }
  try {
    port = new SerialPort({ path: devicePath, baudRate: Number(baudRate) || 115200 });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' })); // MCU가 \n으로 끝남

    // 안전한 배치 타이머
    if (!batchTimer) {
      batchTimer = setInterval(() => {
        if (batch.length > 0 && win) {
          // 모든 샘플을 빠짐없이 보냄
          // [{t:number, v:[ch0,ch1,ch2,ch3]}, ...]
          win.webContents.send('serial:samples', batch.splice(0, batch.length));
        }
      }, BATCH_INTERVAL_MS);
    }

    // 라인 파싱: "d, d, d, d"
    parser.on('data', (line) => {
      // 과도한 백로그 방지 (표시가 너무 느리면 알림)
      if (batch.length > MAX_BACKLOG) {
        win?.webContents.send('serial:warning', '표시 지연 누적 중 (데이터는 누락 없이 쌓이는 중). 샘플 길이를 줄이거나 트리거 모드를 활용하세요.');
      }

      // 빠른 파싱(정규식 지양)
      // 예상 포맷: "123, -45, 67, 0"
      let a = 0, b = 0, c = 0, d = 0;
      try {
        const parts = line.trim().split(',');
        if (parts.length >= 4) {
          a = parseInt(parts[0], 10);
          b = parseInt(parts[1], 10);
          c = parseInt(parts[2], 10);
          d = parseInt(parts[3], 10);
          if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
            batch.push({ t: Date.now(), v: [a, b, c, d] });
          }
        }
      } catch (err) {
        // 파싱 실패는 무시(잡음 라인)
      }
    });

    port.on('open', () => {
      win?.webContents.send('serial:status', { connected: true, path: devicePath, baudRate });
    });

    port.on('close', () => {
      win?.webContents.send('serial:status', { connected: false });
    });

    port.on('error', (err) => {
      win?.webContents.send('serial:error', String(err));
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// 해제
ipcMain.handle('serial:disconnect', async () => {
  if (!port) return { ok: true };
  try {
    if (parser) {
      parser.removeAllListeners();
      parser = null;
    }
    await new Promise((resolve) => {
      port.close(() => resolve());
    });
    port = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
