# ADC Viewer Electron 🎛️📈

USB CDC로 수신한 `uint16_t adcmem[300][8]` 버퍼를 프레임(300×8×2B) 단위로 받아, **차분 4채널 파형**을 **실시간 그래프로 시각화**하는 Windows용 Electron 앱입니다.

## 설명

다음과 같이 8채널을 4개 차분 채널로 변환해 그립니다:

```c
channel1 = adcmem[i][0] - adcmem[i][1];
channel2 = adcmem[i][2] - adcmem[i][3];
channel3 = adcmem[i][4] - adcmem[i][5];
channel4 = adcmem[i][6] - adcmem[i][7];
```

* 입력: USB CDC (RAW, Little-Endian, `300×8×uint16_t = 4800 bytes/frame`)
* 출력: 최신 프레임 기준 실시간 파형 (Dygraphs)

---

## 빌드 & 실행

### 개발 실행

```bash
npm run dev
```

### (한 번만) serialport 네이티브 재빌드

```bash
npm run rebuild
```

### 윈도우 설치형 EXE 빌드

```bash
npm run build
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.
예) `dist/win-unpacked/ADC Viewer.exe`, `dist/ADC Viewer Setup x.y.z.exe`

---

## 프로젝트 개요

* **플랫폼**: Electron (Windows)
* **시리얼**: `serialport`
* **그래프**: Dygraphs
* **프레이밍**: 4800B 고정 프레임 버퍼 파싱 → 4채널 차분 계산 → 최신 프레임만 갱신 표시

원하시면 스크린샷/아이콘/포터블 타겟 등 추가 문서화도 정리해 드릴게요.
