const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

const ADC_LEN = 300;
const ADC_CHANNELS = 8;
const FRAME_SIZE = ADC_LEN * ADC_CHANNELS * 2; // 4800 bytes

let win;
let port = null;
let acc = Buffer.alloc(0); // 누적 버퍼
let sampleBase = 0;        // x축 인덱스(원하면 time축으로 바꿔도 됨)

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

/* === IPC: 포트 나열 === */
ipcMain.handle('list-ports', async () => {
  const list = await SerialPort.list();
  // 유용한 필드만 추려서 반환
  return list.map(p => ({ path: p.path, friendlyName: p.friendlyName, manufacturer: p.manufacturer }));
});

/* === IPC: 포트 열기 === */
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
      // 데이터 수신 핸들러
      port.on('data', onSerialData);
      resolve('ok');
    });
  });
});

/* === IPC: 포트 닫기 === */
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

function onSerialData(chunk) {
  acc = Buffer.concat([acc, chunk]);
  // 프레임 단위로 처리
  while (acc.length >= FRAME_SIZE) {
    const frame = acc.subarray(0, FRAME_SIZE);
    acc = acc.subarray(FRAME_SIZE);
    const rows = parseFrameToDiffRows(frame);
    // 최신 프레임만 표시: 통째로 교체
    if (win && !win.isDestroyed()) {
      win.webContents.send('frame', rows);
    }
  }
}

// frame(Buffer 4800B) -> [ [x, ch1, ch2, ch3, ch4], ... ] 300행
function parseFrameToDiffRows(frame) {
  const rows = new Array(ADC_LEN);
  let off = 0;
  for (let i = 0; i < ADC_LEN; i++) {
    // 8채널 uint16 LE 읽기
    const a0 = frame.readUInt16LE(off); off += 2;
    const a1 = frame.readUInt16LE(off); off += 2;
    const a2 = frame.readUInt16LE(off); off += 2;
    const a3 = frame.readUInt16LE(off); off += 2;
    const a4 = frame.readUInt16LE(off); off += 2;
    const a5 = frame.readUInt16LE(off); off += 2;
    const a6 = frame.readUInt16LE(off); off += 2;
    const a7 = frame.readUInt16LE(off); off += 2;

    // 차분 4채널
    const ch1 = (a0|0) - (a1|0);
    const ch2 = (a2|0) - (a3|0);
    const ch3 = (a4|0) - (a5|0);
    const ch4 = (a6|0) - (a7|0);

    rows[i] = [sampleBase + i, ch1, ch2, ch3, ch4];
  }
  sampleBase += ADC_LEN;
  return rows;
}
