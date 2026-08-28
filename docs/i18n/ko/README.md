# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="주요 작업">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">웹 앱 열기</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">PWA 버전 설치</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">데스크톱 앱 다운로드</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">VST 버전 다운로드</a>
</div>

음악 애호가들을 위해 설계된 실시간 오디오 이펙트 프로세서입니다.
EffeTune은 다양한 고품질 이펙트를 통해 모든 오디오 소스를 처리할 수 있으며, 이를 통해 실시간으로 자신만의 청취 환경을 맞춤 설정하고 완벽하게 조정할 수 있습니다.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 소개 영상

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## 컨셉

EffeTune은 음악 청취 경험을 향상시키고자 하는 오디오 애호가들을 위해 제작되었습니다.  
스트리밍 서비스로 음악을 감상하든, 물리적 매체로 재생하든, EffeTune을 사용하면 고품질 이펙트를 더해 취향에 맞게 사운드를 조정할 수 있습니다.
컴퓨터를 오디오 소스와 스피커 또는 앰프 사이에 위치한 강력한 오디오 이펙트 프로세서로 변환하세요.

아무런 오디오 애호가의 미신은 없고, 오직 순수한 과학만 있습니다.

## 기능

- 실시간 오디오 처리
- 드래그 앤 드롭 인터페이스를 사용하여 이펙트 체인 구성
- 범주별 이펙트가 포함된 확장 가능한 이펙트 시스템
- 라이브 오디오 시각화
- 실시간으로 수정 가능한 오디오 파이프라인
- 현재 이펙트 체인을 사용하여 오프라인 오디오 파일 처리
- 로컬 하위 폴더, 메타데이터, 플레이리스트를 탐색할 수 있는 음악 라이브러리
- 시스템 보정을 위한 주파수 응답 측정 및 보정 기능
- 다중 채널 처리 및 출력
- Web/PWA 및 데스크톱 앱의 절전 기능과 무음 처리 및 오디오 입력 유지 시간 설정

## 설정 가이드

EffeTune을 사용하기 전에 오디오 라우팅을 설정해야 합니다.
다음은 다양한 오디오 소스의 구성 방법입니다:

### 음악 파일 플레이어 설정

- 브라우저에서 EffeTune 웹 앱을 열거나, EffeTune 데스크톱 앱을 실행합니다.
- 음악 파일을 열고 재생하여 올바르게 재생되는지 확인합니다
   - 음악 파일을 열고 EffeTune을 애플리케이션으로 선택합니다 (데스크톱 앱 전용)
   - 또는 파일 메뉴에서 "음악 파일 열기..."를 선택합니다 (데스크톱 앱 전용)
   - 또는 음악 파일을 창으로 드래그합니다
- 음악 파일 플레이어만 사용할 때는 오디오 설정의 입력 장치에서 없음(음악 파일 플레이어 전용)을 선택하면 실시간 오디오 입력을 사용하지 않습니다

### 스트리밍 서비스 설정

스트리밍 서비스(Spotify, YouTube Music 등)에서 오디오를 처리하려면:

1. **사전 준비:**
   - VB Cable, Voice Meeter 또는 ASIO Link Tool과 같은 가상 오디오 장치를 설치합니다.
   - 스트리밍 서비스가 오디오를 가상 오디오 장치로 출력하도록 구성합니다.
2. **구성:**
   - 브라우저에서 EffeTune 웹 앱을 열거나, EffeTune 데스크톱 앱을 실행합니다.
   - 입력 소스로 가상 오디오 장치를 선택합니다.
     - Chrome에서는 처음 열 때 오디오 입력을 선택하고 허용하라는 대화 상자가 나타납니다.
     - 데스크톱 앱에서는 화면 오른쪽 상단의 Config Audio 버튼을 클릭하여 설정합니다.
   - 스트리밍 서비스에서 음악 재생을 시작합니다.
   - EffeTune을 통해 오디오가 흐르고 있는지 확인합니다.
   - 보다 자세한 설정 방법은 [FAQ](faq.md)를 참고하세요.

### 물리적 오디오 소스 설정

CD 플레이어, 네트워크 플레이어 또는 기타 물리적 소스를 사용하려면:

- 오디오 인터페이스를 컴퓨터에 연결합니다.
- 브라우저에서 EffeTune 웹 앱을 열거나, EffeTune 데스크톱 앱을 실행합니다.
- 입력 및 출력 소스로 오디오 인터페이스를 선택합니다.
   - Chrome에서는 처음 열 때 오디오 입력을 선택하고 허용하라는 대화 상자가 나타납니다.
   - 데스크톱 앱에서는 화면 오른쪽 상단의 Config Audio 버튼을 클릭하여 설정합니다.
- 이제 오디오 인터페이스는 다중 이펙트 프로세서로 작동합니다:
   * **입력:** CD 플레이어, 네트워크 플레이어 또는 기타 오디오 소스
   * **처리:** EffeTune을 통한 실시간 이펙트 처리
   * **출력:** 앰프 또는 스피커로 전달되는 처리된 오디오

## 사용법

### 애플리케이션 설정

**설정** 메뉴의 **구성...**을 열면 언어, 시작 시 표시, 시작 시 효과 파이프라인 동작을 선택할 수 있습니다. 시작 시 표시는 **Effect Pipeline (기본값)** 또는 **음악 라이브러리** 중에서 선택할 수 있습니다. **음악 라이브러리**를 선택한 경우 옆의 목록에서 처음 표시할 항목을 **트랙**, **앨범**, **아티스트**, **장르**, **하위 폴더**, **폴더**, **플레이리스트** 중에서 선택할 수 있습니다.

