// renderer.js

const api = window.scopeAPI;

// MCU/프로토콜 상수
const ADC_CHANNELS = 8;
const ADC_LEN = 300;
const BYTES_PER_SAMPLE = 2;
const FRAME_BYTES = ADC_CHANNELS * ADC_LEN * BYTES_PER_SAMPLE; // 4800

// 캔버스 세팅
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 0, H = 0;
function resize() {
  const rect = canvas.getBoundingClientRect();
  W = canvas.width = Math.floor(rect.width * devicePixelRatio);
  H = canvas.height = Math.floor(rect.height * devicePixelRatio);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// UI 요소
const portList = document.getElementById('portList');
const baudSel = document.getElementById('baud');
const btnRefresh = document.getElementById('btnRefresh');
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const statusEl = document.getElementById('status');

const trigSourceEl = document.getElementById('trigSource');
const trigLevelEl = document.getElementById('trigLevel');
const trigLevelVal = document.getElementById('trigLevelVal');
const trigPosEl = document.getElementById('trigPos');
const btnArm = document.getElementById('btnArm');

const dispLenEl = document.getElementById('dispLen');
const dispLenVal = document.getElementById('dispLenVal');
const vScaleEl = document.getElementById('vScale');
const vScaleVal = document.getElementById('vScaleVal');

const off1 = document.getElementById('off1');
const off2 = document.getElementById('off2');
const off3 = document.getElementById('off3');
const off4 = document.getElementById('off4');
const off1Val = document.getElementById('off1Val');
const off2Val = document.getElementById('off2Val');
const off3Val = document.getElementById('off3Val');
const off4Val = document.getElementById('off4Val');

function getTrigMode() {
  return document.querySelector('input[name="trigMode"]:checked').value; // auto|normal|single
}
function getTrigEdge() {
  return document.querySelector('input[name="trigEdge"]:checked').value; // rising|falling
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.style.color = cls === 'err' ? '#ff6e6e' : cls === 'warn' ? '#ffb74d' : '#a0b3c0';
}

// 포트 리스트 로딩
async function loadPorts() {
  const ports = await api.listPorts();
  portList.innerHTML = '';
  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = `${p.path} ${p.manufacturer || ''}`;
    portList.appendChild(opt);
  });
  if (ports.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(사용 가능한 포트 없음)';
    portList.appendChild(opt);
  }
}
btnRefresh.addEventListener('click', loadPorts);
loadPorts();

// 연결/해제
btnConnect.addEventListener('click', async () => {
  const path = portList.value;
  const baudRate = parseInt(baudSel.value, 10) || 921600;
  if (!path) return setStatus('포트를 선택하세요', 'warn');
  const r = await api.open({ path, baudRate });
  if (!r.ok) {
    setStatus(`연결 실패: ${r.error}`, 'err');
  } else {
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
  }
});

btnDisconnect.addEventListener('click', async () => {
  const r = await api.close();
  if (!r.ok) setStatus(`해제 실패: ${r.error}`, 'err');
});

// 상태 이벤트
api.onStatus((msg) => {
  if (msg.type === 'open') {
    setStatus(`연결됨: ${msg.path} @ ${msg.baudRate}`, '');
  } else if (msg.type === 'closed') {
    setStatus('해제됨', 'warn');
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
  } else if (msg.type === 'error') {
    setStatus(`에러: ${msg.message}`, 'err');
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
  } else if (msg.type === 'warn') {
    setStatus(`경고: ${msg.message}`, 'warn');
  }
});

// ========= 데이터 구조(링버퍼) =========
// 차동 4채널을 샘플 단위로 저장
const RING_CAP = 240000; // 약 13.3초@18kS/s
const ring = {
  ch: [
    new Int16Array(RING_CAP),
    new Int16Array(RING_CAP),
    new Int16Array(RING_CAP),
    new Int16Array(RING_CAP)
  ],
  w: 0, // write index(순환)
  n: 0  // 유효 길이 (최대 RING_CAP)
};

function pushSamples(ch1, ch2, ch3, ch4) {
  const n = ch1.length;
  for (let i = 0; i < n; i++) {
    const idx = ring.w;
    ring.ch[0][idx] = ch1[i];
    ring.ch[1][idx] = ch2[i];
    ring.ch[2][idx] = ch3[i];
    ring.ch[3][idx] = ch4[i];
    ring.w = (ring.w + 1) % RING_CAP;
  }
  ring.n = Math.min(RING_CAP, ring.n + n);
}

