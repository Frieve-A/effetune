# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="주요 작업">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">웹 앱 열기</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">PWA 버전 설치</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">데스크톱 앱 다운로드</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">VST 버전 다운로드</a>
  <a class="button button-secondary" href="https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp">Chrome 확장 프로그램 설치</a>
  <a class="button button-secondary" href="https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk">Edge 확장 프로그램 설치</a>
</div>

오디오 애호가를 위한 실시간 오디오 이펙트 프로세서입니다. EffeTune을 사용하면 어떤 오디오 소스든 고품질 이펙트로 처리하여 실시간으로 취향에 맞게 사운드를 다듬을 수 있습니다.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 소개 영상

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=Qb5Airg0kI8)

## 컨셉

EffeTune은 음악을 더 좋은 소리로 즐기고 싶은 오디오 애호가를 위해 만들어졌습니다. 스트리밍으로 감상하든 물리적 매체로 재생하든, 고품질 이펙트를 더해 원하는 사운드로 세밀하게 조정할 수 있습니다. 컴퓨터를 오디오 소스와 스피커 또는 앰프 사이에 놓는 강력한 오디오 이펙트 프로세서로 활용해 보세요.

오디오 미신은 배제하고, 오직 과학에 기반합니다.

## 기능

- 실시간 오디오 처리
- 드래그 앤 드롭 방식의 이펙트 체인 구성
- 범주별로 정리된 확장형 이펙트 시스템
- 실시간 오디오 시각화
- 움직이는 그래프, 앨범 아트, 곡 정보를 자유롭게 배치하는 Visualizer
- 실시간으로 수정 가능한 오디오 파이프라인
- 현재 이펙트 체인을 적용한 오프라인 오디오 파일 처리
- 로컬 하위 폴더, 메타데이터, 플레이리스트를 탐색하는 음악 라이브러리
- 데스크톱 앱에서 항상 맨 위에 표시할 수 있는 컴팩트한 미니 플레이어
- 시스템 보정을 위한 주파수 응답 측정 및 보정 기능
- 다중 채널 처리 및 출력
- 스마트폰과 태블릿에서 쓰기 편한 모바일 웹 레이아웃

## 설정 가이드

듣고 싶은 오디오 소스에 맞춰 아래 설정 방법을 선택하세요.

### 음악 파일 플레이어 설정

- 브라우저에서 EffeTune 웹 앱을 열거나 EffeTune 데스크톱 앱을 실행합니다
- 음악 파일을 열어 정상적으로 재생되는지 확인합니다
   - **음악 파일 열기** 버튼을 누르고 음악 파일을 선택합니다
   - 또는 음악 파일을 열고 실행 앱으로 EffeTune을 선택합니다(데스크톱 앱 전용)
   - 또는 **파일** 메뉴에서 **음악 파일 열기...**를 선택합니다(데스크톱 앱 전용)
   - 또는 음악 파일을 창으로 끌어다 놓습니다
- 음악 파일 플레이어만 사용할 때는 **오디오 설정**의 **입력 장치:**에서 **없음(음악 파일 플레이어 전용)**을 선택하면 라이브 오디오 입력을 사용하지 않고 재생할 수 있습니다. 데스크톱 앱에서는 이 항목이 기본으로 선택됩니다. 이미 저장된 입력 장치 설정이 있으면 해당 설정을 사용합니다.

[음악 플레이어](music-player.md)

### 데스크톱 앱의 내장 브라우저

데스크톱 앱의 **브라우저**를 사용하면 가상 오디오 장치 없이 웹사이트의 소리를 현재 이펙트로 처리해 들을 수 있습니다.

1. 상단의 **브라우저**를 클릭합니다. 브라우저 오디오 처리가 시작됩니다.
2. HTTP 또는 HTTPS 주소를 입력한 다음 사이트에서 로그인하고 음악을 재생합니다. 프로토콜을 생략하면 HTTPS를 사용합니다.
3. 소리를 조절하려면 **Effect Pipeline**으로 전환합니다. 화면을 바꿔도 브라우저 오디오는 계속 재생됩니다.

뒤로, 앞으로, 새로고침, 로딩 중지로 페이지를 탐색합니다. **북마크**를 열면 현재 페이지를 추가하거나 저장한 페이지를 열고, 북마크 이름을 바꾸거나 삭제할 수 있습니다. 브라우저 메뉴에는 **시작 페이지 표시**, **기본 브라우저에서 열기**, **시작 페이지로 설정**, **사이트 데이터 삭제**가 있습니다. 북마크와 시작 페이지는 저장됩니다. 웹사이트 로그인 상태는 별도로 유지되어 앱을 다시 시작한 뒤에도 이용할 수 있습니다. 브라우저 페이지의 배율은 앱의 확대·축소 배율을 따릅니다.

브라우저 도구 모음에 포커스가 있을 때 **F5**로 새로고침, **F6**으로 주소 선택, **Alt+왼쪽/오른쪽 화살표**로 뒤로/앞으로 이동, **Alt+Home**으로 시작 페이지를 열 수 있습니다. 페이지 안에서도 같은 키를 사용할 수 있습니다. 페이지에 포커스가 있으면 **Ctrl/Cmd+L**로 주소 선택, **Ctrl/Cmd+R**로 새로고침, **Ctrl/Cmd+D**로 북마크를 열 수 있습니다. macOS에서는 **Cmd+[/]**로도 뒤로/앞으로 이동할 수 있습니다. **Escape**는 페이지 로딩을 중지합니다. 페이지를 오른쪽 클릭하면 탐색 명령이, 링크를 오른쪽 클릭하면 여기 또는 기본 브라우저에서 열기와 주소 복사 명령이 표시됩니다. 선택한 텍스트나 입력란을 오른쪽 클릭하면 사용 가능한 편집 명령이 표시됩니다. 페이지 밖에서는 앱의 기존 단축키가 원래대로 작동합니다.

