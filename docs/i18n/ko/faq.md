---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
---

# EffeTune FAQ

EffeTune은 웹 앱과 데스크톱 앱으로 제공되는 오디오 애호가를 위한 실시간 DSP 애플리케이션입니다. 이 문서는 설정, 문제 해결, 멀티채널 사용, 이펙트 작동 및 주파수 보정을 다룹니다.

## 목차
1. 스트리밍을 위한 초기 설정
   1.1. VB-CABLE 설치 및 96 kHz 사용
   1.2. 스트리밍 서비스 입력(Spotify 예시)
   1.3. EffeTune 오디오 설정
   1.4. 작동 확인
2. 문제 해결
   2.1. 오디오 재생 품질
   2.2. CPU 사용량
   2.3. 에코
   2.4. 입력, 출력 또는 이펙트 문제
   2.5. 멀티채널 출력 불일치
3. 멀티채널 및 하드웨어 연결
   3.1. HDMI + AV 리시버
   3.2. 멀티채널 드라이버 없는 인터페이스
   3.3. 채널 지연 및 시간 정렬
   3.4. 8채널 제한 및 확장
4. 자주 묻는 질문
5. 주파수 응답 및 룸 보정
6. 이펙트 작동 팁
7. 참조 링크

---

## 1. 스트리밍을 위한 초기 설정

Windows 예시: Spotify → VB-CABLE → EffeTune → DAC/AMP. 개념은 다른 서비스 및 OS에서도 유사합니다.

### 1.1. VB-CABLE 설치 및 96 kHz 활성화
VB-CABLE 드라이버 팩45를 다운로드하고, 관리자 권한으로 `VBCABLE_Setup_x64.exe`를 실행한 후 재부팅합니다. OS 기본 출력을 스피커/DAC로 되돌리고 **CABLE Input**과 **CABLE Output** 형식을 24비트, 96,000 Hz로 설정합니다. 관리자 권한으로 `VBCABLE_ControlPanel.exe`를 실행하고, **Menu▸Internal Sample Rate = 96000 Hz**를 선택한 다음 **Restart Audio Engine**을 클릭합니다.

### 1.2. 스트리밍 서비스 라우팅(Spotify 예시)
**Settings▸System▸Sound▸Volume mixer**를 열고, `Spotify.exe` 출력을 **CABLE Input**으로 설정합니다. 트랙을 재생하여 스피커에서 소리가 나지 않는지 확인합니다.
macOS가 사용되는 경우, Rogue Amoeba의 **SoundSource**를 이용하여 Spotify 출력을 동일한 방식으로 **CABLE Input**으로 지정합니다.

### 1.3. EffeTune 오디오 설정
데스크톱 앱을 실행하고 **Config Audio**를 엽니다.
- **Input Device:** CABLE Output (VB-Audio Virtual Cable)
- **Output Device:** 물리적 DAC/스피커
- **Sample Rate:** 96,000 Hz (낮은 샘플레이트는 품질을 저하시킬 수 있음)

### 1.4. 작동 확인
Spotify를 재생하면서 EffeTune에서 마스터 **ON/OFF**를 전환하고 소리가 변경되는지 확인합니다.

---

## 2. 문제 해결

### 2.1. 오디오 재생 품질 문제

| 증상 | 해결 방법 |
| ------ | ------ |
| 끊김 또는 결함 | 웹 앱의 좌측 상단 모서리에 있는 **Reset Audio** 버튼을 클릭하거나 데스크톱 앱의 **View** 메뉴에서 **Reload**를 선택합니다. 필요한 경우 활성 이펙트 수를 줄입니다. |
| 왜곡 또는 클리핑 | 체인 끝에 **Level Meter**를 삽입하고 레벨을 0 dBFS 아래로 유지합니다. 필요한 경우 Level Meter 앞에 **Brickwall Limiter**를 추가합니다. |
| 20 kHz 이상 앨리어싱 | VB-CABLE이 여전히 48 kHz로 실행 중일 수 있습니다. 초기 설정을 다시 확인하세요. |

### 2.2. 높은 CPU 사용량
사용하지 않는 이펙트를 비활성화하거나 **Effect Pipeline**에서 제거합니다.

### 2.3. 에코
입력 및 출력 장치가 루프백될 수 있습니다. EffeTune의 출력이 입력으로 돌아가지 않는지 확인하세요.

### 2.4. 입력, 출력 또는 이펙트 문제

| 증상 | 해결 방법 |
| ------ | ------ |
| 오디오 입력 없음 | 플레이어가 **CABLE Input**으로 출력하는지 확인합니다. 브라우저에서 마이크 권한을 허용하고 입력 장치로 **CABLE Output**을 선택합니다. |
| 이펙트가 작동하지 않음 | 마스터, 각 이펙트 및 모든 **Section**이 **ON** 상태인지 확인합니다. 필요한 경우 매개변수를 재설정합니다. |
| 오디오 출력 없음 | 웹 앱의 경우, OS 및 브라우저 출력이 DAC/AMP를 가리키는지 확인합니다. 데스크톱 앱의 경우, **Config Audio**에서 출력 장치를 확인합니다. |
| 다른 플레이어가 "CABLE Input 사용 중" 보고 | 다른 애플리케이션이 **CABLE Input**을 사용하지 않는지 확인합니다. |