// ========= 프레임 파서(렌더러 측 차동 계산) =========
api.onFrame((frameBuf) => {
  // frameBuf는 4800 bytes (300*8*2)
  if (!frameBuf || frameBuf.length !== FRAME_BYTES) return;

  // DataView로 리틀엔디언 UInt16 읽기
  const dv = new DataView(frameBuf.buffer, frameBuf.byteOffset, frameBuf.byteLength);
  const ch1 = new Int16Array(ADC_LEN);
  const ch2 = new Int16Array(ADC_LEN);
  const ch3 = new Int16Array(ADC_LEN);
  const ch4 = new Int16Array(ADC_LEN);

  // 차동 계산: ch1=0-1, ch2=2-3, ch3=4-5, ch4=6-7
  // 원데이터는 0..4095(또는 12~16bit) 범위일 가능성 -> JS number에서 안전
  for (let i = 0; i < ADC_LEN; i++) {
    const base = i * ADC_CHANNELS * BYTES_PER_SAMPLE;
    const a0 = dv.getUint16(base + 0, true);
    const a1 = dv.getUint16(base + 2, true);
    const a2 = dv.getUint16(base + 4, true);
    const a3 = dv.getUint16(base + 6, true);
    const a4 = dv.getUint16(base + 8, true);
    const a5 = dv.getUint16(base + 10, true);
    const a6 = dv.getUint16(base + 12, true);
    const a7 = dv.getUint16(base + 14, true);

    ch1[i] = (a0 - a1) | 0;
    ch2[i] = (a2 - a3) | 0;
    ch3[i] = (a4 - a5) | 0;
    ch4[i] = (a6 - a7) | 0;
  }

  pushSamples(ch1, ch2, ch3, ch4);
});

// ========= 트리거/표시 파이프라인 =========
let singleArmed = false;

btnArm.addEventListener('click', () => {
  singleArmed = true;
});

function readUI() {
  return {
    dispLen: parseInt(dispLenEl.value, 10) || 300,
    vScale: parseFloat(vScaleEl.value) || 1.0,
    trigSource: parseInt(trigSourceEl.value, 10) || 0,
    trigLevel: parseInt(trigLevelEl.value, 10) || 0,
    trigPosPct: parseInt(trigPosEl.value, 10) || 25,
    trigMode: getTrigMode(),
    trigEdge: getTrigEdge(),
    offY: [
      parseInt(off1.value, 10) || 0,
      parseInt(off2.value, 10) || 0,
      parseInt(off3.value, 10) || 0,
      parseInt(off4.value, 10) || 0
    ]
  };
}

function updateLabels() {
  dispLenVal.textContent = String(dispLenEl.value);
  vScaleVal.textContent = `${parseFloat(vScaleEl.value).toFixed(1)}x`;
  trigLevelVal.textContent = String(trigLevelEl.value);
  off1Val.textContent = String(off1.value);
  off2Val.textContent = String(off2.value);
  off3Val.textContent = String(off3.value);
  off4Val.textContent = String(off4.value);
}
[dispLenEl, vScaleEl, trigLevelEl, off1, off2, off3, off4].forEach(el => el.addEventListener('input', updateLabels));
updateLabels();

// 트리거 판정: crossing 인덱스 검색 (윈도우 범위)
function findTriggerIndex(ch, start, end, level, edge /* 'rising'|'falling' */) {
  if (end - start < 2) return -1;
  if (edge === 'rising') {
    for (let i = start + 1; i <= end; i++) {
      const p = ch[idx(i - 1)];
      const c = ch[idx(i)];
      if (p < level && c >= level) return i;
    }
  } else {
    for (let i = start + 1; i <= end; i++) {
      const p = ch[idx(i - 1)];
      const c = ch[idx(i)];
      if (p > level && c <= level) return i;
    }
  }
  return -1;
}

// 링버퍼의 실제 인덱스로 변환
function idx(i /* global index */) {
  // i가 음수거나 크게 넘어가도 순환
  i %= RING_CAP;
  if (i < 0) i += RING_CAP;
  return i;
}

