// renderer.js
// 렌더러: 수신 버퍼(누락 없음) -> 트리거 윈도우링 -> 캔버스 드로잉

const api = window.oscAPI;
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

const portSelect = document.getElementById('port-select');
const refreshBtn = document.getElementById('refresh');
const connectBtn = document.getElementById('connect');
const disconnectBtn = document.getElementById('disconnect');
const baudInput = document.getElementById('baud');
const statusSpan = document.getElementById('conn-status');

const sampleLenRange = document.getElementById('sampleLen');
const sampleLenVal = document.getElementById('sampleLenVal');
const trigPosRange = document.getElementById('trigPos');
const trigPosVal = document.getElementById('trigPosVal');
const trigSourceSel = document.getElementById('trigSource');
const trigEdgeSel = document.getElementById('trigEdge');
const trigLevelInput = document.getElementById('trigLevel');

const modeRadios = [...document.querySelectorAll('input[name="mode"]')];
const singleArmBtn = document.getElementById('singleArm');
const runStopBtn = document.getElementById('runStop');

const chVisChecks = [...document.querySelectorAll('.chVis')];
const chOffRanges = [...document.querySelectorAll('.chOff')];
const msgDiv = document.getElementById('msg');

let connected = false;
let running = true;     // Run/Stop
let singleArmed = false;

// ----------- 수신 링 버퍼(모든 샘플 저장) -----------
class Ring {
  constructor(cap) {
    this.cap = cap;
    this.buf = new Float32Array(cap);
    this.head = 0;
    this.size = 0;
  }
  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }
  // idxFromEnd: 0=가장 최근, 1=그 이전...
  getFromEnd(idxFromEnd) {
    if (this.size === 0) return 0;
    if (idxFromEnd >= this.size) idxFromEnd = this.size - 1;
    let pos = (this.head - 1 - idxFromEnd);
    if (pos < 0) pos += this.cap;
    return this.buf[pos];
  }
}

const CAP = 200000; // 20만 샘플 * 4채널 ~= 3.2MB
const rings = [new Ring(CAP), new Ring(CAP), new Ring(CAP), new Ring(CAP)];

// IPC 수신: 모든 샘플 누락 없이 링에 적재
api.onSamples((batch) => {
  for (const s of batch) {
    const v = s.v;
    rings[0].push(v[0]);
    rings[1].push(v[1]);
    rings[2].push(v[2]);
    rings[3].push(v[3]);
  }
});

api.onStatus((s) => {
  connected = s.connected;
  statusSpan.textContent = s.connected ? `연결됨: ${s.path} @${s.baudRate}` : '연결 안 됨';
});

api.onWarning((w) => { msgDiv.textContent = w; });
api.onError((e) => { msgDiv.textContent = `에러: ${e}`; });

// ----------- UI 동작 -----------
async function refreshPorts() {
  const list = await api.listPorts();
  portSelect.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.friendly;
    portSelect.appendChild(opt);
  }
}
refreshBtn.addEventListener('click', refreshPorts);
window.addEventListener('load', refreshPorts);

connectBtn.addEventListener('click', async () => {
  const path = portSelect.value;
  const baudRate = Number(baudInput.value) || 115200;
  const { ok, error } = await api.connect({ path, baudRate });
  if (!ok) msgDiv.textContent = `연결 실패: ${error}`;
});
disconnectBtn.addEventListener('click', async () => {
  await api.disconnect();
});

sampleLenRange.addEventListener('input', () => {
  sampleLenVal.textContent = sampleLenRange.value;
});
trigPosRange.addEventListener('input', () => {
  trigPosVal.textContent = trigPosRange.value + '%';
});

singleArmBtn.addEventListener('click', () => {
  singleArmed = true;
  msgDiv.textContent = 'Single 대기 중(트리거 발생 시 1회 캡처 후 정지).';
});
runStopBtn.addEventListener('click', () => {
  running = !running;
  msgDiv.textContent = running ? 'Run' : 'Stop';
});

function currentMode() {
  const r = modeRadios.find(r => r.checked);
  return r ? r.value : 'auto';
}

// 채널 표시/오프셋 상태
function isChVisible(i) {
  const c = chVisChecks.find(x => Number(x.dataset.ch) === i);
  return !!(c?.checked);
}
function chOffset(i) {
  const r = chOffRanges.find(x => Number(x.dataset.ch) === i);
  return Number(r?.value || 0);
}

