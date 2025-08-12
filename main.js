const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let ADC_LEN = 300;                 // ⬅ 가변
const ADC_CHANNELS = 8;
const BYTES_PER_SAMPLE = 2;
let FRAME_SIZE = ADC_LEN * ADC_CHANNELS * BYTES_PER_SAMPLE; // ⬅ 가변 반영

let win;
let port = null;
let acc = Buffer.alloc(0);
let sampleBase = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---- 유틸: 샘플 수 설정 ---- */
function setSamples(n) {
  let v = Number(n) | 0;
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > 32768) v = 32768; // 안전 상한 (원하면 조정)
  ADC_LEN = v;
  FRAME_SIZE = ADC_LEN * ADC_CHANNELS * BYTES_PER_SAMPLE;
  // 프레이밍 리셋
  acc = Buffer.alloc(0);
  sampleBase = 0;
  // 렌더러에 현재 파라미터 알림
  if (win && !win.isDestroyed()) {
    win.webContents.send('params', { samples: ADC_LEN, frameBytes: FRAME_SIZE });
  }
}

/* ---- 포트 목록 ---- */
ipcMain.handle('list-ports', async () => {
  const list = await SerialPort.list();
  return list.map(p => ({ path: p.path, friendlyName: p.friendlyName, manufacturer: p.manufacturer }));
});

/* ---- 포트 열기 ---- */
ipcMain.handle('open-port', async (_evt, { path, baudRate }) => {
  if (port && port.isOpen) {
    await new Promise(r => port.close(r));
    port = null;
  }
  return new Promise((resolve, reject) => {
    port = new SerialPort({ path, baudRate, autoOpen: true }, (err) => {
      if (err) {
        port = null;
        return reject(err.message);
      }
      acc = Buffer.alloc(0);
      sampleBase = 0;
      port.on('data', onSerialData);
      // 현재 파라미터도 즉시 통지
      setSamples(ADC_LEN);
      resolve('ok');
    });
  });
});

/* ---- 포트 닫기 ---- */
ipcMain.handle('close-port', async () => {
  if (!port) return 'noport';
  return new Promise((resolve) => {
    port.off('data', onSerialData);
    port.close(() => {
      port = null;
      acc = Buffer.alloc(0);
      resolve('closed');
    });
  });
});

/* ---- 샘플 수 설정 IPC ---- */
ipcMain.handle('set-samples', async (_evt, n) => {
  setSamples(n);
  return { samples: ADC_LEN, frameBytes: FRAME_SIZE };
});

function onSerialData(chunk) {
  acc = Buffer.concat([acc, chunk]);
  while (acc.length >= FRAME_SIZE) {
    const frame = acc.subarray(0, FRAME_SIZE);
    acc = acc.subarray(FRAME_SIZE);
    const rows = parseFrameToDiffRows(frame);
    if (win && !win.isDestroyed()) {
      win.webContents.send('frame', rows); // 최신 프레임만 교체 표시
    }
  }
}

// frame(Buffer) -> [ [x, ch1, ch2, ch3, ch4], ... ] (길이 = ADC_LEN)
function parseFrameToDiffRows(frame) {
  const rows = new Array(ADC_LEN);
  let off = 0;
  for (let i = 0; i < ADC_LEN; i++) {
    const a0 = frame.readUInt16LE(off); off += 2;
    const a1 = frame.readUInt16LE(off); off += 2;
    const a2 = frame.readUInt16LE(off); off += 2;
    const a3 = frame.readUInt16LE(off); off += 2;
    const a4 = frame.readUInt16LE(off); off += 2;
    const a5 = frame.readUInt16LE(off); off += 2;
    const a6 = frame.readUInt16LE(off); off += 2;
    const a7 = frame.readUInt16LE(off); off += 2;

    const ch1 = (a0|0) - (a1|0);
    const ch2 = (a2|0) - (a3|0);
    const ch3 = (a4|0) - (a5|0);
    const ch4 = (a6|0) - (a7|0);

    rows[i] = [sampleBase + i, ch1, ch2, ch3, ch4];
  }
  sampleBase += ADC_LEN;
  return rows;
}