// 미니멈-맥스 다운샘플링(안티앨리어싱)
function downsampleMinMax(src, startIdx, count, targetCount) {
  if (targetCount <= 0) return [];
  const out = new Int16Array(targetCount * 2); // [min,max] 쌍들
  const step = count / targetCount;
  let o = 0;
  for (let k = 0; k < targetCount; k++) {
    const s = startIdx + Math.floor(k * step);
    const e = startIdx + Math.floor((k + 1) * step);
    let min = 32767, max = -32768;
    for (let i = s; i < e; i++) {
      const v = src[idx(i)];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (e <= s) {
      const v = src[idx(s)];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    out[o++] = min;
    out[o++] = max;
  }
  return out;
}

// 색상 팔레트
const COLORS = ['#6aa4ff', '#9f6aff', '#49d17d', '#ffb74d'];

// 메인 루프
function loop() {
  requestAnimationFrame(loop);

  const p = readUI();

  // 유효 샘플 부족 시 화면 클리어
  if (ring.n < 2) {
    clear();
    return;
  }

  // 표시 범위
  const dispN = Math.min(p.dispLen, ring.n);
  const endGlobal = ring.w - 1;
  let startGlobal = endGlobal - dispN + 1;

  // 트리거
  const tSrc = ring.ch[p.trigSource];
  const trigPosIndex = Math.floor((p.trigPosPct / 100) * dispN);

  // 현재 윈도우에서 트리거 탐색
  let trigIndex = findTriggerIndex(tSrc, startGlobal, endGlobal, p.trigLevel, p.trigEdge);

  if (p.trigMode === 'auto') {
    // 트리거가 있으면 트리거 위치 정렬, 없으면 최신 윈도우 그대로
    if (trigIndex >= 0) {
      startGlobal = trigIndex - trigPosIndex;
    }
    drawScene(startGlobal, dispN, p, trigIndex);
  } else if (p.trigMode === 'normal') {
    // 트리거 있을 때만 화면 갱신
    if (trigIndex >= 0) {
      startGlobal = trigIndex - trigPosIndex;
      drawScene(startGlobal, dispN, p, trigIndex);
    } // else 홀드
  } else { // single
    if (singleArmed) {
      if (trigIndex >= 0) {
        startGlobal = trigIndex - trigPosIndex;
        drawScene(startGlobal, dispN, p, trigIndex);
        singleArmed = false;
      }
    } // else 홀드
  }
}

function clear() {
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, W, H);
}

function drawGrid() {
  clear();
  // 격자
  ctx.strokeStyle = '#2a2f3e';
  ctx.lineWidth = 1;
  const dx = Math.floor(W / 10);
  const dy = Math.floor(H / 10);
  ctx.beginPath();
  for (let x = 0; x <= W; x += dx) {
    ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H);
  }
  for (let y = 0; y <= H; y += dy) {
    ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5);
  }
  ctx.stroke();
}

function yOf(v /* sample value */, vScale, offPx) {
  // 값이 클수록 위로 가도록 Y축 반전
  const mid = H / 2;
  return (mid - v * vScale) + offPx * devicePixelRatio;
}

function drawScene(startGlobal, dispN, p, trigIndex) {
  drawGrid();

  // 다운샘플링 포인트 수(픽셀 수만큼)
  const pts = Math.max(1, Math.min(W, dispN));
  const ds = ring.ch.map(ch => downsampleMinMax(ch, startGlobal, dispN, pts));

  // 각 채널 그리기
  for (let ch = 0; ch < 4; ch++) {
    const col = COLORS[ch];
    const isTrig = (ch === p.trigSource);
    ctx.lineWidth = isTrig ? 2.0 : 1.4;
    ctx.strokeStyle = col;
    ctx.fillStyle = col + '33';

    const strip = ds[ch]; // [min,max] 쌍
    ctx.beginPath();
    // min-max 구간을 폴리라인으로 렌더(캔들형태)
    for (let i = 0, x = 0; i < strip.length; i += 2, x++) {
      const min = strip[i + 0];
      const max = strip[i + 1];
      const y1 = yOf(min, p.vScale, [p.offY[0], p.offY[1], p.offY[2], p.offY[3]][ch]);
      const y2 = yOf(max, p.vScale, [p.offY[0], p.offY[1], p.offY[2], p.offY[3]][ch]);
      const xx = x + 0.5;
      ctx.moveTo(xx, y1);
      ctx.lineTo(xx, y2);
    }
    ctx.stroke();
  }

  // 트리거 수직 점선
  const trigX = Math.floor((p.trigPosPct / 100) * W) + 0.5;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#c6d2f055';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(trigX, 0);
  ctx.lineTo(trigX, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // 트리거 수평 점선(소스 채널 기준)
  const trigY = yOf(p.trigLevel, p.vScale, p.offY[p.trigSource]);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#c6d2f055';
  ctx.beginPath();
  ctx.moveTo(0, trigY + 0.5);
  ctx.lineTo(W, trigY + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // 트리거 채널 하이라이트 라벨
  ctx.fillStyle = COLORS[p.trigSource];
  ctx.font = `${12 * devicePixelRatio}px sans-serif`;
  ctx.fillText(`TRIG: CH${p.trigSource + 1} ${p.trigEdge} @ ${p.trigLevel}`, 10, 16 * devicePixelRatio);
}

// 루프 시작
loop();