// ----------- 트리거 & 드로잉 -----------
function computeMinMaxLastN(n, visMask) {
  let min = +Infinity, max = -Infinity;
  for (let i = 0; i < 4; i++) {
    if (!visMask[i]) continue;
    for (let k = 0; k < n; k++) {
      const v = rings[i].getFromEnd(k);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!isFinite(min) || !isFinite(max)) { min = -1; max = 1; }
  if (min === max) { min -= 1; max += 1; }
  return { min, max };
}

function findTriggerIndex(nSearch, level, rising, src) {
  // 최근 샘플부터 과거 방향으로 스캔하면서
  // prev < L && curr >= L (rising) 혹은 prev > L && curr <= L (falling) crossing 탐지
  // 반환: crossing이 발생한 최신 지점의 "끝에서부터의 인덱스"
  const ring = rings[src];
  const maxIdx = Math.min(nSearch, ring.size - 1);
  for (let i = 1; i <= maxIdx; i++) {
    const prev = ring.getFromEnd(i);
    const curr = ring.getFromEnd(i - 1);
    if (rising) {
      if (prev < level && curr >= level) return (i - 1);
    } else {
      if (prev > level && curr <= level) return (i - 1);
    }
  }
  return -1;
}

function drawGrid(w, h) {
  ctx.save();
  ctx.strokeStyle = '#222a33';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  // 수직/수평 그리드
  const gx = 10, gy = 8;
  for (let i = 1; i < gx; i++) {
    const x = Math.round((w * i) / gx);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 1; i < gy; i++) {
    const y = Math.round((h * i) / gy);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
}

function drawScope() {
  const W = canvas.width, H = canvas.height;

  // 캔버스 클리어 & 그리드
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, W, H);
  drawGrid(W, H);

  const n = Number(sampleLenRange.value) | 0;          // 표시 샘플 길이
  const hPerc = Number(trigPosRange.value) / 100;      // 트리거 위치(0~1)
  const preN = Math.max(1, Math.min(n - 2, Math.floor(n * hPerc)));
  const src = Number(trigSourceSel.value) | 0;
  const rising = (trigEdgeSel.value === 'rising');
  const mode = currentMode();
  const vis = [0,1,2,3].map(i => isChVisible(i));

  // 최근 n*2 구간에서 트리거 탐색(충분 여유)
  const searchWindow = Math.min(rings[src].size - 2, n * 2);

  // 트리거 레벨: 사용자가 숫자 입력(ADC 차분 단위)
  let trigLevel = Number(trigLevelInput.value);
  if (!Number.isFinite(trigLevel)) trigLevel = 0;

  let triggerIdxFromEnd = findTriggerIndex(searchWindow, trigLevel, rising, src);

  // Auto/Normal/Single 모드별 윈도우 결정
  // windowStartFromEnd: 끝에서부터 시작 인덱스
  //   ex) 0=가장 최신, n-1=표시 시작이 과거쪽
  let windowStartFromEnd = 0;
  let hasTrigger = false;

  if (triggerIdxFromEnd >= 0) {
    hasTrigger = true;
    // 트리거 지점을 preN으로 오도록 윈도우 시작 계산
    windowStartFromEnd = Math.max(0, triggerIdxFromEnd - preN);
  } else {
    // 트리거 없음
    if (mode === 'normal') {
      // 이전 프레임 유지: windowStartFromEnd를 그대로 두려면 상태를 기억해야 하지만,
      // 간단히 트리거 없으면 업데이트 스킵
      requestAnimationFrame(drawScope);
      return;
    } else {
      // auto: 자유 런(가장 최근 n개)
      windowStartFromEnd = n - 1;
    }
  }

  if (mode === 'single') {
    if (singleArmed) {
      if (hasTrigger) {
        // 1회 캡처 후 정지
        singleArmed = false;
        running = false;
        msgDiv.textContent = 'Single 캡처 완료 (정지).';
      } else {
        // 트리거 기다리는 중 -> 다음 프레임 대기
        requestAnimationFrame(drawScope);
        return;
      }
    } else if (!running) {
      // single 완료 이후 정지 상태에서는 그대로 유지
      requestAnimationFrame(drawScope);
      return;
    }
  }

  if (!running) {
    requestAnimationFrame(drawScope);
    return;
  }

  // y 스케일 산출 (표시되는 n 샘플 범위의 min/max 기반, 보이는 채널만)
  const { min, max } = computeMinMaxLastN(n, vis);
  const pad = (max - min) * 0.1;
  const vmin = min - pad, vmax = max + pad;
  const vspan = (vmax - vmin) || 1;
  const scaleY = (H - 40) / vspan;   // 위아래 20px 여백
  const yBase = H / 2;

  // 트리거 수평 점선
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  const yTrig = Math.round(H - 20 - (trigLevel - vmin) * scaleY);
  ctx.beginPath();
  ctx.moveTo(0, yTrig);
  ctx.lineTo(W, yTrig);
  ctx.stroke();
  ctx.restore();

  // 트리거 수직 점선
  const xTrig = Math.round((W * preN) / n);
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xTrig, 0);
  ctx.lineTo(xTrig, H);
  ctx.stroke();
  ctx.restore();

  // 채널 색 (브라우저 기본 팔레트 사용)
  const chStroke = ['#9cdcfe', '#dcdcaa', '#ce9178', '#c586c0'];
  const chWidth = [2.5, 2.0, 2.0, 2.0];

  // 트리거 채널 하이라이트
  chWidth[src] = 3.5;

  // 파형 그리기
  for (let ch = 0; ch < 4; ch++) {
    if (!vis[ch]) continue;

    ctx.save();
    ctx.lineWidth = chWidth[ch];
    ctx.strokeStyle = chStroke[ch];

    ctx.beginPath();
    let first = true;
    for (let i = 0; i < n; i++) {
      const idx = windowStartFromEnd + (n - 1 - i); // 끝에서부터 idx
      const val = rings[ch].getFromEnd(idx);
      const x = Math.round((W * i) / (n - 1));
      // 값 -> Y 픽셀 (위쪽 여백 20, 아래 여백 20)
      let y = Math.round(H - 20 - (val - vmin) * scaleY);
      // 채널 세로 오프셋 적용(픽셀)
      y += -Number(chOffset(ch));
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // 상태 텍스트
  ctx.save();
  ctx.fillStyle = '#9aa5b1';
  ctx.font = '12px ui-sans-serif, system-ui';
  ctx.fillText(`mode=${mode} trig=${hasTrigger?'HIT':'MISS'} src=CH${src+1} level=${trigLevel} edge=${rising?'↑':'↓'} len=${n}`, 10, 16);
  ctx.restore();

  requestAnimationFrame(drawScope);
}

// 시작
requestAnimationFrame(drawScope);