**브라우저**를 열거나 돌아오면 브라우저 오디오가 자동으로 선택됩니다. 브라우저 오디오는 선택한 입력 장치의 오디오와 함께 재생됩니다. 브라우저 오디오만 들으려면 입력 장치를 **없음**으로 선택하세요. 플레이어의 오디오 입력 옵션은 브라우저 재생에 영향을 주지 않습니다. 로컬 음악 파일도 브라우저 오디오와 함께 재생할 수 있습니다. 오디오 캡처가 중지되면 **브라우저**를 다시 눌러 재시도하세요. **사이트 데이터 삭제**는 북마크를 유지하면서 웹사이트에서 로그아웃하고 저장된 사이트 데이터를 지웁니다.

브라우저 도구 모음의 **닫기**를 누르면 브라우저 오디오 처리를 종료하고 **Effect Pipeline**으로 돌아갑니다. 페이지와 방문 기록은 유지됩니다. **브라우저**를 다시 열면 같은 페이지의 오디오 처리를 재개합니다.

**설정 > 구성... > 브라우저**에서 다음 항목을 설정할 수 있습니다.

- **시작 페이지**: 브라우저를 처음 열 때 표시할 HTTP 또는 HTTPS 주소입니다. 입력란은 기본적으로 비어 있으며, 비워 두면 [EffeTune 스트리밍 안내 페이지](https://effetune.frieve.com/streaming/)가 열립니다. **초기화**를 누르면 현재 페이지는 그대로 두고 입력란을 비웁니다.
- **새 탭을 기본 브라우저에서 열기**: 기본적으로 켜져 있습니다. 끄면 새 탭 링크가 EffeTune의 브라우저 안에서 열립니다. 로그인 창과 같은 별도 창은 어느 설정에서든 EffeTune 안에서 열립니다.
- **User-Agent**: 웹사이트에 전달하는 브라우저 식별 정보입니다. 기본값은 브라우저를 Chrome 호환 브라우저로 식별하며 EffeTune 이름도 포함합니다. 입력란을 비우거나 **초기화**를 누르면 기본값으로 돌아갑니다. 변경 후 브라우저에서 페이지를 새로고침하세요.

사이트에 따라 이펙트를 자동으로 전환하려면 먼저 파이프라인을 프리셋으로 저장하세요. **URL 규칙**에서 **규칙 추가**를 누르고 `example.com/music/*`처럼 사이트와 경로를 입력한 뒤 파이프라인 프리셋을 선택합니다. `http://` 또는 `https://`, 쿼리 문자열, `#` 뒤의 내용은 입력하지 않습니다. `*`는 임의의 문자열과 일치합니다. 위아래 이동 버튼으로 우선순위를 조정한 뒤 **규칙 저장**을 누르세요. 활성화된 규칙 중 주소가 일치하고 프리셋을 사용할 수 있는 첫 번째 규칙이 적용됩니다.

브라우저 오디오가 선택되어 있으면 다른 화면으로 전환해도 규칙이 작동합니다. 규칙 저장, 브라우저 열기 또는 일치하는 페이지로 이동할 때 해당 프리셋을 불러올 수 있습니다. 같은 프리셋이 적용되는 페이지 사이를 이동할 때는 수동으로 조정한 내용이 유지됩니다. 일치하는 규칙이 없으면 현재 파이프라인은 바뀌지 않습니다.

일부 사이트는 내장 브라우저, 로그인, 보호된 콘텐츠 재생 또는 오디오 캡처를 허용하지 않습니다. 사용 가능 여부는 사이트와 운영체제에 따라 달라지며 DRM 재생은 보장되지 않습니다. 로그인이 거부되면 사이트에서 제공하는 다른 로그인 방법을 시도하거나 평소 사용하는 브라우저를 이용하세요. 그곳에서 로그인해도 EffeTune 안에서 로그인되지는 않습니다. 브라우저는 데스크톱 앱에서만 사용할 수 있습니다.

### 브라우저 확장 프로그램 설정

가상 오디오 장치 없이 최대 네 개의 Chrome 또는 Edge 탭에 독립된 이펙트 파이프라인을 적용하고 URL별 프리셋과 샘플 레이트를 설정할 수 있습니다. 자세한 내용은 [브라우저 확장 프로그램 가이드](browser-extension.md)를 참조하세요.

1. [Chrome](https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp) 또는 [Edge](https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk) 스토어에서 EffeTune 확장 프로그램을 설치합니다.
2. 오디오를 처리할 탭에서 재생을 시작한 뒤, 브라우저 도구 모음에서 EffeTune을 열고 **Start on this tab**을 선택합니다.
3. **Edit pipeline**을 선택해 이펙트를 추가하고 소리를 조절합니다.

### 스트리밍 서비스 설정

스트리밍 서비스(Spotify, YouTube Music 등)의 오디오를 처리하려면:

데스크톱 앱에서는 먼저 [내장 브라우저](#데스크톱-앱의-내장-브라우저)를 사용해 보세요. 별도의 스트리밍 앱이나 내장 브라우저에서 재생할 수 없는 음원을 사용하려면 아래의 오디오 장치 설정을 따르세요.

1. **사전 준비:**
   - 가상 오디오 장치(예: VB Cable, Voice Meeter 또는 ASIO Link Tool)를 설치합니다
   - 스트리밍 서비스의 오디오 출력 대상을 해당 가상 오디오 장치로 설정합니다
2. **구성:**
   - 브라우저에서 EffeTune 웹 앱을 열거나 EffeTune 데스크톱 앱을 실행합니다
   - 입력 소스로 가상 오디오 장치를 선택합니다
     - Chrome에서는 처음 열 때 오디오 입력을 선택하고 허용하라는 대화상자가 표시됩니다
     - **설정** 메뉴의 **오디오 설정**에서 입출력 장치와 오디오 형식을 선택합니다
   - 스트리밍 서비스에서 음악을 재생합니다
   - EffeTune을 통해 오디오가 흐르는지 확인합니다
   - 자세한 설정 방법은 [FAQ](faq.md)를 참고하세요

### 물리적 오디오 소스 설정

CD 플레이어, 네트워크 플레이어 또는 기타 외부 오디오 기기와 함께 사용하려면:

- 오디오 인터페이스를 컴퓨터에 연결합니다
- 브라우저에서 EffeTune 웹 앱을 열거나 EffeTune 데스크톱 앱을 실행합니다
- 입출력 장치로 오디오 인터페이스를 선택합니다
   - Chrome에서는 처음 열 때 오디오 입력을 선택하고 허용하라는 대화상자가 표시됩니다
   - **설정** 메뉴의 **오디오 설정**에서 입출력 장치와 오디오 형식을 선택합니다
- 이제 오디오 인터페이스가 멀티 이펙트 프로세서로 동작합니다:
   * **Input:** CD 플레이어, 네트워크 플레이어 또는 기타 오디오 소스
   * **Processing:** EffeTune을 통한 실시간 이펙트 처리
   * **Output:** 앰프 또는 스피커로 전달되는 처리된 오디오

## 사용법

데스크톱 앱은 처음 실행할 때 창이 최대화된 상태로 열립니다. 이후에는 이전 창 크기와 위치, 최대화 상태를 복원합니다.

처음 실행하면 음악 재생, 이펙트 추가, 소리 조절에 필요한 화면 위치를 간단히 안내합니다. 설정 메뉴의 **화면 안내 보기**를 선택하면 언제든 다시 볼 수 있으며, 데스크톱 앱의 **도움말** 메뉴나 모바일의 메뉴 버튼에서도 열 수 있습니다.

### 이펙트 체인 구성하기

1. 화면 왼쪽에 사용 가능한 이펙트 목록이 표시됩니다
   - **Available Effects** 옆의 검색 버튼으로 이펙트를 필터링합니다
   - 텍스트를 입력해 이름이나 카테고리로 이펙트를 찾습니다
   - ESC 키를 눌러 검색을 지웁니다
2. 목록에서 이펙트를 끌어 **Effect Pipeline** 영역에 놓습니다
   - 모바일에서는 **이펙트** 탭을 열고 + 버튼을 탭해 전체 화면 목록에서 이펙트를 추가합니다
3. 이펙트는 위에서 아래 순서로 처리됩니다
4. 핸들(⋮)을 드래그하거나 ▲▼ 버튼을 클릭해 순서를 바꿉니다
   - Section 이펙트의 경우: Shift+▲▼ 버튼 클릭으로 섹션 전체를 이동합니다(한 Section에서 다음 Section, 파이프라인 시작 또는 끝까지)
5. 이펙트 이름을 클릭해 설정을 펼치거나 접습니다
   - Section 이펙트에서 Shift+클릭하면 해당 섹션 안의 모든 이펙트를 펼치거나 접습니다
   - 다른 이펙트에서 Shift+클릭하면 Analyzer 카테고리를 제외한 모든 이펙트를 일괄 펼치거나 접습니다
   - Ctrl+클릭하면 모든 이펙트를 일괄 펼치거나 접습니다
6. **ON** 버튼으로 개별 이펙트를 바이패스합니다
7. ? 버튼을 클릭하면 상세 문서를 새 탭에서 엽니다
8. × 버튼으로 이펙트를 제거합니다
   - Section 이펙트의 경우: Shift+× 버튼 클릭으로 섹션 전체를 제거합니다
9. 라우팅 버튼을 클릭해 처리할 채널과 입출력 버스를 설정합니다
   - [버스 기능 자세히 보기](bus-function.md)
10. 각 이펙트의 **효과 프리셋** 버튼을 클릭하면 해당 이펙트만의 설정을 저장하거나 적용할 수 있습니다

× 옆의 자물쇠 버튼을 클릭하면 이펙트 설정을 잠그거나 잠금을 해제할 수 있습니다. 잠긴 상태에서는 파라미터 조작, 초기화, 효과 프리셋, 라우팅을 통한 설정 변경이 제한됩니다. 오디오 처리, ON/OFF, 순서 변경, 접기, 삭제는 계속 사용할 수 있습니다. 접힘 상태와 잠금 상태는 이펙트 체인과 함께 저장되고 복원되며, 체인 프리셋과 이전 세션에도 유지됩니다. 잠긴 상태에서는 자물쇠가 노란색으로 표시되며, 설정을 변경하려고 하면 깜박입니다. 그래프의 값 확인과 표시 탭 전환은 계속 사용할 수 있습니다.

### 음악 라이브러리에서 음악 찾기

기기에 저장된 음악 파일을 라이브러리로 관리할 수 있습니다.

1. PC에서는 헤더의 **음악 라이브러리** 버튼, 모바일에서는 **라이브러리** 탭, 데스크톱 앱에서는 **보기 > 음악 라이브러리**에서 엽니다.
2. **음악 폴더 추가**를 선택해 음악 파일이 들어 있는 폴더를 인덱싱합니다. 외부 CUE 시트를 사용하면 같은 폴더의 WAV 또는 FLAC 앨범 파일을 개별 트랙으로 나눌 수 있습니다.
3. **트랙**, **앨범**, **아티스트**, **장르**, **하위 폴더**, **폴더**, **최근 추가됨**, **플레이리스트**로 찾아보고, **라이브러리 검색**으로 컬렉션을 필터링합니다.
4. **재생**으로 현재 이펙트 파이프라인을 거쳐 감상하거나 **다음에 재생**, **대기열에 추가**, **플레이리스트에 추가**로 재생 순서를 관리합니다.
5. 파일을 변경한 뒤에는 **다시 스캔**을 사용하고, 브라우저나 폴더 권한이 끊어진 경우에는 **다시 연결**을 사용합니다.
   - [음악 라이브러리 자세히 보기](music-library.md)

### Visualizer

재생 중인 음악에 맞춰 시각화를 즐길 수 있습니다.

PC 헤더, 모바일 **플레이어** 탭 또는 데스크톱 앱 **보기** 메뉴에서 **Visualizer**를 엽니다. 기본 제공 레이아웃을 고르거나 **Edit**을 눌러 오디오 그래프, 앨범 아트, 곡 정보를 배치할 수 있습니다. 변경 사항은 즉시 적용되고 다음 실행 시에도 복원되며, 이름을 붙여 보관하려면 프리셋 대화상자에서 저장합니다. 화면 위에 마우스를 올리거나 탭한 뒤 **⛶**를 선택하면 앱 창을 가득 채웁니다. 편집, 효과, 표시 옵션은 [Visualizer 가이드](visualizer.md)를 참조하세요.

### 프리셋 사용하기

만든 이펙트 파이프라인을 저장하고 불러올 수 있습니다.

Effect Pipeline 헤더의 **효과 체인 프리셋** 버튼을 클릭하면 프리셋 대화상자가 열립니다.

1. 저장된 프리셋 목록에서 항목을 선택하면 이펙트 순서, 설정, ON/OFF 상태를 포함한 전체 이펙트 체인이 복원됩니다.
2. 이름을 입력하고 **저장**을 선택하면 현재 이펙트 체인을 저장합니다.
3. 저장된 프리셋은 해당 행의 이름 변경 버튼으로 이름을 바꿀 수 있습니다.
4. 저장된 프리셋을 하나 이상 선택한 뒤 **선택 항목 삭제**를 누르고 확인하면 삭제됩니다.
5. Ctrl+S(macOS에서는 Cmd+S)를 누르면 현재 프리셋 이름을 바로 편집할 수 있는 상태로 대화상자가 열립니다.

각 이펙트에는 전용 **효과 프리셋** 버튼도 있습니다. 이펙트가 시스템 프리셋을 제공하는 경우 이를 열 수 있으며, 해당 이펙트용 개인 설정을 저장, 이름 변경, 불러오기, 삭제할 수 있습니다. 효과 프리셋은 그 이펙트의 파라미터만 변경하며 ON/OFF 상태나 라우팅은 바꾸지 않습니다.

기존 `.effetune_preset` 파일 가져오기, 내보내기, 공유 기능은 계속 전체 이펙트 체인 프리셋에 사용됩니다.

### 이펙트 공통 조작

- 슬라이더를 세밀하게 조정하려면 Shift 키를 누른 채 드래그합니다. 값이 최소 단위씩 변합니다
   - 음수와 양수를 모두 갖는 슬라이더는 0부터 현재 값까지 채워지며, Ratio 슬라이더는 1.0을 시작점으로 사용합니다.
- 지원되는 주파수 및 음정 그래프에서는 축을 따라 드래그해 선택한 주파수를 이펙트 체인을 거쳐 미리 들을 수 있습니다. **설정 > 구성... > 일반 > 주파수 미리 듣기 소리**에서 **사인파**(기본값, -12 dB) 또는 해당 주파수를 중심으로 한 **대역 통과 노이즈**를 선택할 수 있습니다. Note Spectrogram, Pitch Meter, Chroma Spiral과 피아노 건반 표시는 항상 사인파를 사용합니다. 건반 표시는 가장 가까운 반음에 맞춰지며, 건반 위를 드래그하면 해당 건반의 음정을 미리 들려줍니다

[MIDI, 게임패드 또는 키보드로 이펙트 파라미터 제어하기](controller-mapping.md)

### 섹션 기능 사용

여러 이펙트를 그룹으로 묶어 함께 조작할 수 있습니다.

1. **Section 이펙트 사용법:**
   - 그룹으로 묶을 이펙트들의 시작 위치에 Section 이펙트를 추가합니다
   - Comment 필드에 알아보기 쉬운 이름을 입력합니다
   - Section의 ON/OFF를 전환하면 각 이펙트 고유 ON/OFF 상태를 유지한 채 섹션 전체를 바이패스하거나 복원합니다
   - 여러 Section 이펙트를 사용해 이펙트 체인을 논리적인 그룹으로 정리할 수 있습니다
   - [제어 이펙트 자세히 보기](plugins/control.md)

### AB 파이프라인 기능 사용

두 이펙트 파이프라인을 전환하며 소리를 비교할 수 있습니다.

1. **AB 파이프라인 개요:**
   - EffeTune은 두 개의 독립된 이펙트 파이프라인(Pipeline A와 Pipeline B)을 유지할 수 있습니다
   - 시작 시에는 Pipeline A만 로드되며, Pipeline B는 필요할 때 생성됩니다
   - 모든 처리, 저장, 불러오기, 편집 작업은 현재 선택된 파이프라인에 적용됩니다

2. **AB 토글 버튼:**
   - Effect Pipeline 헤더 오른쪽에 있습니다
   - 기본적으로 "A"를 표시합니다(Pipeline A 활성)
   - 클릭하면 Pipeline A와 Pipeline B를 전환합니다
   - 전환할 때 Pipeline B가 없으면 Pipeline A의 설정이 Pipeline B로 복사됩니다

3. **AB 메뉴(드롭다운 버튼):**
   - AB 토글 버튼 오른쪽에 있습니다
   - "A → B": Pipeline A 설정을 Pipeline B로 복사하고 Pipeline B로 전환합니다
   - "B → A": Pipeline B 설정을 Pipeline A로 복사하고 Pipeline A로 전환합니다

4. **이중 맹검 테스트:**
   - 어느 쪽이 재생 중인지 모르는 상태에서 Pipeline A와 Pipeline B를 귀로 비교합니다
   - ABX 테스트로 두 파이프라인을 실제로 구분할 수 있는지 확인하거나, A/B 선호도 테스트로 어느 쪽을 더 선호하는지 통계적 유의성과 함께 확인할 수 있습니다
   - AB 토글 버튼 오른쪽의 ▼ 파이프라인 메뉴에서 엽니다(데스크톱 앱에서는 **파일** 메뉴에서도 열 수 있습니다)
   - [이중 맹검 테스트 자세히 보기](double-blind-test.md)

### 이펙트 선택 및 키보드 단축키

1. **이펙트 선택 방법:**
   - 이펙트 헤더를 클릭해 개별 이펙트를 선택합니다
   - Ctrl 키를 누른 채 클릭해 여러 이펙트를 선택합니다
   - 파이프라인 영역의 빈 공간을 클릭해 모든 선택을 해제합니다

2. **키보드 단축키:**
   - Ctrl + Z: 실행 취소
   - Ctrl + Y: 다시 실행
   - Ctrl + S: 현재 파이프라인 저장
   - Ctrl + Shift + S: 현재 파이프라인을 다른 이름으로 저장
   - Ctrl + X: 선택한 이펙트 잘라내기
   - Ctrl + C: 선택한 이펙트 복사
   - Ctrl + V: 클립보드에서 이펙트 붙여넣기
   - Ctrl + F: 이펙트 검색
   - Ctrl + A: 파이프라인의 모든 이펙트 선택
   - Delete: 선택한 이펙트 삭제
   - ESC: 모든 이펙트 선택 해제
   - T: Pipeline A와 Pipeline B 전환
   - A: Pipeline A로 전환
   - B: Pipeline B로 전환

3. **키보드 단축키(플레이어 사용 시):**
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

음악 파일에 이펙트 체인을 적용하고 처리된 오디오를 새 파일로 저장할 수 있습니다.

1. **파일 드롭 또는 파일 지정 영역:**
   - **Effect Pipeline** 아래에 항상 표시되는 전용 드롭 영역입니다
   - 단일 또는 다중 오디오 파일을 지원합니다
   - 파일은 현재 파이프라인 설정으로 처리됩니다
   - 이펙트는 파이프라인의 샘플 레이트로 처리되며, 출력 샘플 레이트 변환은 그 후에 수행됩니다

2. **처리 상태:**
   - 진행 표시줄에 현재 처리 상태가 나타납니다
   - 처리 시간은 파일 크기와 이펙트 체인 복잡도에 따라 달라집니다

3. **다운로드 또는 저장 옵션:**
   - **설정 > 구성... > 오프라인 파일 출력**에서 WAV 또는 FLAC과 샘플 레이트, 품질을 선택할 수 있습니다. FLAC은 16비트 또는 24비트 무손실 인코딩을 지원하며, 기본값은 96 kHz, 24비트 PCM WAV입니다
   - 형식마다 채널 수 상한이 다릅니다. 선택한 형식의 상한을 넘는 파일은 자동으로 다운믹스하지 않고 해결 방법을 안내하며 중지합니다
   - 여러 파일을 처리할 때는 시작 전에 출력 폴더를 선택하면 완료되는 대로 해당 폴더에 직접 저장됩니다
   - 폴더 선택을 지원하지 않는 구형 브라우저에서는 여러 파일을 ZIP 파일로 묶어 다운로드합니다

### 이펙트 체인 공유

다른 사용자와 이펙트 체인 구성을 공유할 수 있습니다.
1. 원하는 이펙트 체인을 설정한 뒤 **Effect Pipeline** 오른쪽 상단의 **공유** 버튼을 클릭합니다
2. 웹 앱 URL이 클립보드에 자동 복사됩니다
3. 복사한 URL을 공유하면 상대방이 링크를 열어 똑같은 이펙트 체인을 재현할 수 있습니다
4. 공유 URL에는 재현에 필요한 이펙트 설정이 담기며, 평소 작업 상태는 웹 앱이 브라우저 저장소에도 보관합니다
5. 데스크톱 앱에서는 **파일** 메뉴에서 설정을 `.effetune_preset` 파일로 내보낼 수 있습니다
6. 내보낸 `.effetune_preset` 파일을 공유하세요. 이 파일은 웹 앱 창으로 끌어다 놓아 불러올 수도 있습니다

### 저장 데이터 백업 및 복원

**설정 > 백업 / 복원**을 열면 저장된 파이프라인 프리셋, 이펙트 프리셋, 임펄스 응답, 측정 결과를 웹 앱, 데스크톱 앱, 브라우저 확장 프로그램 사이에서 옮길 수 있습니다. 웹 앱과 데스크톱 앱에서는 이름을 붙여 저장한 Visualizer 프리셋도 포함할 수 있습니다. 프리셋을 선택하면 그 프리셋이 사용하는 측정 데이터나 임펄스 응답 데이터도 자동으로 선택됩니다.

**측정 데이터 포함**과 **임펄스 응답 데이터 포함**은 기본적으로 켜져 있어 백업 파일만으로 복원이 끝납니다. 복원 대상에 같은 측정 파일이나 임펄스 응답 파일이 이미 있을 때만 어느 한쪽을 끄세요. 복원한 임펄스 응답은 EffeTune의 **임펄스 응답 라이브러리**에 추가됩니다. 백업을 복원해도 현재 파이프라인, 볼륨, 선택한 프리셋, 장치 설정, 음악 라이브러리, 확장 프로그램의 URL 규칙은 바뀌지 않습니다. `.effetune_backup` 파일 하나의 최대 크기는 256 MB이며, 이를 넘으면 필요에 따라 여러 파일로 나누세요. 복원이 도중에 멈추더라도 완료된 항목은 남아 있으므로 같은 파일로 안전하게 다시 복원할 수 있습니다.

백업을 공유하기 전에 선택 내용을 확인하세요. 프리셋 이름과 코멘트, 원본 임펄스 응답 파일, 측정 세부 정보가 포함될 수 있습니다. 음악 파일, 음악 라이브러리 데이터, 앱 설정, 장치 선택, URL 규칙, 자격 증명, 저장하지 않은 현재 파이프라인은 포함되지 않습니다.

### 애플리케이션 설정

**설정 > 구성...**을 열면 **언어**를 선택하고, **시작 시 표시:**(`Effect Pipeline (기본값)`, `음악 라이브러리`, `Visualizer`)와 **시작 시 효과 파이프라인:**을 설정하고, **테마**(`Graphite`, `Paper`, `Midnight`, `Ember`, `Mint`)를 고를 수 있습니다. **시작 시 표시:**를 **음악 라이브러리**로 설정하면 처음 열릴 라이브러리 카테고리도 선택할 수 있습니다. 데스크톱 앱에서는 시작 시 표시할 화면으로 **Browser**도 선택할 수 있습니다.

**이펙트 파이프라인 열 수**에서 **수동**을 선택하면 +/− 버튼으로 열 수를 조절할 수 있습니다. **자동**(기본값)을 선택하면 이펙트 목록과 열이 창 너비 안에 들어가도록 열 수가 정해지며, 창 크기를 바꿀 때마다 자동으로 조절됩니다.

Microsoft Store 버전은 Microsoft Store를 통해 업데이트됩니다. **설정 > 구성...**에서 **Microsoft Store 업데이트 열기**로 업데이트를 확인하고, **Windows 시작 앱 설정 열기**로 EffeTune의 자동 실행 여부를 설정할 수 있습니다. 이 버전의 설정과 Browser 로그인 정보는 다른 데스크톱 버전과 별도로 저장됩니다.

### 음향 특성 측정

마이크로 오디오 시스템의 주파수 응답, 임펄스 응답, 왜곡, 감쇠를 확인하고 EffeTune으로 가져올 수 있는 보정 EQ를 만들 수 있습니다. 자세한 내용은 [음향 특성 측정](measurement.md)과 [Pipeline Analyzer 가이드](pipeline-analyzer.md)를 참조하세요.

### 오디오 재설정

오디오 끊김이나 노이즈 문제가 발생하면:
1. **설정** 메뉴 또는 모바일 오버플로 메뉴에서 **오디오 재설정**을 선택합니다. 데스크톱 앱에서는 **보기 > 다시 로드**도 사용할 수 있습니다
2. 오디오 파이프라인이 자동으로 재구성됩니다
3. 이펙트 체인 설정은 그대로 유지됩니다

### 네트워크 음악과 원격 제어

**데스크톱 앱:** 로컬 네트워크의 음악 서버를 탐색하고 선택한 음악 폴더를 공유하며 이 기기 또는 OpenHome 플레이어에서 재생할 수 있습니다. EffeTune 재생 기기와 페어링하면 같은 창에서 효과도 편집할 수 있습니다. 공유와 외부 원격 제어 허용은 기본적으로 꺼져 있습니다. [네트워크 음악과 원격 제어](openhome.md)를 참조하세요. UPnP AV / DLNA와 AirPlay 수신을 켜면 다른 기기에서 보낸 음악을 이 컴퓨터의 이펙트를 거쳐 들을 수도 있습니다.

PWA에서도 등록한 EffeTune 컴퓨터의 공유 음악을 이 기기의 효과로 듣거나 다른 등록된 컴퓨터를 제어할 수 있습니다. 브라우저와 연결 조건은 [PWA 설정 및 재생](openhome.md#pwa)을 참고하세요.

### AI 어시스턴트로 EffeTune 제어하기 (MCP)

Codex나 Claude Code에 MCP 설정을 맡기면 EffeTune 데스크톱 앱에서 이펙트 추가, 설정 변경, 프리셋 불러오기와 저장을 요청할 수 있습니다. 컴퓨터에서 명령을 실행할 수 있는 에이전트를 사용하세요.

1. EffeTune 데스크톱 앱에서 **설정 > 원격 제어...**를 열고 **원격 제어 허용**을 켠 다음 **링크 복사**를 누릅니다.
2. 아래 프롬프트의 링크 입력란을 복사한 링크로 바꿔 AI 에이전트에 보내세요.

```text
아래 공식 안내에 따라 EffeTune MCP를 설정해 주세요.
https://github.com/Frieve-A/effetune/blob/main/mcp/README.md
연결 링크: <복사한 링크를 여기에 붙여 넣기>
```

설정이 끝나면 안내에 따라 재시작한 뒤 "현재 이펙트를 보여 줘"라고 요청해 보세요. 연결 링크는 비공개로 유지하고, **새 토큰**을 누르거나 포트를 변경한 경우 새 링크로 다시 설정하세요.

연결한 EffeTune의 Music Library에 곡을 추가한 뒤 "[곡] 재생해 줘"라고 요청하세요. 어시스턴트는 먼저 그 EffeTune의 라이브러리에서 찾고, 재생 기기를 지정하지 않으면 해당 플레이어에서 재생합니다. 이 경우 음악 폴더를 공유할 필요가 없습니다. 다른 라이브러리나 플레이어를 사용하려면 "[라이브러리]에서 [곡]을 찾아 [플레이어]에서 재생해 줘"처럼 지정하세요. 음악이 다른 EffeTune 컴퓨터에 있다면 그 컴퓨터에서 먼저 폴더를 공유하세요.

## 일반적인 이펙트 조합

청취 경험을 높여 주는 대표적인 이펙트 조합입니다:

### 헤드폰 향상

1. **Stereo Blend → RS Reverb**
   - **Stereo Blend:** 편안한 음장을 위해 스테레오 폭 조절 (60-100%)
   - **RS Reverb:** 은은한 공간 잔향 추가 (10-20% 믹스)
   - **결과:** 더 자연스럽고 귀가 덜 피로한 헤드폰 청취

### 바이닐 시뮬레이션

1. **Wow Flutter → Noise Blender → Saturation**
   - **Wow Flutter:** 부드러운 피치 흔들림 추가
   - **Noise Blender:** 바이닐 특유의 분위기 형성
   - **Saturation:** 아날로그풍 온기 추가
   - **결과:** 아날로그 레코드 감성의 재생음

### FM 라디오 스타일

1. **Multiband Compressor → Stereo Blend**
   - **Multiband Compressor:** 라디오 방송처럼 안정된 사운드 형성
   - **Stereo Blend:** 편안한 스테레오 폭 조절 (100-150%)
   - **결과:** FM 라디오처럼 매끄럽게 정돈된 사운드

### Lo-Fi 특성

1. **Bit Crusher → Simple Jitter → RS Reverb**
   - **Bit Crusher:** 레트로 감성을 위한 비트 깊이 감소
   - **Simple Jitter:** 디지털 질감의 거친 특성 추가
   - **RS Reverb:** 공간감 있는 분위기 연출
   - **결과:** 클래식한 Lo-Fi 사운드

## 문제 해결 및 FAQ

문제가 발생하면 [문제 해결 및 FAQ](faq.md)를 참고하세요.
문제가 계속되면 [GitHub Issues](https://github.com/Frieve-A/effetune/issues)에 제보해 주세요.

## 사용 가능한 이펙트

| 카테고리 | 이펙트 | 설명 | 문서 |
| --- | --- | --- | --- |
| Analyzer | Analog Meter | VU, PPM, 피크, 라우드니스 스케일을 갖춘 니들 미터로 채널 레벨 표시 | [세부 정보](plugins/analyzer.md#analog-meter) |
| Analyzer | Chroma Spiral | 한 바퀴가 한 옥타브인 나선에 각 음이름과 옥타브 성분의 강도를 표시 | [세부 정보](plugins/analyzer.md#chroma-spiral) |
| Analyzer | Level Meter | 피크 홀드가 있는 오디오 레벨 표시 | [세부 정보](plugins/analyzer.md#level-meter) |
| Analyzer | Note Spectrogram | 시간에 따른 추정 음높이를 피아노 롤로 표시 | [세부 정보](plugins/analyzer.md#note-spectrogram) |
| Analyzer | Oscilloscope | 실시간 파형 시각화 | [세부 정보](plugins/analyzer.md#oscilloscope) |
| Analyzer | Pitch Meter | 하나의 기본 주파수와 튜닝 변화를 시간에 따라 추적 | [세부 정보](plugins/analyzer.md#pitch-meter) |
| Analyzer | Rhythm Analyzer | 템포, 박자마다의 발음, 각 파트가 박자보다 앞서거나 뒤처지는 정도를 표시 | [세부 정보](plugins/analyzer.md#rhythm-analyzer) |
| Analyzer | Spectrogram | 시간에 따른 주파수 스펙트럼 변화를 표시 | [세부 정보](plugins/analyzer.md#spectrogram) |
| Analyzer | Spectrum Analyzer | 저역, 중역, 고역의 강도를 실시간으로 표시 | [세부 정보](plugins/analyzer.md#spectrum-analyzer) |
| Analyzer | Stereo Meter | 스테레오 밸런스와 채널 상관을 시각화 | [세부 정보](plugins/analyzer.md#stereo-meter) |
| Basics | Bass Management | 저역을 1대 이상의 서브우퍼로 보내고 LFE를 메인 채널의 저역과 합산 | [세부 정보](plugins/basics.md#bass-management) |
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
| Dynamics | Attack Tonal Balance | 짧은 어택과 지속되는 음정 성분의 균형을 조정 | [세부 정보](plugins/dynamics.md#attack-tonal-balance) |
| Dynamics | Auto Leveler | LUFS 측정을 바탕으로 볼륨을 자동 조정해 일관된 청취 경험 제공 | [세부 정보](plugins/dynamics.md#auto-leveler) |
| Dynamics | Brickwall Limiter | 신호 피크를 제한해 디지털 클리핑을 방지 | [세부 정보](plugins/dynamics.md#brickwall-limiter) |
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
| EQ | Tonal Balance EQ | 장기적인 음색 균형을 음악 스타일별 목표에 맞춰 자동 보정 | [세부 정보](plugins/eq.md#tonal-balance-eq) |
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
| Lo-Fi | TV Audio Simulator | 음악을 모델링한 아날로그 및 NICAM TV 음성 경로에 통과시킴 | [세부 정보](plugins/lofi.md#tv-audio-simulator) |
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
| Resonator | Adaptive Prediction | 오디오 예측을 학습하여 잔차를 추출하거나 변화하는 공명음을 만듭니다 | [세부 정보](plugins/resonator.md#adaptive-prediction) |
| Resonator | Horn Resonator | 조절 가능한 치수의 혼 공명 시뮬레이션 | [세부 정보](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 더 부드러운 혼 스피커 공명으로 자연스러운 청취 색채 추가 | [세부 정보](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 최대 5개의 레조네이터를 사용하는 주파수 공명 효과 | [세부 정보](plugins/resonator.md#modal-resonator) |
| Restoration | Click Remover | 짧은 클릭, 크래클, 팝, 드롭아웃을 복원 | [세부 정보](plugins/restoration.md#click-remover) |
| Restoration | Clip Restorer | 하드 클리핑으로 평평해진 피크를 복원 | [세부 정보](plugins/restoration.md#clip-restorer) |
| Restoration | Hum Remover | 지속적인 전기 험과 그 고조파를 제거 | [세부 정보](plugins/restoration.md#hum-remover) |
| Restoration | Noise Reduction | 음악을 유지하면서 지속적인 배경 노이즈를 줄임 | [세부 정보](plugins/restoration.md#noise-reduction) |
| Reverb | Dattorro Plate Reverb | Dattorro 알고리즘 기반 클래식 플레이트 리버브 | [세부 정보](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb | FDN Reverb | 풍부하고 조밀한 리버브 질감을 만드는 Feedback Delay Network 리버브 | [세부 정보](plugins/reverb.md#fdn-reverb) |
| Reverb | IR Reverb | 가져온 공간·장비 임펄스 응답을 사용하는 컨볼루션 리버브 | [세부 정보](plugins/reverb.md#ir-reverb) |
| Reverb | RS Reverb | 자연스러운 확산을 갖춘 랜덤 스캐터링 리버브 | [세부 정보](plugins/reverb.md#rs-reverb) |
| Saturation | Bandwidth Extender | 감지하거나 지정한 컷오프 위에 고주파 성분 생성 | [세부 정보](plugins/saturation.md#bandwidth-extender) |
| Saturation | Bass Extender | 적합한 저역 성분에서 한 옥타브 낮은 베이스를 생성 | [세부 정보](plugins/saturation.md#bass-extender) |
| Saturation | Dynamic Saturation | 스피커 콘의 비선형 변위를 시뮬레이션 | [세부 정보](plugins/saturation.md#dynamic-saturation) |
| Saturation | Exciter | 명료도와 존재감을 높이는 하모닉 성분 추가 | [세부 정보](plugins/saturation.md#exciter) |
| Saturation | Hard Clipping | 디지털 하드 클리핑 이펙트 | [세부 정보](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 2차부터 5차까지의 하모닉 왜곡을 조정해 캐릭터 추가 | [세부 정보](plugins/saturation.md#harmonic-distortion) |
| Saturation | Multiband Saturation | 저역, 중역, 고역에 따뜻함이나 엣지를 따로 추가 | [세부 정보](plugins/saturation.md#multiband-saturation) |
| Saturation | Saturation | 아날로그풍의 따뜻한 풍성함과 캐릭터를 추가 | [세부 정보](plugins/saturation.md#saturation) |
| Saturation | Sub Synth | 저역 보강을 위해 필터 처리한 저주파 신호를 믹스 | [세부 정보](plugins/saturation.md#sub-synth) |
| Saturation | Tube Simulator | 진공관 라인단과 푸시풀 또는 300B/2A3 싱글 엔디드 트라이오드 파워 앰프를 모델링 | [세부 정보](plugins/saturation.md#tube-simulator) |
| Spatial | Crossfeed Filter | 자연스러운 스테레오 이미지를 위한 헤드폰 크로스피드 필터 | [세부 정보](plugins/spatial.md#crossfeed-filter) |
| Spatial | Crosstalk Cancellation | 귀 위치 측정값으로 스테레오 스피커 사이의 크로스토크를 줄입니다 | [세부 정보](plugins/spatial.md#crosstalk-cancellation) |
| Spatial | MS Matrix | 중앙과 주변감을 조정하기 위해 스테레오와 Mid/Side를 상호 변환 | [세부 정보](plugins/spatial.md#ms-matrix) |
| Spatial | Multiband Balance | 5밴드 주파수 의존 스테레오 밸런스 제어 | [세부 정보](plugins/spatial.md#multiband-balance) |
| Spatial | Phase Select EQ | L/R 위상차와 Balance로 선택한 주파수 성분을 부스트 또는 컷 | [세부 정보](plugins/spatial.md#phase-select-eq) |
| Spatial | Spatial Mapper | Direct, Diffuse, Residual 소리를 분리해 유연하게 멀티채널로 라우팅 | [세부 정보](plugins/spatial.md#spatial-mapper) |
| Spatial | Stereo Blend | 극성이 바뀐 스테레오에서 모노를 거쳐 확장 스테레오까지 스테레오 폭 제어 | [세부 정보](plugins/spatial.md#stereo-blend) |
| Others | Oscillator | 스피커나 헤드폰 확인용 테스트 톤/노이즈 제너레이터 | [세부 정보](plugins/others.md#oscillator) |
| Others | SFZ Note Player | 감지한 음을 가져온 SFZ 악기로 재생 | [세부 정보](plugins/others.md#sfz-note-player) |
| Control | Section | 여러 이펙트를 그룹화해 섹션 전체를 바이패스하거나 복원 | [세부 정보](plugins/control.md) |

## 기술 정보

### 브라우저 호환성

Frieve EffeTune은 Google Chrome에서 테스트 및 검증되었습니다. 이 애플리케이션은 다음을 지원하는 최신 브라우저가 필요합니다:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker (설치형 웹 앱 및 오프라인 실행 지원)

### 브라우저 지원 세부 정보

1. Chrome/Chromium
   - 완벽하게 지원되며 권장됩니다
   - 최상의 성능을 위해 최신 버전으로 업데이트하세요

2. Firefox/Safari
   - 제한된 지원
   - 출력 장치 선택, Wake Lock, 설치 동작, 지원 오디오 형식 등은 브라우저에 따라 다를 수 있습니다
   - 최상의 경험을 위해 Chrome 사용을 권장합니다

### 권장 샘플 레이트

EffeTune의 **샘플링 속도**는 96 kHz로 설정하세요. Saturation 같은 비선형 이펙트에서 생기는 귀에 들리는 앨리어싱을 줄일 수 있습니다. 이 설정은 EffeTune 내부의 처리 레이트를 정하며, OS, 오디오 인터페이스, 가상 오디오 장치의 샘플 레이트와는 독립적으로 동작합니다. 앱에 표시되는 실제 샘플링 속도를 확인하세요. 설정을 저장하기 전까지는 OS나 브라우저의 기본값을 따를 수 있으며, 웹 앱에서는 96 kHz를 사용할 수 없을 때 다른 레이트로 전환될 수 있습니다. 소리가 끊기면 먼저 부하가 큰 이펙트를 끄거나 체인을 줄이고, 필요할 때만 샘플링 속도를 낮추세요.

## 개발 가이드

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

자신만의 오디오 플러그인을 만들어 보고 싶다면 [플러그인 개발 가이드](../../plugin-development.md)를 확인하세요.

## DSP 라이브러리

EffeTune의 DSP 엔진은 Python, JavaScript, 브라우저 AudioWorklet용의 독립적이고 결정론적인 MIT 라이선스 라이브러리로도 사용할 수 있습니다. 공개된 Chain 스키마와 자동 생성되는 이펙트 카탈로그는 EffeTune 앱 없이도 사용할 수 있습니다. 자세한 내용은 [EffeTune DSP Library 문서](https://effetune.frieve.com/dsp/)를 참조하세요.

설치 방법과 그대로 실행할 수 있는 예제는 각 패키지의 빠른 시작에 있습니다.

- [Python 패키지](https://effetune.frieve.com/dsp/getting-started/python/)
- [JavaScript 및 AudioWorklet 패키지](https://effetune.frieve.com/dsp/getting-started/javascript/)

이펙트, 스키마, 처리 동작, 필요한 에셋은 [DSP Library 가이드](https://effetune.frieve.com/dsp/)에서 설명합니다.

## 링크

[버전 기록](../../version-history.md)

[소스 코드](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Ko-fi에서 후원하기](https://ko-fi.com/frievea)
