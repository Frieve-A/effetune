# Dynamics Plugins

음악의 크고 조용한 부분을 균형 있게 조절하여 더욱 즐겁고 편안한 청취 경험을 제공하는 플러그인 모음입니다.

## Plugin List

- [Auto Leveler](#auto-leveler) - 일관된 청취 경험을 위한 자동 볼륨 조절
- [Brickwall Limiter](#brickwall-limiter) - 안전하고 편안한 청취를 위한 투명한 피크 제어
- [Compressor](#compressor) - 더 편안한 청취를 위해 볼륨 레벨을 자동으로 균형 조절
- [Gate](#gate) - 임계값 이하의 신호를 감쇠시켜 원치 않는 배경 노이즈 감소
- [Multiband Compressor](#multiband-compressor) - FM 라디오 스타일의 사운드 쉐이핑이 가능한 전문가급 5밴드 다이나믹 프로세서
- [Multiband Transient](#multiband-transient) - 주파수 대역별 어택과 서스테인을 정밀 제어하는 고급 3밴드 트랜지언트 쉐이퍼
- [Power Amp Sag](#power-amp-sag) - 고부하 조건하에서 파워 앰프 전압 새그를 시뮬레이션
- [Transient Shaper](#transient-shaper) - 신호의 트랜지언트와 서스테인 부분을 제어

## Auto Leveler

일관된 청취 레벨을 유지하기 위해 자동으로 음악의 볼륨을 조절하는 스마트 볼륨 컨트롤입니다. 표준 LUFS 측정 방식을 사용하여, 조용한 클래식 곡이든 다이내믹한 팝송이든 항상 편안한 볼륨을 유지할 수 있도록 도와줍니다.

### 청취 향상 가이드
- **클래식 음악:**
  - 볼륨을 건드리지 않아도 조용한 구간과 큰 크레센도를 자연스럽게 즐길 수 있습니다.
  - 피아노 작품의 섬세한 디테일까지 모두 들을 수 있습니다.
  - 녹음 레벨이 다양한 앨범에 최적입니다.
- **팝/록 음악:**
  - 곡마다 일정한 볼륨을 유지합니다.
  - 너무 크거나 작은 트랙으로 인한 불편함이 없습니다.
  - 장시간 청취에도 편안한 환경을 제공합니다.
- **배경 음악:**
  - 작업이나 공부 중에도 일정한 볼륨을 유지합니다.
  - 볼륨이 지나치게 크거나 작지 않습니다.
  - 다양한 콘텐츠가 섞인 재생목록에 적합합니다.

### Parameters

- **Target** (-36.0dB to 0.0dB LUFS)
  - 원하는 청취 레벨을 설정합니다.
  - 기본값 -18.0dB LUFS는 대부분의 음악에 적합한 편안한 볼륨을 제공합니다.
  - 배경 음악 청취에는 더 낮은 값이 좋습니다.
  - 보다 임팩트 있는 사운드를 원한다면 높은 값을 사용합니다.

- **Time Window** (1000ms to 10000ms)
  - 볼륨 측정 간격을 결정합니다.
  - 짧은 시간은 변화에 더 민감하게 반응합니다.
  - 긴 시간은 보다 안정적이고 자연스러운 사운드를 제공합니다.
  - 기본값 3000ms는 대부분의 음악에 잘 맞습니다.

- **Max Gain** (0.0dB to 12.0dB)
  - 조용한 소리가 얼마나 증폭될지를 제한합니다.
  - 높은 값은 보다 일정한 볼륨을 유지합니다.
  - 낮은 값은 자연스러운 다이내믹스를 제공합니다.
  - 부드러운 제어를 위해 6.0dB로 시작합니다.

- **Min Gain** (-36.0dB to 0.0dB)
  - 큰 소리가 얼마나 감쇠될지를 제한합니다.
  - 높은 값은 보다 자연스러운 사운드를 유지합니다.
  - 낮은 값은 보다 일정한 볼륨을 제공합니다.
  - 초기값으로 -12.0dB를 권장합니다.

- **Attack Time** (1ms to 1000ms)
  - 볼륨이 줄어드는 속도를 결정합니다.
  - 빠른 시간은 갑작스런 큰 소리를 효과적으로 제어합니다.
  - 느린 시간은 보다 자연스러운 전환을 제공합니다.
  - 기본값 50ms는 제어력과 자연스러움의 균형을 이룹니다.

- **Release Time** (10ms to 10000ms)
  - 볼륨이 원래 상태로 돌아가는 속도를 결정합니다.
  - 빠른 시간은 보다 즉각적인 반응을 제공합니다.
  - 느린 시간은 부드러운 전환을 보장합니다.
  - 기본값 1000ms는 자연스러운 사운드를 만듭니다.

- **Noise Gate** (-96dB to -24dB)
  - 매우 조용한 소리의 처리를 줄여줍니다.
  - 높은 값은 배경 노이즈를 효과적으로 줄입니다.
  - 낮은 값은 더 많은 조용한 소리를 처리합니다.
  - 기본값 -60dB로 시작하여 필요에 따라 조정합니다.

### 시각적 피드백
- 실시간 LUFS 레벨 디스플레이
- Input level (green line)
- Output level (white line)
- 볼륨 조정의 명확한 시각적 피드백 제공
- 읽기 쉬운 시간 기반 그래프

### 추천 설정

#### 일반 청취
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### 배경 음악
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### 다이내믹 음악
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB

## Brickwall Limiter

자연스러운 음질을 유지하면서 디지털 클리핑을 방지하기 위해 음악이 지정된 레벨을 절대 초과하지 않도록 보장하는 고품질 피크 리미터입니다. 음악의 다이내믹스를 손상시키지 않으면서 오디오 시스템을 보호하고 편안한 청취 레벨을 보장하는 데 완벽합니다.

### 청취 향상 가이드
- 클래식 음악:
  - 오케스트라 크레셴도를 안전하게 감상
  - 피아노 작품의 자연스러운 다이내믹스 유지
  - 라이브 녹음의 예상치 못한 피크 방지
- 팝/록 음악:
  - 강렬한 구간에서 일관된 볼륨 유지
  - 모든 청취 레벨에서 다이내믹한 음악 감상
  - 저음이 강한 구간에서 디스토션 방지
- 전자 음악:
  - 신디사이저 피크를 투명하게 제어
  - 오버로드를 방지하면서 임팩트 유지
  - 베이스 드롭을 강력하면서도 제어된 상태로 유지

### 파라미터
- **Input Gain** (-18dB에서 +18dB)
  - 리미터로 들어가는 레벨 조정
  - 리미터를 더 강하게 구동하려면 증가
  - 리미팅이 너무 많이 들리면 감소
  - 기본값은 0dB

- **Threshold** (-24dB에서 0dB)
  - 최대 피크 레벨 설정
  - 낮은 값: 더 많은 안전 마진 제공
  - 높은 값: 더 많은 다이내믹스 보존
  - 부드러운 보호를 위해 -3dB에서 시작

- **Release Time** (10ms에서 500ms)
  - 리미팅이 해제되는 속도
  - 빠른 시간: 더 많은 다이내믹스 유지
  - 느린 시간: 더 부드러운 사운드
  - 100ms를 시작점으로 시도

- **Lookahead** (0ms에서 10ms)
  - 리미터가 피크를 예측할 수 있게 함
  - 높은 값: 더 투명한 리미팅
  - 낮은 값: 더 적은 지연
  - 3ms가 좋은 균형점

- **Margin** (-1.000dB에서 0.000dB)
  - 실효 임계값 미세 조정
  - 추가적인 안전 마진 제공
  - 기본값 -1.000dB가 대부분의 소재에 적합
  - 정밀한 피크 제어를 위해 조정

- **Oversampling** (1x, 2x, 4x, 8x)
  - 높은 값: 더 깨끗한 리미팅
  - 낮은 값: 더 적은 CPU 사용
  - 4x가 품질과 성능의 좋은 균형점

### 시각적 표시
- 실시간 게인 리덕션 미터링
- 명확한 임계값 레벨 표시
- 인터랙티브 파라미터 조정
- 피크 레벨 모니터링

### 추천 설정

#### 투명한 보호
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x

#### 최대 안전성
- Input Gain: -6dB
- Threshold: -6dB
- Release: 50ms
- Lookahead: 5ms
- Margin: -1.000dB
- Oversampling: 8x

#### 자연스러운 다이내믹스
- Input Gain: 0dB
- Threshold: -1.5dB
- Release: 200ms
- Lookahead: 2ms
- Margin: -0.500dB
- Oversampling: 4x

## Compressor

큰 소리는 부드럽게 줄이고 조용한 소리는 강화하여 음악의 볼륨 차이를 자동으로 관리하는 이펙트입니다. 갑작스러운 볼륨 변화를 부드럽게 만들어 더욱 균형 잡히고 즐거운 청취 경험을 제공합니다.

### Listening Enhancement Guide
- 클래식 음악:
  - 극적인 오케스트라 크레셴도를 더 편안하게 청취
  - 피아노의 부드럽고 강한 구간 간의 차이를 균형 있게 조절
  - 강력한 구간에서도 조용한 디테일을 청취 가능
- 팝/록 음악:
  - 강렬한 구간에서 더 편안한 청취 경험 제공
  - 보컬을 더 명확하고 이해하기 쉽게 만듦
  - 장시간 청취 시 피로도 감소
- 재즈 음악:
  - 다양한 악기 간의 볼륨 균형 조절
  - 솔로 구간이 앙상블과 더 자연스럽게 어우러지도록 함
  - 조용하고 큰 구간 모두에서 선명도 유지

### Parameters

- **Threshold** - 이펙트가 작동하기 시작하는 볼륨 레벨 설정(-60dB에서 0dB)
  - 높은 설정: 음악의 가장 큰 부분만 영향
  - 낮은 설정: 전체적인 균형 생성
  - 부드러운 밸런싱을 위해 -24dB에서 시작
- **Ratio** - 볼륨 밸런싱의 강도 제어(1:1에서 20:1)
  - 1:1: 효과 없음(원음)
  - 2:1: 부드러운 밸런싱
  - 4:1: 중간 정도의 밸런싱
  - 8:1+: 강한 볼륨 제어
- **Attack Time** - 큰 소리에 대한 이펙트의 반응 속도(0.1ms에서 100ms)
  - 빠른 시간: 더 즉각적인 볼륨 제어
  - 느린 시간: 더 자연스러운 사운드
  - 20ms를 시작점으로 시도
- **Release Time** - 볼륨이 정상으로 돌아가는 속도(10ms에서 1000ms)
  - 빠른 시간: 더 다이나믹한 사운드
  - 느린 시간: 더 부드럽고 자연스러운 전환
  - 일반적인 청취를 위해 200ms에서 시작
- **Knee** - 이펙트 전환의 부드러움(0dB에서 12dB)
  - 낮은 값: 더 정밀한 제어
  - 높은 값: 더 부드럽고 자연스러운 사운드
  - 6dB가 좋은 시작점
- **Gain** - 처리 후 전체 볼륨 조정(-12dB에서 +12dB)
  - 원음과 볼륨을 맞추기 위해 사용
  - 음악이 너무 조용하게 느껴지면 증가
  - 너무 크게 들리면 감소

### Visual Display

- 이펙트의 작동을 보여주는 인터랙티브 그래프
- 읽기 쉬운 볼륨 레벨 표시기
- 모든 파라미터 조정에 대한 시각적 피드백
- 설정을 안내하는 참조선

### Recommended Settings for Different Listening Scenarios
- 일상적인 배경 청취:
  - Threshold: -24dB
  - Ratio: 2:1
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- 집중 청취 세션:
  - Threshold: -18dB
  - Ratio: 1.5:1
  - Attack: 30ms
  - Release: 300ms
  - Knee: 3dB
- 야간 청취:
  - Threshold: -30dB
  - Ratio: 4:1
  - Attack: 10ms
  - Release: 150ms
  - Knee: 9dB

## Gate

지정된 임계값 이하의 신호를 자동으로 감쇠시켜 원치 않는 배경 노이즈를 줄이는 노이즈 게이트입니다. 이 플러그인은 팬 소음, 험, 또는 주변 실내 소음과 같은 지속적인 배경 노이즈가 있는 오디오 소스를 정리하는 데 특히 유용합니다.

### Key Features
- 정확한 노이즈 감지를 위한 정밀한 임계값 제어
- 자연스럽거나 적극적인 노이즈 감소를 위한 조절 가능한 비율
- 최적의 타이밍 제어를 위한 가변 어택 및 릴리스 타임
- 부드러운 전환을 위한 소프트 니 옵션
- 실시간 게인 리덕션 미터링
- 인터랙티브 전달 함수 디스플레이

### Parameters

- **Threshold** (-96dB에서 0dB)
  - 노이즈 감소가 시작되는 레벨 설정
  - 이 레벨 이하의 신호가 감쇠됨
  - 높은 값: 더 적극적인 노이즈 감소
  - 낮은 값: 더 미묘한 효과
  - 노이즈 플로어를 기준으로 -40dB에서 시작하여 조정

- **Ratio** (1:1에서 100:1)
  - 임계값 이하 신호의 감쇠 강도 제어
  - 1:1: 효과 없음
  - 10:1: 강한 노이즈 감소
  - 100:1: 임계값 이하에서 거의 완전한 무음
  - 일반적인 노이즈 감소를 위해 10:1에서 시작

- **Attack Time** (0.01ms에서 50ms)
  - 신호가 임계값 위로 올라갈 때 게이트의 반응 속도
  - 빠른 시간: 더 정밀하지만 급격할 수 있음
  - 느린 시간: 더 자연스러운 전환
  - 시작점으로 1ms 시도

- **Release Time** (10ms에서 2000ms)
  - 신호가 임계값 아래로 떨어질 때 게이트가 닫히는 속도
  - 빠른 시간: 더 타이트한 노이즈 제어
  - 느린 시간: 더 자연스러운 감쇠
  - 자연스러운 사운드를 위해 200ms에서 시작

- **Knee** (0dB에서 6dB)
  - 임계값 주변에서 게이트가 전환되는 정도 제어
  - 0dB: 정밀한 게이팅을 위한 하드 니
  - 6dB: 부드러운 전환을 위한 소프트 니
  - 일반적인 노이즈 감소를 위해 1dB 사용

- **Gain** (-12dB에서 +12dB)
  - 게이팅 후 출력 레벨 조정
  - 인지된 볼륨 손실을 보상하기 위해 사용
  - 필요하지 않은 경우 일반적으로 0dB로 유지

### Visual Feedback
- 다음을 보여주는 인터랙티브 전달 함수 그래프:
  - 입력/출력 관계
  - 임계값 포인트
  - 니 커브
  - 비율 기울기
- 다음을 표시하는 실시간 게인 리덕션 미터:
  - 현재 노이즈 감소량
  - 게이트 활동의 시각적 피드백

### Recommended Settings

#### 가벼운 노이즈 감소
- Threshold: -50dB
- Ratio: 2:1
- Attack: 5ms
- Release: 300ms
- Knee: 3dB
- Gain: 0dB

#### 중간 정도의 배경 노이즈
- Threshold: -40dB
- Ratio: 10:1
- Attack: 1ms
- Release: 200ms
- Knee: 1dB
- Gain: 0dB

#### 강한 노이즈 제거
- Threshold: -30dB
- Ratio: 50:1
- Attack: 0.1ms
- Release: 100ms
- Knee: 0dB
- Gain: 0dB

### Application Tips
- 최적의 결과를 위해 노이즈 플로어 바로 위에 임계값 설정
- 더 자연스러운 사운드를 위해 더 긴 릴리스 타임 사용
- 복잡한 소재 처리 시 니 값 추가
- 적절한 게이팅을 위해 게인 리덕션 미터 모니터링
- 포괄적인 제어를 위해 다른 다이나믹 프로세서와 결합

## Multiband Compressor

오디오를 5개의 주파수 대역으로 나누어 각각을 독립적으로 처리하는 전문가급 다이나믹 프로세서입니다. 이 플러그인은 주파수 스펙트럼의 각 부분이 완벽하게 제어되고 균형 잡힌 "FM 라디오" 사운드를 만드는 데 특히 효과적입니다.

### Key Features
- 조절 가능한 크로스오버 주파수를 가진 5밴드 처리
- 각 밴드별 독립적인 컴프레션 제어
- FM 라디오 스타일 사운드를 위한 최적화된 기본 설정
- 밴드별 게인 리덕션의 실시간 시각화
- 고품질 Linkwitz-Riley 크로스오버 필터

### Frequency Bands
- Band 1 (Low): 100 Hz 이하
  - 깊은 베이스와 서브 주파수 제어
  - 타이트하고 제어된 베이스를 위한 높은 비율과 긴 릴리스
- Band 2 (Low-Mid): 100-500 Hz
  - 상부 베이스와 하부 중역대 처리
  - 따뜻함을 유지하기 위한 중간 정도의 컴프레션
- Band 3 (Mid): 500-2000 Hz
  - 중요한 보컬과 악기 프레즌스 범위
  - 자연스러움을 보존하기 위한 부드러운 컴프레션
- Band 4 (High-Mid): 2000-8000 Hz
  - 프레즌스와 공기감 제어
  - 빠른 응답의 가벼운 컴프레션
- Band 5 (High): 8000 Hz 이상
  - 밝기와 반짝임 관리
  - 높은 비율의 빠른 응답 시간

### Parameters (밴드별)
- **Threshold** (-60dB에서 0dB)
  - 컴프레션이 시작되는 레벨 설정
  - 낮은 설정으로 더 일관된 레벨 생성
- **Ratio** (1:1에서 20:1)
  - 게인 리덕션의 양 제어
  - 더 적극적인 제어를 위한 높은 비율
- **Attack** (0.1ms에서 100ms)
  - 컴프레션의 반응 속도
  - 트랜지언트 제어를 위한 빠른 시간
- **Release** (10ms에서 1000ms)
  - 게인이 정상으로 돌아가는 속도
  - 더 부드러운 사운드를 위한 긴 시간
- **Knee** (0dB에서 12dB)
  - 컴프레션 시작의 부드러움
  - 더 자연스러운 전환을 위한 높은 값
- **Gain** (-12dB에서 +12dB)
  - 밴드별 출력 레벨 조정
  - 주파수 밸런스의 미세 조정

### FM Radio Style Processing
Multiband Compressor는 FM 라디오 방송의 세련되고 전문적인 사운드를 재현하는 최적화된 기본 설정을 제공합니다:

- Low Band (< 100 Hz)
  - 타이트한 베이스 제어를 위한 높은 비율(4:1)
  - 펀치감을 유지하기 위한 느린 어택/릴리스
  - 탁함을 방지하기 위한 약간의 감소

- Low-Mid Band (100-500 Hz)
  - 중간 정도의 컴프레션(3:1)
  - 자연스러운 응답을 위한 균형 잡힌 타이밍
  - 따뜻함을 유지하기 위한 중립적 게인

- Mid Band (500-2000 Hz)
  - 부드러운 컴프레션(2.5:1)
  - 빠른 응답 시간
  - 보컬 프레즌스를 위한 약간의 부스트

- High-Mid Band (2000-8000 Hz)
  - 가벼운 컴프레션(2:1)
  - 빠른 어택/릴리스
  - 향상된 프레즌스 부스트

- High Band (> 8000 Hz)
  - 일관된 선명함을 위한 높은 비율(5:1)
  - 매우 빠른 응답 시간
  - 세련됨을 위한 제어된 감소

이 구성은 다음과 같은 특징적인 "라디오용" 사운드를 만듭니다:
- 일관되고 임팩트 있는 베이스
- 선명하고 전면에 위치한 보컬
- 모든 주파수에서 제어된 다이나믹스
- 전문적인 세련됨과 광택
- 향상된 프레즌스와 선명도
- 감소된 청취 피로도

### Visual Feedback
- 각 밴드의 인터랙티브 전달 함수 그래프
- 실시간 게인 리덕션 미터
- 주파수 밴드 활동 시각화
- 명확한 크로스오버 포인트 표시기

### Tips for Use
- FM 라디오 프리셋으로 시작
- 소재에 맞게 크로스오버 주파수 조정
- 원하는 제어량을 위해 각 밴드의 임계값 미세 조정
- 게인 컨트롤을 사용하여 최종 주파수 밸런스 조정
- 적절한 처리를 위해 게인 리덕션 미터 모니터링

## Multiband Transient

오디오를 3개의 주파수 대역(Low, Mid, High)으로 분할하고 각 대역에 독립적인 트랜지언트 쉐이핑을 적용하는 고급 트랜지언트 처리 프로세서입니다. 이 정교한 도구를 통해 서로 다른 주파수 범위의 어택과 서스테인 특성을 동시에 강화하거나 줄일 수 있어, 음악의 펀치감, 명료도, 바디감을 정밀하게 제어할 수 있습니다.

### 청취 향상 가이드
- **클래식 음악:**
  - 현악기 섹션의 어택을 강화하여 명료도를 향상시키면서 저주파수의 홀 잔향을 제어
  - 주파수 스펙트럼 전체에서 피아노 트랜지언트를 다르게 쉐이핑하여 더 균형 잡힌 사운드 구현
  - 팀파니(저역)와 심벌(고역)의 펀치감을 독립적으로 제어하여 최적의 오케스트라 밸런스 달성

- **록/팝 음악:**
  - 킥드럼(저역 밴드)에 펀치감을 더하면서 스네어 프레즌스(중역 밴드)를 강화
  - 베이스 기타의 어택을 보컬 명료도와 별도로 제어
  - 고역의 기타 픽 어택을 베이스 응답에 영향을 주지 않고 쉐이핑

- **전자 음악:**
  - 베이스 드롭과 리드 신디사이저를 독립적으로 쉐이핑
  - 서브베이스의 펀치감을 제어하면서 고역의 명료도 유지
  - 주파수 스펙트럼 전체에서 개별 요소에 정의감 추가

### 주파수 대역

Multiband Transient 프로세서는 오디오를 3개의 세심하게 설계된 주파수 대역으로 분할합니다:

- **Low Band** (Freq 1 이하)
  - 베이스와 서브베이스 주파수를 제어
  - 킥드럼, 베이스 악기, 저주파 요소 쉐이핑에 이상적
  - 기본 크로스오버: 200 Hz

- **Mid Band** (Freq 1과 Freq 2 사이)
  - 중요한 중역 주파수를 처리
  - 보컬과 악기 프레즌스의 대부분을 포함
  - 기본 크로스오버: 200 Hz ~ 4000 Hz

- **High Band** (Freq 2 이상)
  - 고음과 에어 주파수를 관리
  - 심벌, 기타 픽, 밝기를 제어
  - 기본 크로스오버: 4000 Hz 이상

### Parameters

#### 크로스오버 주파수
- **Freq 1** (20Hz ~ 2000Hz)
  - Low/Mid 크로스오버 포인트 설정
  - 낮은 값: 중고역에 더 많은 콘텐츠
  - 높은 값: 저역에 더 많은 콘텐츠
  - 기본값: 200Hz

- **Freq 2** (200Hz ~ 20000Hz)
  - Mid/High 크로스오버 포인트 설정
  - 낮은 값: 고역에 더 많은 콘텐츠
  - 높은 값: 중역에 더 많은 콘텐츠
  - 기본값: 4000Hz

#### 밴드별 컨트롤 (Low, Mid, High)
각 주파수 대역은 독립적인 트랜지언트 쉐이핑 컨트롤을 갖습니다:

- **Fast Attack** (0.1ms ~ 10.0ms)
  - 패스트 엔벨로프가 트랜지언트에 반응하는 속도
  - 낮은 값: 더 정밀한 트랜지언트 검출
  - 높은 값: 더 부드러운 트랜지언트 응답
  - 일반적 범위: 0.5ms ~ 5.0ms

- **Fast Release** (1ms ~ 200ms)
  - 패스트 엔벨로프가 리셋되는 속도
  - 낮은 값: 더 엄격한 트랜지언트 제어
  - 높은 값: 더 자연스러운 트랜지언트 감쇠
  - 일반적 범위: 20ms ~ 50ms

- **Slow Attack** (1ms ~ 100ms)
  - 슬로우 엔벨로프의 응답 시간 제어
  - 낮은 값: 트랜지언트와 서스테인의 더 나은 분리
  - 높은 값: 더 점진적인 서스테인 검출
  - 일반적 범위: 10ms ~ 50ms

- **Slow Release** (50ms ~ 1000ms)
  - 서스테인 부분이 추적되는 시간의 길이
  - 낮은 값: 더 짧은 서스테인 검출
  - 높은 값: 더 긴 서스테인 테일 추적
  - 일반적 범위: 150ms ~ 500ms

- **Transient Gain** (-24dB ~ +24dB)
  - 어택 부분을 강화하거나 줄임
  - 양의 값: 더 많은 펀치감과 정의감
  - 음의 값: 더 부드럽고 덜 공격적인 어택
  - 일반적 범위: 0dB ~ +12dB

- **Sustain Gain** (-24dB ~ +24dB)
  - 서스테인 부분을 강화하거나 줄임
  - 양의 값: 더 많은 바디감과 공명
  - 음의 값: 더 엄격하고 제어된 사운드
  - 일반적 범위: -6dB ~ +6dB

- **Smoothing** (0.1ms ~ 20.0ms)
  - 게인 변화 적용의 부드러움을 제어
  - 낮은 값: 더 정밀한 쉐이핑
  - 높은 값: 더 자연스럽고 투명한 처리
  - 일반적 범위: 3ms ~ 8ms

### 시각적 피드백
- 3개의 독립적인 게인 시각화 그래프 (대역당 하나씩)
- 각 주파수 대역의 실시간 게인 히스토리 표시
- 참조용 시간 마커
- 인터랙티브 밴드 선택
- 트랜지언트 쉐이핑 활동의 명확한 시각적 피드백

### 추천 설정

#### 드럼킷 강화
- **Low Band (킥드럼):**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (스네어/보컬):**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (심벌/하이햇):**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### 균형 잡힌 풀 믹스
- **모든 밴드:**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### 자연스러운 어쿠스틱 강화
- **Low Band:**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band:**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band:**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### 사용 팁
- 온건한 설정으로 시작하여 각 밴드를 독립적으로 조정
- 시각적 피드백을 사용하여 적용되는 트랜지언트 쉐이핑의 양을 모니터링
- 크로스오버 주파수를 설정할 때 음악 콘텐츠를 고려
- 고주파수 대역은 일반적으로 더 빠른 어택 타임의 혜택을 받음
- 저주파수 대역은 자연스러운 사운드를 위해 더 긴 릴리즈 타임이 필요한 경우가 많음
- 포괄적인 제어를 위해 다른 다이나믹스 프로세서와 함께 사용

## Power Amp Sag

고부하 조건 하에서 파워 앰프의 전압 새그 동작을 시뮬레이션합니다. 이 효과는 앰프의 파워 서플라이가 까다로운 음악적 구간에 의해 스트레스를 받을 때 발생하는 자연스러운 컴프레션과 따스함을 재현하여, 오디오에 펀치와 음악적 특성을 더합니다.

### 청취 향상 가이드
- 빈티지 오디오 시스템:
  - 자연스러운 컴프레션과 함께 클래식 앰프의 특성을 재현
  - 빈티지 하이파이 장비의 따스함과 풍부함 추가
  - 진정한 아날로그 사운드 달성에 완벽
- 록/팝 음악:
  - 강력한 구간에서 펀치와 존재감 향상
  - 거칠지 않은 자연스러운 컴프레션 추가
  - 만족스러운 앰프 "드라이브" 느낌 생성
- 클래식 음악:
  - 오케스트라 크레센도에 자연스러운 다이나믹 제공
  - 현악기와 관악기 섹션에 앰프의 따스함 추가
  - 증폭된 연주의 현실감 강화
- 재즈 음악:
  - 클래식 앰프 컴프레션 동작 재현
  - 솔로 악기에 따스함과 특성 추가
  - 자연스러운 다이나믹 흐름 유지

### 매개변수

- **Sensitivity** (-18.0dB에서 +18.0dB)
  - 입력 레벨에 대한 새그 효과의 민감도 제어
  - 높은 값: 낮은 볼륨에서 더 많은 새그
  - 낮은 값: 큰 신호에만 영향
  - 자연스러운 반응을 위해 0dB에서 시작

- **Stability** (0%에서 100%)
  - 파워 서플라이 커패시턴스 크기 시뮬레이션
  - 낮은 값: 작은 커패시터 (더 극적인 새그)
  - 높은 값: 큰 커패시터 (더 안정적인 전압)
  - 파워 서플라이의 에너지 저장 용량을 물리적으로 나타냄
  - 50%는 균형 잡힌 특성 제공

- **Recovery Speed** (0%에서 100%)
  - 파워 서플라이의 재충전 능력 제어
  - 낮은 값: 느린 재충전 속도 (지속적인 컴프레션)
  - 높은 값: 빠른 재충전 속도 (빠른 회복)
  - 충전 회로의 전류 공급 능력을 물리적으로 나타냄
  - 40%는 자연스러운 동작 제공

- **Monoblock** (체크박스)
  - 채널별 독립 처리 활성화
  - 체크 해제: 공유 파워 서플라이 (스테레오 앰프)
  - 체크: 독립 서플라이 (모노블록 구성)
  - 더 나은 채널 분리와 이미징을 위해 사용

### 시각적 디스플레이

- 입력 엔벨로프와 게인 리덕션을 보여주는 이중 실시간 그래프
- 입력 엔벨로프 (녹색): 효과를 구동하는 신호 에너지
- 게인 리덕션 (흰색): 적용된 전압 새그의 양
- 1초 기준 마커가 있는 시간 기반 디스플레이
- 현재 값이 실시간으로 표시

### 추천 설정

#### 빈티지 특성
- Sensitivity: +3.0dB
- Stability: 30% (작은 커패시터)
- Recovery Speed: 25% (느린 재충전)
- Monoblock: 체크 해제

#### 현대 하이파이 향상
- Sensitivity: 0.0dB
- Stability: 70% (큰 커패시터)
- Recovery Speed: 60% (빠른 재충전)
- Monoblock: 체크

#### 다이나믹 록/팝
- Sensitivity: +6.0dB
- Stability: 40% (중간 커패시터)
- Recovery Speed: 50% (중간 재충전)
- Monoblock: 체크 해제

## Transient Shaper

오디오의 어택(타격) 부분과 서스테인(지속) 부분을 독립적으로 강화하거나 줄일 수 있는 특수한 다이나믹 프로세서입니다. 이 강력한 도구는 전체 레벨에 영향을 주지 않고 음악의 펀치감과 바디감을 정밀하게 제어하여 사운드의 특성을 재구성할 수 있게 해줍니다.

### Listening Enhancement Guide
- 퍼커션:
  - 트랜지언트를 강화하여 드럼에 펀치감과 선명함 추가
  - 서스테인 부분을 제어하여 룸 울림 감소
  - 볼륨을 높이지 않고도 더 임팩트 있는 드럼 사운드 생성
- 어쿠스틱 기타:
  - 피킹 어택을 강화하여 더 선명하고 존재감 있는 사운드 구현
  - 다른 악기와의 완벽한 균형을 위해 서스테인 제어
  - 스트러밍 패턴을 형성하여 믹스에서 더 잘 어울리도록 조정
- 일렉트로닉 음악:
  - 신디사이저 어택을 강조하여 더 타격적인 느낌 부여
  - 베이스 사운드의 서스테인을 제어하여 더 타이트한 믹스 구현
  - 음색을 변경하지 않고 전자 드럼에 펀치감 추가

### Parameters

- **Fast Attack** (0.1ms에서 10.0ms)
  - 빠른 엔벨로프 팔로워의 반응 속도 제어
  - 낮은 값: 날카로운 트랜지언트에 더 민감하게 반응
  - 높은 값: 더 부드러운 트랜지언트 감지
  - 대부분의 소재에는 1.0ms부터 시작하는 것이 좋음

- **Fast Release** (1ms에서 200ms)
  - 빠른 엔벨로프 팔로워가 리셋되는 속도
  - 낮은 값: 더 정밀한 트랜지언트 추적
  - 높은 값: 더 자연스러운 트랜지언트 쉐이핑
  - 20ms가 시작점으로 잘 작동함

- **Slow Attack** (1ms에서 100ms)
  - 느린 엔벨로프 팔로워의 반응 속도 제어
  - 낮은 값: 트랜지언트와 서스테인 사이의 분리가 더 뚜렷함
  - 높은 값: 서스테인 부분의 더 자연스러운 감지
  - 20ms가 좋은 기본 설정

- **Slow Release** (50ms에서 1000ms)
  - 느린 엔벨로프가 휴지 상태로 돌아가는 속도
  - 낮은 값: 더 짧은 서스테인 부분
  - 높은 값: 더 긴 서스테인 테일 감지
  - 시작점으로 300ms 시도

- **Transient Gain** (-24dB에서 +24dB)
  - 사운드의 어택 부분을 강화하거나 억제
  - 양수 값: 펀치감과 선명함 강조
  - 음수 값: 더 부드럽고 덜 공격적인 사운드 생성
  - 트랜지언트를 강조하려면 +6dB에서 시작

- **Sustain Gain** (-24dB에서 +24dB)
  - 사운드의 서스테인 부분을 강화하거나 억제
  - 양수 값: 더 많은 바디감과 공명
  - 음수 값: 더 엄격하고 제어된 사운드
  - 0dB에서 시작하여 취향에 맞게 조정

- **Smoothing** (0.1ms에서 20.0ms)
  - 게인 변화의 부드러움 제어
  - 낮은 값: 더 정밀한 쉐이핑
  - 높은 값: 더 자연스럽고 투명한 처리
  - 5.0ms가 대부분의 소재에 좋은 균형을 제공

### Visual Feedback
- 실시간 게인 시각화
- 선명한 게인 히스토리 디스플레이
- 참조용 시간 마커
- 모든 파라미터를 위한 직관적인 인터페이스

### Recommended Settings

#### 강화된 퍼커션
- Fast Attack: 0.5ms
- Fast Release: 10ms
- Slow Attack: 15ms
- Slow Release: 200ms
- Transient Gain: +9dB
- Sustain Gain: -3dB
- Smoothing: 3.0ms

#### 자연스러운 어쿠스틱 악기
- Fast Attack: 2.0ms
- Fast Release: 30ms
- Slow Attack: 25ms
- Slow Release: 400ms
- Transient Gain: +3dB
- Sustain Gain: 0dB
- Smoothing: 8.0ms

#### 타이트한 일렉트로닉 사운드
- Fast Attack: 1.0ms
- Fast Release: 15ms
- Slow Attack: 10ms
- Slow Release: 250ms
- Transient Gain: +6dB
- Sustain Gain: -6dB
- Smoothing: 4.0ms