### 2.5. 멀티채널 출력 불일치
EffeTune은 1→2→…→8 순서로 채널을 출력합니다. Windows가 4채널로 구성된 경우 후면 채널이 중앙/서브로 매핑될 수 있습니다. **해결 방법:** 장치를 7.1ch로 설정하고, EffeTune에서 8ch를 출력한 후, 채널 5와 6을 후면 오디오에 사용합니다.

---

## 3. 멀티채널 및 하드웨어 연결

### 3.1. HDMI + AV 리시버
PC의 HDMI 출력을 7.1ch로 설정하고 AV 리시버에 연결합니다. EffeTune은 한 케이블을 통해 최대 8개 채널을 전송할 수 있습니다. 오래된 리시버는 음질을 저하시키거나 채널을 예상치 못하게 재매핑할 수 있습니다.

### 3.2. 멀티채널 드라이버 없는 인터페이스(예: MOTU M4)
Out 1‑2와 Out 3‑4가 별도 장치로 나타나 4채널 출력을 방해합니다. 해결 방법:
- ASIO를 통해 채널을 병합하기 위해 **Voicemeeter**를 사용합니다.
- 가상 4채널 장치를 노출하기 위해 **ASIO Link Pro**를 사용합니다(고급).

### 3.3. 채널 지연 및 시간 정렬
**MultiChannel Panel** 또는 **Time Alignment**을 사용하여 10 µs 단계(최소 1 샘플)로 채널을 지연시킵니다. 큰 지연의 경우, 전면 채널을 100-400 ms 지연시킵니다. 비디오 동기화는 플레이어 측에서 조정해야 합니다.

### 3.4. 8채널 제한 및 확장
현재 OS 드라이버는 최대 8개 채널을 지원합니다. 운영 체제가 허용하면 EffeTune은 더 많은 채널을 지원할 수 있습니다.

---

## 4. 자주 묻는 질문

| 질문 | 답변 |
| ------ | ------ |
| 서라운드 입력(5.1ch 등)? | Web Audio API는 입력을 2채널로 제한합니다. 출력 및 이펙트는 최대 8채널을 지원합니다. |
| 권장 이펙트 체인 길이? | CPU가 끊김이나 높은 지연 없이 허용하는 만큼 이펙트를 사용하세요. |
| 최상의 음질을 얻는 방법? | 96 kHz 이상을 사용하고, 미묘한 설정으로 시작하며, **Level Meter**로 헤드룸을 모니터링하고, 필요한 경우 **Brickwall Limiter**를 추가합니다. |
| 모든 소스에서 작동하나요? | 예. 가상 오디오 장치를 사용하면 스트리밍, 로컬 파일 또는 물리적 장비를 처리할 수 있습니다. |
| AV 리시버 vs. 인터페이스 비용? | HDMI가 있는 AV 리시버를 재사용하는 것은 간단합니다. PC 중심 설정의 경우, 멀티채널 인터페이스와 소형 앰프는 좋은 비용과 품질을 제공합니다. |
| VB-CABLE 설치 직후 다른 앱에서 소리가 나지 않음 | OS 기본 출력이 **CABLE Input**으로 전환되었습니다. 사운드 설정에서 다시 변경하세요. |
| 분할 후 채널 3+4만 볼륨 변경 | 스플리터 후에 **Volume** 이펙트를 배치하고 **Channel**을 3+4로 설정합니다. 이전에 배치하면 모든 채널이 변경됩니다. |

---

## 5. 주파수 응답 및 룸 보정

### 5.1. 15Band PEQ로 AutoEQ 설정 가져오기
EffeTune v1.51 이상에서는 우측 상단의 버튼에서 직접 AutoEQ 이퀄라이저 설정을 가져올 수 있습니다.

### 5.2. 측정 보정 설정 붙여넣기
측정 페이지에서 5Band PEQ 설정을 복사하고 **Ctrl+V** 또는 메뉴를 사용하여 **Effect Pipeline** 보기에 붙여넣습니다.

---

## 6. 이펙트 작동 팁
* 신호 흐름은 위에서 아래로 진행됩니다.
* 2→4ch 또는 8→2ch와 같은 변환에는 **Matrix** 이펙트를 사용합니다(버스 라우팅에서 **Channel = All** 설정).
* **MultiChannel Panel**을 사용하여 최대 8개 채널의 레벨, 음소거 및 지연을 관리합니다.

---

## 7. 참조 링크
* EffeTune 데스크톱: <https://github.com/Frieve-A/effetune/releases>
* EffeTune 웹 버전: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (비공식 수정 버전): "ASIO Link Pro 2.4.1" 검색
