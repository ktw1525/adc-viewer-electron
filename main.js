// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let win;
let port = null;
let acc = Buffer.alloc(0);

// MCU 설정과 반드시 일치해야 함
const ADC_CHANNELS = 8;
const ADC_LEN = 300;
const BYTES_PER_SAMPLE = 2;
const FRAME_BYTES = ADC_CHANNELS * ADC_LEN * BYTES_PER_SAMPLE; // 4800
// 프레임 종단 마커(마지막 두 개의 uint16_t가 0xFFFF,0xFFFF)
const MARKER = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);

// 안전 가드: 축적 버퍼 상한 (필요시 조정)
const MAX_ACC_BYTES = 8 * 1024 * 1024;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
    // devTools: true
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/** 포트 리스트 */
ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list();
  return ports.map(p => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    productId: p.productId,
    vendorId: p.vendorId
  }));
});

/** 포트 연결 */
ipcMain.handle('serial:open', async (e, { path, baudRate }) => {
  try {
    await closePort();

    port = new SerialPort({ path, baudRate, autoOpen: false });
    await new Promise((resolve, reject) => {
      port.open(err => (err ? reject(err) : resolve()));
    });

    acc = Buffer.alloc(0);

    port.on('data', onSerialData);
    port.on('error', (err) => {
      win?.webContents.send('serial:status', { type: 'error', message: String(err) });
    });
    port.on('close', () => {
      win?.webContents.send('serial:status', { type: 'closed' });
      port = null;
    });

    win?.webContents.send('serial:status', { type: 'open', path, baudRate });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** 포트 닫기 */
ipcMain.handle('serial:close', async () => {
  try {
    await closePort();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

function closePort() {
  return new Promise((resolve) => {
    if (!port) return resolve();
    try {
      port.removeAllListeners('data');
      port.close(() => resolve());
    } catch (_) {
      resolve();
    } finally {
      port = null;
    }
  });
}

/** 수신 처리: 마커 기반 프레임 추출(재동기화 내장) */
function onSerialData(chunk) {
  if (!chunk || chunk.length === 0) return;
  acc = Buffer.concat([acc, chunk]);

  if (acc.length > MAX_ACC_BYTES) {
    // 메모리 가드: 마지막 마커 이후만 보존
    const lastMarker = acc.lastIndexOf(MARKER);
    acc = lastMarker >= 0 ? acc.slice(lastMarker + MARKER.length) : Buffer.alloc(0);
    win?.webContents.send('serial:status', { type: 'warn', message: 'acc buffer trimmed' });
  }

  // 가능한 모든 프레임 추출
  while (true) {
    // 유효한 프레임의 마커는 최소 FRAME_BYTES 이후에 존재 가능
    const searchStart = Math.max(0, FRAME_BYTES - MARKER.length);
    const pos = acc.indexOf(MARKER, searchStart);
    if (pos === -1) break;

    // pos는 마커 시작 인덱스, 그 앞 FRAME_BYTES가 페이로드여야 함
    const start = pos - FRAME_BYTES;
    if (start < 0) {
      // 마커가 너무 이른 경우 -> 이 마커를 넘기고 다시 탐색
      acc = acc.slice(pos + MARKER.length);
      continue;
    }

    // 페이로드 추출
    const framePayload = acc.slice(start, pos); // 4800 bytes
    // 소비: 페이로드 + 마커
    acc = acc.slice(pos + MARKER.length);

    // 렌더러로 전달 (Buffer 그대로 보냄)
    win?.webContents.send('serial:frame', framePayload);
  }
}