지원되는 데스크톱 빌드는 같은 로컬 네트워크의 OpenHome 앱에서도 제어할 수 있습니다. 기본적으로 꺼져 있습니다. 설정 방법, 네트워크 공개, 호환성 및 제한 사항은 [OpenHome 원격 제어](music-library.md#openhome-원격-제어데스크톱-앱)를 참조하세요.

### 음악 라이브러리에서 음악 찾기

1. PC에서는 헤더의 **음악 라이브러리** 버튼, 모바일에서는 **라이브러리** 탭, 데스크톱 앱에서는 **보기 > 음악 라이브러리**에서 엽니다.
2. **음악 폴더 추가**를 선택하고 음악 파일이 들어 있는 폴더를 인덱싱합니다. 외부 CUE 시트와 시트에서 참조하는 WAV 또는 FLAC 파일이 같은 폴더에 있으면, 해당 폴더를 음악 라이브러리에 추가할 때 앨범을 트랙별로 나누어 사용할 수 있습니다.
3. **트랙**, **앨범**, **아티스트**, **장르**, **하위 폴더**, **폴더**, **최근 추가됨**, **플레이리스트**로 찾아보고, **라이브러리 검색**에서 카탈로그 전체를 검색할 수 있습니다. **하위 폴더**는 각 가져오기 루트 안에서 트랙이 들어 있는 경로별로 분류하고, **폴더**는 해당 루트를 관리합니다.
4. 찾은 트랙은 현재 Effect Pipeline을 통해 재생할 수 있으며, **다음에 재생**, **대기열에 추가**, **플레이리스트에 추가**로 재생 순서와 플레이리스트를 관리할 수 있습니다.
5. 파일을 변경한 뒤에는 **다시 스캔**을 사용하고, 브라우저나 폴더 권한이 만료된 경우에는 **다시 연결**을 사용합니다.
   - [음악 라이브러리 자세히 보기](music-library.md)

PC 및 모바일 레이아웃 모두에서 트랙 검색이나 앨범, 아티스트, 장르, 하위 폴더, 재생목록 상세 결과가 300트랙 이하이면 모든 트랙이 기본적으로 선택됩니다. 301트랙 이상이면 자동으로 선택되지 않습니다. 모바일의 자동 선택은 선택 상태만 변경합니다. 트랙을 길게 눌렀을 때만 선택 모드로 들어가 체크박스, **모두 선택**, **모두 선택 해제**가 나타납니다. 트랙을 선택하거나 선택 해제해도 이 모드에 들어가거나 나가지 않으며, 기존 행 작업도 계속 사용할 수 있습니다.

PC용 Chromium 브라우저에서는 선택한 음악 폴더에 대한 접근 권한을 다음 세션까지 유지할 수 있습니다. Safari, Firefox, 모바일 브라우저처럼 폴더 접근 권한을 유지할 수 없는 환경에서는 페이지를 새로 고칠 때마다 폴더나 파일을 다시 선택하세요. EffeTune이 기존 카탈로그에 다시 연결합니다.

대규모 컬렉션은 저장소에서 단계적으로 불러오며, 스캔 및 로딩 속도는 장치, 컬렉션 규모, 사용 가능한 메모리에 따라 달라집니다. 특히 저장소가 느릴 때 매우 빠르게 스크롤하면 다음 트랙이 로드될 때까지 빈 행이 잠깐 보일 수 있습니다.

### 이펙트 체인 구성하기

1. 왼쪽에 **"Available Effects"** 목록이 표시됩니다.
   - **"Available Effects"** 옆의 검색 버튼을 사용하여 이펙트를 필터링합니다.
   - 이름이나 범주로 이펙트를 찾기 위해 텍스트를 입력합니다.
   - ESC 키를 눌러 검색을 초기화합니다.
2. 목록에서 이펙트를 끌어서 **"Effect Pipeline"** 영역에 추가합니다.
3. 이펙트는 위에서 아래로 순서대로 처리됩니다.
4. 핸들(⋮)을 드래그하거나 ▲▼ 버튼으로 순서 변경.
   - Section 이팩트의 경우: Shift+▲▼ 버튼 클릭으로 전체 섹션 이동 (하나의 Section에서 다음 Section, 파이프라인 시작, 또는 파이프라인 끝까지)
5. 이펙트 이름을 클릭하여 설정 확장/축소.
   - Section 이펙트에서 Shift+클릭으로 해당 섹션 내의 모든 이펙트 확장/축소
   - 다른 이펙트에서 Shift+클릭으로 Analyzer 카테고리를 제외한 모든 이펙트 일괄 확장/축소
   - Ctrl+클릭으로 모든 이펙트 일괄 확장/축소
6. **"ON"** 버튼을 사용하여 개별 이펙트를 바이패스합니다.
7. **"?"** 버튼을 클릭하여 상세 문서를 새 탭에서 엽니다.
8. × 버튼을 사용하여 이펙트를 제거합니다
   - Section 이펙트의 경우: Shift+× 버튼 클릭으로 전체 섹션 제거
9. 라우팅 버튼을 클릭하여 처리할 채널과 입출력 버스를 설정합니다
   - [버스 기능에 대해 더 알아보기](bus-function.md)
10. 각 이펙트의 효과 프리셋 버튼을 클릭하면 해당 이펙트만의 설정을 저장하거나 적용할 수 있습니다
11. 슬라이더를 세밀하게 조정하려면 Shift 키를 누른 채 드래그합니다. 값은 최소 단위씩 변경됩니다

### 프리셋 사용하기

Effect Pipeline 헤더의 **효과 체인 프리셋** 버튼을 클릭하면 프리셋 대화 상자가 열립니다.

1. 저장된 프리셋 목록에서 선택하면 불러올 수 있습니다. 이펙트 순서, 설정, ON/OFF 상태를 포함한 전체 이펙트 체인이 복원됩니다.
2. 이름을 입력하고 저장을 선택하면 현재 이펙트 체인을 저장할 수 있습니다.
3. 저장된 프리셋은 해당 행의 이름 변경 버튼으로 이름을 바꿀 수 있습니다.
4. 저장된 프리셋을 하나 이상 선택한 후 선택 항목 삭제를 선택하고 확인하면 제거할 수 있습니다.
5. Ctrl+S(macOS에서는 Cmd+S)를 누르면 현재 프리셋 이름을 편집할 수 있는 상태로 대화 상자가 열립니다.

각 이펙트에도 전용 효과 프리셋 버튼이 있습니다. 이펙트가 제공하는 경우 시스템 프리셋을 열며, 그 이펙트의 설정을 저장, 이름 변경, 불러오기, 삭제할 수 있습니다. 효과 프리셋은 해당 이펙트의 파라미터만 바꾸며 ON/OFF 상태나 라우팅은 바꾸지 않습니다.

`.effetune_preset` 파일의 가져오기, 내보내기, 공유 기능은 계속 전체 이펙트 체인 프리셋에 사용됩니다.

### 섹션 기능 사용

1. **섹션 이펙트 사용:**
   - 이펙트 그룹의 시작 부분에 Section 이펙트를 추가합니다.
   - Comment 필드에 설명적인 이름을 입력합니다.
   - Section의 ON/OFF를 전환하면 각 이펙트 자체의 ON/OFF 상태를 유지한 채 해당 섹션 전체를 바이패스하거나 복원합니다.
   - 여러 Section 이펙트를 사용하여 이펙트 체인을 논리적 그룹으로 구성합니다.
   - [제어 이펙트에 대한 자세한 정보](plugins/control.md)

### AB 파이프라인 기능 사용

1. **AB 파이프라인 개요:**
   - EffeTune은 두 개의 독립적인 이펙트 파이프라인을 유지할 수 있습니다: Pipeline A와 Pipeline B
   - 시작 시에는 Pipeline A만 로드되며, Pipeline B는 필요할 때 생성됩니다
   - 모든 처리, 저장, 로드, 편집 작업은 현재 선택된 파이프라인에서 작동합니다

2. **AB 토글 버튼:**
   - Effect Pipeline 헤더의 오른쪽에 위치합니다
   - 기본적으로 "A"를 표시합니다 (Pipeline A 활성)
   - 클릭하여 Pipeline A와 Pipeline B를 전환합니다
   - 전환 시 Pipeline B가 존재하지 않으면 Pipeline A의 설정이 Pipeline B로 복사됩니다

3. **AB 메뉴 (드롭다운 버튼):**
   - AB 토글 버튼의 오른쪽에 위치합니다
   - "A → B": Pipeline A의 설정을 Pipeline B로 복사하고 Pipeline B로 전환합니다
   - "B → A": Pipeline B의 설정을 Pipeline A로 복사하고 Pipeline A로 전환합니다

4. **Double Blind Test:**
   - 무엇이 재생 중인지 모르는 상태에서 Pipeline A와 Pipeline B를 귀로 비교합니다
   - ABX Test로 두 Pipeline을 실제로 구분할 수 있는지 확인하거나, A/B Preference Test로 어느 쪽을 더 선호하는지 판단하고 통계적 유의성도 확인할 수 있습니다
   - AB 토글 버튼 오른쪽의 ▼ Pipeline 메뉴에서 엽니다(데스크톱 앱에서는 파일 메뉴에서도 열 수 있습니다)
   - [Double Blind Test 자세히 보기](double-blind-test.md)

### 이펙트 선택 및 키보드 단축키

1. **이펙트 선택 방법:**
   - 이펙트 헤더를 클릭하여 개별 이펙트를 선택합니다.
   - Ctrl 키를 누른 채 클릭하여 여러 이펙트를 선택합니다.
   - 파이프라인 영역의 빈 공간을 클릭하여 모든 이펙트 선택을 해제합니다.

2. **키보드 단축키:**
   - Ctrl + Z: 실행 취소
   - Ctrl + Y: 다시 실행
   - Ctrl + S: 현재 파이프라인 저장
   - Ctrl + Shift + S: 현재 파이프라인 다른 이름으로 저장
   - Ctrl + X: 선택한 효과 잘라내기
   - Ctrl + C: 선택한 효과 복사
   - Ctrl + V: 클립보드에서 효과 붙여넣기
   - Ctrl + F: 효과 검색
   - Ctrl + A: 파이프라인 내 모든 효과 선택
   - Delete: 선택한 효과 삭제
   - ESC: 모든 효과 선택 해제
   - T: Pipeline A와 Pipeline B 전환
   - A: Pipeline A로 전환
   - B: Pipeline B로 전환

3. **키보드 단축키 (플레이어 사용 시):**
   - Space: 재생/일시 정지
   - Ctrl + → 또는 N: 다음 트랙
   - Ctrl + ← 또는 P: 이전 트랙
   - Shift + → 또는 F 또는 .: 10초 앞으로 이동
   - Shift + ← 또는 R 또는 ,: 10초 뒤로 이동
   - Ctrl + M: 반복 모드 전환
   - Ctrl + H: 셔플 모드 전환
   - T: Pipeline A/B 전환
   - A: Pipeline A로 전환
   - B: Pipeline B로 전환

### 오디오 파일 처리

1. **파일 드롭 또는 지정 영역:**
   - **"Effect Pipeline"** 아래에 항상 보이는 전용 드롭 영역이 있습니다.
   - 단일 또는 다중 오디오 파일을 지원합니다.
   - 파일은 현재 파이프라인 설정을 사용하여 처리됩니다.
   - 모든 처리는 파이프라인의 샘플 레이트로 이루어집니다.
2. **처리 상태:**
   - 진행 바가 현재 처리 상태를 표시합니다.
   - 처리 시간은 파일 크기와 이펙트 체인의 복잡성에 따라 달라집니다.
3. **다운로드 옵션:**
   - 처리된 파일은 WAV 형식으로 출력됩니다.
   - 여러 파일의 경우, 처리 시작 전에 출력 폴더를 선택하면 각 파일이 완료될 때 해당 폴더에 직접 저장됩니다.
   - 폴더 선택을 지원하지 않는 구형 브라우저에서는 여러 파일이 ZIP 파일로 묶여 다운로드됩니다.

### 이펙트 체인 공유

다른 사용자와 이펙트 체인 구성을 공유할 수 있습니다:

1. 원하는 이펙트 체인을 설정한 후, **"Effect Pipeline"** 영역 오른쪽 상단에 있는 **"Share"** 버튼을 클릭합니다.
2. URL이 자동으로 클립보드에 복사됩니다.
3. 복사된 URL을 다른 사람과 공유하면, 해당 URL을 열어 동일한 이펙트 체인을 재구성할 수 있습니다.
4. 웹 앱에서는 모든 이펙트 설정이 URL에 저장되어 쉽게 저장하고 공유할 수 있습니다.
5. 데스크톱 앱 버전에서는 파일 메뉴에서 effetune_preset 파일로 설정을 내보낼 수 있습니다.
6. 내보낸 effetune_preset 파일을 공유하세요. effetune_preset 파일은 웹 앱 창으로 드래그하여 불러올 수도 있습니다.

### 오디오 재설정

오디오 문제(드롭아웃, 글리치 등)가 발생할 경우:

1. 웹 앱에서는 왼쪽 상단의 **"Reset Audio"** 버튼을 클릭하거나, 데스크톱 앱에서는 보기 메뉴에서 "다시 로드"를 선택합니다.
2. 오디오 파이프라인이 자동으로 재구성됩니다.
3. 이펙트 체인 구성은 그대로 유지됩니다.

### 주파수 응답 측정 및 보정

오디오 시스템의 주파수 응답을 측정하고 플랫한 보정 EQ를 만들려면:
1. 웹 버전에서는 [주파수 응답 측정 도구](https://effetune.frieve.com/features/measurement/measurement.html)를 실행합니다. 앱 버전에서는 설정 메뉴에서 "주파수 응답 측정"을 선택합니다.
2. 안내에 따라 측정용 마이크와 출력 장치를 설정합니다.
3. 한 곳 또는 여러 청취 위치에서 시스템의 주파수 응답을 측정합니다.
4. EffeTune으로 바로 가져올 수 있는 파라메트릭 EQ 보정을 생성합니다.
5. 보정을 적용해 더 정확하고 중립적인 재생음을 얻습니다.

다중 채널 시스템에서는 모든 출력을 함께 측정하려면 **모든 채널**을 선택하고, 하나씩 측정하려면 개별 **출력 채널**을 선택합니다. **고급 설정**에서 스윕 대역폭으로 **끔**, **모든 채널에 동일하게 적용**, **채널별** 중 하나를 선택합니다. **채널별**에서는 **설정할 채널**을 사용하여 선택한 각 출력 채널의 주파수 범위를 설정합니다. 레벨 조정 중 **채널 모드**는 처음에 **자동 순환**으로 시작합니다. 필요하면 테스트 신호 채널을 선택하거나 **수동**을 선택합니다.

임펄스 응답 WAV 파일이 있다면 **가져오기**를 선택해 파일을 지정하십시오. EffeTune은 WAV의 각 채널을 측정 결과로 저장하므로 Room EQ와 저장된 측정을 사용하는 다른 기능에서 선택할 수 있습니다.

오디오 인터페이스 자체의 응답을 제거하려면 출력을 입력에 직접 연결하고, 이 루프백을 임펄스 응답이 포함된 일반 미보정 측정으로 저장합니다. 다음 측정에서는 **오디오 인터페이스 보정**에서 저장한 측정 지점을 선택하십시오. 동일한 인터페이스, 입출력 채널, 샘플링 주파수, 입출력 게인을 사용하고 루프백 측정 후에는 게인을 변경하지 마십시오. 이 보정 없이 측정하려면 **없음(미보정)**을 선택합니다.

임펄스 응답 데이터가 저장된 측정은 결과 화면에 정규화된 **임펄스 응답** 그래프를 표시합니다. 초기 범위는 감지된 시작점을 0 ms로 한 0~10 ms입니다. 마우스 휠이나 버튼으로 시간축을 확대·축소하고, 그래프를 끌거나 슬라이더를 사용해 시간 방향으로 스크롤할 수 있습니다. 측정 지점을 선택하면 그래프도 바뀌며, **전체(평균)**에서는 임펄스 응답이 저장된 첫 번째 지점을 그래프 위에 표시하고 해당 응답을 보여 줍니다. 그래프 아래의 **임펄스 응답 내보내기 (WAV)**를 사용하면 표시 중인 지점의 전체 응답을 정규화하지 않고 측정 샘플링 주파수의 모노 32비트 부동 소수점 WAV로 저장할 수 있습니다.

현재 파이프라인의 주파수, 위상, 최소 그룹 지연, 초과 그룹 지연, 임펄스 응답을 최대 네 개 출력과 저장된 스피커 응답까지 포함해 확인하는 방법은 [Pipeline Analyzer 가이드](pipeline-analyzer.md)를 참조하세요.

## 일반적인 이펙트 조합

다음은 청취 경험을 향상시키기 위한 인기 있는 이펙트 조합입니다:

### 헤드폰 향상

1. **Stereo Blend → RS Reverb**
   - **Stereo Blend:** 편안함을 위한 스테레오 폭 조절 (60-100%)
   - **RS Reverb:** 미묘한 룸 앰비언스 추가 (10-20% 믹스)
   - **결과:** 보다 자연스럽고 피로감을 줄여주는 헤드폰 청취

### 바이닐 시뮬레이션

1. **Wow Flutter → Noise Blender → Saturation**
   - **Wow Flutter:** 부드러운 피치 변동 추가
   - **Noise Blender:** 바이닐 느낌의 분위기 생성
   - **Saturation:** 아날로그 온기 추가
   - **결과:** 진정한 바이닐 레코드 경험

### FM 라디오 스타일

1. **Multiband Compressor → Stereo Blend**
   - **Multiband Compressor:** 라디오처럼 안정된 사운드를 만듭니다
   - **Stereo Blend:** 편안함을 위한 스테레오 폭 조절 (100-150%)
   - **결과:** FM 라디오처럼 매끈하게 정돈된 사운드

### Lo-Fi 특성

1. **Bit Crusher → Simple Jitter → RS Reverb**
   - **Bit Crusher:** 레트로 느낌을 위한 비트 깊이 감소
   - **Simple Jitter:** 디지털 불완전함 추가
   - **RS Reverb:** 분위기 있는 공간 효과 생성
   - **결과:** 클래식한 Lo-Fi 미학

## 문제 해결 및 FAQ

문제가 발생하면 [FAQ](faq.md)를 참고하세요.
그래도 해결되지 않으면 [GitHub Issues](https://github.com/Frieve-A/effetune/issues)로 알려주세요.

## 사용 가능한 이펙트

| 카테고리 | 이펙트 | 설명 | 문서 |
| --- | --- | --- | --- |
| Analyzer | Level Meter | 피크 홀드가 있는 오디오 레벨 표시 | [세부 정보](plugins/analyzer.md#level-meter) |
| Analyzer | Oscilloscope | 실시간 파형 시각화 | [세부 정보](plugins/analyzer.md#oscilloscope) |
| Analyzer | Spectrogram | 시간에 따른 주파수 스펙트럼 변화를 표시 | [세부 정보](plugins/analyzer.md#spectrogram) |
| Analyzer | Spectrum Analyzer | 저역, 중역, 고역의 강도를 실시간으로 표시 | [세부 정보](plugins/analyzer.md#spectrum-analyzer) |
| Analyzer | Stereo Meter | 스테레오 밸런스와 채널 상관을 시각화 | [세부 정보](plugins/analyzer.md#stereo-meter) |
| Basics | Channel Divider | 스테레오 신호를 주파수 대역으로 나누어 각 대역을 별도 스테레오 출력 쌍으로 라우팅 | [세부 정보](plugins/basics.md#channel-divider) |
| Basics | DC Offset | DC 오프셋 조정 | [세부 정보](plugins/basics.md#dc-offset) |
| Basics | FIR Crossover | 가파르게 분리한 주파수 대역을 스테레오 출력 쌍으로 보내는 FIR 크로스오버 | [세부 정보](plugins/basics.md#fir-crossover) |
| Basics | Matrix | 유연한 제어로 오디오 채널을 라우팅하고 믹싱 | [세부 정보](plugins/basics.md#matrix) |
| Basics | MultiChannel Panel | 볼륨, 뮤트, 솔로, 딜레이로 여러 채널을 제어하는 패널 | [세부 정보](plugins/basics.md#multichannel-panel) |
| Basics | Mute | 오디오 신호를 완전히 무음 처리 | [세부 정보](plugins/basics.md#mute) |
| Basics | Polarity Inversion | 신호 극성 반전 | [세부 정보](plugins/basics.md#polarity-inversion) |
| Basics | Stereo Balance | 스테레오 채널 밸런스 제어 | [세부 정보](plugins/basics.md#stereo-balance) |
| Basics | Volume | 기본 볼륨 제어 | [세부 정보](plugins/basics.md#volume) |
| Delay | Delay | 표준 딜레이 이펙트 | [세부 정보](plugins/delay.md#delay) |
| Delay | Time Alignment | 스피커와 청취 위치 정렬을 위한 재생 타이밍 미세 조정 | [세부 정보](plugins/delay.md#time-alignment) |
| Dynamics | Auto Leveler | LUFS 측정을 바탕으로 볼륨을 자동 조정해 일관된 청취 경험 제공 | [세부 정보](plugins/dynamics.md#auto-leveler) |
| Dynamics | Brickwall Limiter | 다이내믹스를 유지하는 디지털 피크 제어 | [세부 정보](plugins/dynamics.md#brickwall-limiter) |
| Dynamics | Compressor | 갑자기 큰 구간을 부드럽게 눌러 더 편안하게 들리도록 조정 | [세부 정보](plugins/dynamics.md#compressor) |
| Dynamics | Expander | 임계값 아래의 조용한 소리를 더 낮춰 자연스러운 강약 대비를 복원 | [세부 정보](plugins/dynamics.md#expander) |
| Dynamics | Gate | 빈 구간이나 조용한 구간의 낮은 레벨 소리를 줄임 | [세부 정보](plugins/dynamics.md#gate) |
| Dynamics | Multiband Compressor | 안정적인 라디오풍 청취 사운드를 위한 5밴드 볼륨 밸런싱 | [세부 정보](plugins/dynamics.md#multiband-compressor) |
| Dynamics | Multiband Expander | 지나치게 평탄한 녹음의 자연스러운 대비를 되살리는 5밴드 익스팬더 | [세부 정보](plugins/dynamics.md#multiband-expander) |
| Dynamics | Multiband Transient | 저역, 중역, 고역의 어택과 서스테인을 따로 조정 | [세부 정보](plugins/dynamics.md#multiband-transient) |
| Dynamics | Power Amp Sag | 고부하 상태에서 파워 앰프의 전압 처짐을 시뮬레이션 | [세부 정보](plugins/dynamics.md#power-amp-sag) |
| Dynamics | Transient Shaper | 어택과 서스테인을 다듬어 음악의 펀치감과 두께를 조정 | [세부 정보](plugins/dynamics.md#transient-shaper) |
| EQ | 15Band GEQ | 15밴드 그래픽 이퀄라이저 | [세부 정보](plugins/eq.md#15band-geq) |
| EQ | 15Band PEQ | 청취용 세밀한 톤 조정을 위한 15밴드 파라메트릭 이퀄라이저 | [세부 정보](plugins/eq.md#15band-peq) |
| EQ | 5Band Dynamic EQ | 임계값 기반 주파수 조정이 가능한 5밴드 다이내믹 이퀄라이저 | [세부 정보](plugins/eq.md#5band-dynamic-eq) |
| EQ | 5Band FIR PEQ | Minimum Phase 또는 Linear Phase FIR 필터를 사용하는 5밴드 파라메트릭 이퀄라이저 | [세부 정보](plugins/eq.md#5band-fir-peq) |
| EQ | 5Band PEQ | 저역, 중역, 고역을 유연하게 다듬는 5밴드 이퀄라이저 | [세부 정보](plugins/eq.md#5band-peq) |
| EQ | Band Pass Filter | 특정 주파수에 집중 | [세부 정보](plugins/eq.md#band-pass-filter) |
| EQ | Comb Filter | 위상감, 빈 공간감, 금속성 색채를 추가 | [세부 정보](plugins/eq.md#comb-filter) |
| EQ | Earphone Cable Sim | 일반적인 이어폰 케이블 차이로 생기는 주파수 응답 변화가 대개 얼마나 작은지 확인 | [세부 정보](plugins/eq.md#earphone-cable-sim) |
| EQ | Group Delay EQ | 음색을 바꾸지 않고 대역별 지연을 조정 | [세부 정보](plugins/eq.md#group-delay-eq) |
| EQ | Group Delay PEQ | 음색을 바꾸지 않고 주파수별 지연을 5개 파라메트릭 대역으로 조정 | [세부 정보](plugins/eq.md#group-delay-peq) |
| EQ | Hi Pass Filter | 불필요한 저주파를 정밀하게 제거 | [세부 정보](plugins/eq.md#hi-pass-filter) |
| EQ | Lo Pass Filter | 불필요한 고주파를 정밀하게 제거 | [세부 정보](plugins/eq.md#lo-pass-filter) |
| EQ | Loudness Equalizer | 낮은 볼륨 청취를 위한 주파수 밸런스 보정 | [세부 정보](plugins/eq.md#loudness-equalizer) |
| EQ | Narrow Range | 하이패스와 로우패스 필터의 조합 | [세부 정보](plugins/eq.md#narrow-range) |
| EQ | Room EQ | 저장된 룸 측정에 기반한 FIR 보정 | [세부 정보](plugins/eq.md#room-eq) |
| EQ | Tilt EQ | 빠른 톤 조정을 위한 틸트 이퀄라이저 | [세부 정보](plugins/eq.md#tilt-eq) |
| EQ | Tone Control | 3밴드 톤 컨트롤 | [세부 정보](plugins/eq.md#tone-control) |
| Lo-Fi | AM Radio Simulator | 음악을 모델링한 AM 송출·수신 체인으로 변환 | [세부 정보](plugins/lofi.md#am-radio-simulator) |
| Lo-Fi | Bit Crusher | 비트 깊이 감소와 제로 오더 홀드 효과 | [세부 정보](plugins/lofi.md#bit-crusher) |
| Lo-Fi | Cassette Artifacts | 음악을 모델링한 컴팩트 카세트에 녹음해 Type I/II/IV 데크와 Dolby B/C로 재생 | [세부 정보](plugins/lofi.md#cassette-artifacts) |
| Lo-Fi | Digital Error Emulator | 다양한 디지털 오디오 전송 오류와 빈티지 디지털 장비 특성을 시뮬레이션 | [세부 정보](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi | DSD64 IMD Simulator | DSD64 초음파 노이즈에서 생기는 가청 상호변조 왜곡을 시뮬레이션 | [세부 정보](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi | FM Radio Simulator | 물리 시뮬레이션된 FM 방송·수신 체인에 음악을 통과 | [세부 정보](plugins/lofi.md#fm-radio-simulator) |
| Lo-Fi | G.726 Simulator | ITU-T G.726 음성 코덱 인코딩/디코딩 왕복 처리를 선택적 무선 오류와 함께 시뮬레이션 | [세부 정보](plugins/lofi.md#g726-simulator) |
| Lo-Fi | GSM-FR Simulator | 13 kbit/s GSM-FR 음성 코덱 인코딩/디코딩 왕복 처리를 프레임 소실 은닉이 있는 무선 구간과 함께 시뮬레이션 | [세부 정보](plugins/lofi.md#gsm-fr-simulator) |
| Lo-Fi | Hum Generator | 빈티지/로파이 청취 분위기를 위한 조절 가능한 50/60 Hz 전원 험 추가 | [세부 정보](plugins/lofi.md#hum-generator) |
| Lo-Fi | MD Simulator | MiniDisc 시대의 ATRAC 인코딩/디코딩 왕복 처리를 재현 | [세부 정보](plugins/lofi.md#md-simulator) |
| Lo-Fi | MP3 Codec Simulator | 저비트레이트 MPEG Layer III의 깨끗한 인코딩/디코딩 왕복 처리 시뮬레이션 | [세부 정보](plugins/lofi.md#mp3-codec-simulator) |
| Lo-Fi | Noise Blender | 로파이 분위기를 위한 조절 가능한 배경 노이즈 질감 추가 | [세부 정보](plugins/lofi.md#noise-blender) |
| Lo-Fi | SBC Codec Simulator | Bluetooth A2DP SBC 인코딩/디코딩 왕복 처리를 선택적 패킷 소실 및 은닉과 함께 재현 | [세부 정보](plugins/lofi.md#sbc-codec-simulator) |
| Lo-Fi | Simple Jitter | 디지털 지터 시뮬레이션 | [세부 정보](plugins/lofi.md#simple-jitter) |
| Lo-Fi | SW Radio Simulator | 음악을 모델링한 단파 송출·전리층 전파·수신 체인으로 변환 | [세부 정보](plugins/lofi.md#sw-radio-simulator) |
| Lo-Fi | Tape Artifacts | 음악을 모델링한 릴 테이프에 녹음하고 재생 | [세부 정보](plugins/lofi.md#tape-artifacts) |
| Lo-Fi | Vinyl Artifacts | 레코드풍 팝, 크래클, 히스, 럼블, 스테레오 노이즈 블리드를 추가 | [세부 정보](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi | Vinyl Simulator | 입력을 모델링한 홈에 커팅한 뒤 물리적 스타일러스 모델로 재생 | [세부 정보](plugins/lofi.md#vinyl-simulator) |
| Modulation | Auto Filter | LFO 또는 음량 엔벌로프로 공진 필터를 스윕 | [세부 정보](plugins/modulation.md#auto-filter) |
| Modulation | Auto Pan | 각 스테레오 페어의 레벨을 좌우로 부드럽게 이동 | [세부 정보](plugins/modulation.md#auto-pan) |
| Modulation | Chorus | 움직이는 딜레이로 코러스, 앙상블, 플랜저 또는 비브라토를 추가 | [세부 정보](plugins/modulation.md#chorus) |
| Modulation | Doppler Distortion | 미세한 스피커 콘 움직임으로 인한 자연스럽고 동적인 사운드 변화를 시뮬레이션 | [세부 정보](plugins/modulation.md#doppler-distortion) |
| Modulation | Frequency Shifter | 주파수 이동, 링 모듈레이션 또는 바버폴 시프트를 적용 | [세부 정보](plugins/modulation.md#frequency-shifter) |
| Modulation | Phaser | 클래식 또는 바버폴 스윕으로 움직이는 피크와 노치를 생성 | [세부 정보](plugins/modulation.md#phaser) |
| Modulation | Pitch Shifter | 템포를 바꾸지 않고 음악의 피치를 올리거나 내림 | [세부 정보](plugins/modulation.md#pitch-shifter) |
| Modulation | Pitch Shifter HQ | 위상 아티팩트를 줄이면서 피치를 올리거나 내림 | [세부 정보](plugins/modulation.md#pitch-shifter-hq) |
| Modulation | Rotary Speaker | 혼과 드럼의 독립적인 회전을 결합 | [세부 정보](plugins/modulation.md#rotary-speaker) |
| Modulation | Tremolo | 볼륨 기반 모듈레이션 이펙트 | [세부 정보](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | 테이프나 레코드 같은 은은한 피치 흔들림으로 빈티지한 느낌 추가 | [세부 정보](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | 조절 가능한 치수의 혼 공명 시뮬레이션 | [세부 정보](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 더 부드러운 혼 스피커 공명으로 자연스러운 청취 색채 추가 | [세부 정보](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 최대 5개의 레조네이터를 사용하는 주파수 공명 효과 | [세부 정보](plugins/resonator.md#modal-resonator) |
| Reverb | Dattorro Plate Reverb | Dattorro 알고리즘 기반 클래식 플레이트 리버브 | [세부 정보](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb | FDN Reverb | 풍부하고 조밀한 리버브 질감을 만드는 Feedback Delay Network 리버브 | [세부 정보](plugins/reverb.md#fdn-reverb) |
| Reverb | IR Reverb | 가져온 공간·장비 임펄스 응답을 사용하는 컨볼루션 리버브 | [세부 정보](plugins/reverb.md#ir-reverb) |
| Reverb | RS Reverb | 자연스러운 확산을 갖춘 랜덤 스캐터링 리버브 | [세부 정보](plugins/reverb.md#rs-reverb) |
| Saturation | Bandwidth Extender | 감지하거나 지정한 컷오프 위에 고주파 성분 생성 | [세부 정보](plugins/saturation.md#bandwidth-extender) |
| Saturation | Dynamic Saturation | 스피커 콘의 비선형 변위를 시뮬레이션 | [세부 정보](plugins/saturation.md#dynamic-saturation) |
| Saturation | Exciter | 명료도와 존재감을 높이는 하모닉 성분 추가 | [세부 정보](plugins/saturation.md#exciter) |
| Saturation | Hard Clipping | 디지털 하드 클리핑 이펙트 | [세부 정보](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 2차부터 5차까지의 하모닉 왜곡을 조정해 캐릭터 추가 | [세부 정보](plugins/saturation.md#harmonic-distortion) |
| Saturation | Multiband Saturation | 저역, 중역, 고역에 따뜻함이나 엣지를 따로 추가 | [세부 정보](plugins/saturation.md#multiband-saturation) |
| Saturation | Saturation | 아날로그풍의 따뜻한 풍성함과 캐릭터를 추가 | [세부 정보](plugins/saturation.md#saturation) |
| Saturation | Sub Synth | 저역 보강을 위해 필터 처리한 저주파 신호를 믹스 | [세부 정보](plugins/saturation.md#sub-synth) |
| Saturation | Tube Simulator | 진공관 라인단과 푸시풀 또는 300B/2A3 싱글 엔디드 트라이오드 파워 앰프를 모델링 | [세부 정보](plugins/saturation.md#tube-simulator) |
| Spatial | Crossfeed Filter | 자연스러운 스테레오 이미지를 위한 헤드폰 크로스피드 필터 | [세부 정보](plugins/spatial.md#crossfeed-filter) |
| Spatial | MS Matrix | 중앙과 주변감을 조정하기 위해 스테레오와 Mid/Side를 상호 변환 | [세부 정보](plugins/spatial.md#ms-matrix) |
| Spatial | Multiband Balance | 5밴드 주파수 의존 스테레오 밸런스 제어 | [세부 정보](plugins/spatial.md#multiband-balance) |
| Spatial | Phase Select EQ | L/R 위상차와 Balance로 선택한 주파수 성분을 부스트 또는 컷 | [세부 정보](plugins/spatial.md#phase-select-eq) |
| Spatial | Stereo Blend | 모노부터 확장 스테레오까지 스테레오 폭 제어 | [세부 정보](plugins/spatial.md#stereo-blend) |
| Others | Oscillator | 스피커나 헤드폰 확인용 테스트 톤/노이즈 제너레이터 | [세부 정보](plugins/others.md#oscillator) |
| Control | Section | 여러 이펙트를 그룹화해 섹션 전체를 바이패스하거나 복원 | [세부 정보](plugins/control.md) |

## 기술 정보

### 브라우저 호환성

Frieve EffeTune은 Google Chrome에서 테스트 및 검증되었습니다.  
이 애플리케이션은 다음을 지원하는 최신 브라우저가 필요합니다:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### 브라우저 지원 세부 정보

1. **Chrome/Chromium**
   - 완벽하게 지원되며 권장됩니다.
   - 최상의 성능을 위해 최신 버전으로 업데이트하세요.
2. **Firefox/Safari**
   - 제한된 지원
   - 일부 기능이 예상대로 작동하지 않을 수 있습니다.
   - 최상의 경험을 위해 Chrome 사용을 고려하세요.

### 권장 샘플 레이트

EffeTune의 **샘플 레이트**는 96 kHz를 권장합니다. 앤티앨리어싱 처리가 충분하지 않은 비선형 이펙트에서 가청 대역으로 접혀 들어오는 앨리어싱 노이즈를 줄일 수 있습니다. 이 설정은 EffeTune의 내부 처리 레이트이며 일반적으로 OS, 오디오 장치, VB-CABLE의 레이트와 독립적으로 설정할 수 있으므로 이들을 변경할 필요가 없습니다. 앱에 표시되는 실제 샘플 레이트를 확인하세요. 설정을 저장하지 않은 첫 실행에서는 OS나 브라우저의 기본값으로 시작할 수 있으며, 웹 버전에서 96 kHz를 사용할 수 없으면 다른 레이트로 전환될 수 있습니다. 재생이 끊기면 먼저 처리 부하가 큰 이펙트를 줄이거나 체인을 짧게 하고, 그래도 필요할 때만 샘플 레이트를 낮추세요.

## 개발 가이드

자신만의 오디오 플러그인을 만들고 싶으신가요? [플러그인 개발 가이드](../../plugin-development.md)를 확인해보세요.
## 링크

[버전 기록](../../version-history.md)

[소스 코드](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Ko-fi에서 후원하기](https://ko-fi.com/frievea)
