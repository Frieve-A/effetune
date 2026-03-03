# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

🔗[**Webアプリを開く**](https://effetune.frieve.com/effetune.html)  🔗[**デスクトップアプリをダウンロード**](https://github.com/Frieve-A/effetune/releases/)

オーディオ愛好家のために設計されたリアルタイムオーディオエフェクトプロセッサです。EffeTuneを使用すると、あらゆるオーディオソースを高品質なエフェクトで処理し、リアルタイムでリスニング体験を自由にカスタマイズして完璧に調整することができます。

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## コンセプト

EffeTuneは、音楽の聴取体験を向上させたいオーディオ愛好家のために作られました。ストリーミングで音楽を楽しむ場合でも、物理メディアで再生する場合でも、EffeTuneはプロフェッショナルグレードのエフェクトを追加し、好みに合わせた音作りを可能にします。あなたのコンピュータを、オーディオソースとスピーカーまたはアンプの間に配置される強力なオーディオエフェクトプロセッサに変身させましょう。

オカルトは一切なく、純粋な科学のみです。

## Features

- リアルタイムオーディオ処理
- エフェクトチェーン構築のためのドラッグ＆ドロップインターフェース
- カテゴリ別に整理された拡張可能なエフェクトシステム
- ライブオーディオビジュアライゼーション
- リアルタイムで変更可能なオーディオパイプライン
- 現在のエフェクトチェーンを使用したオフラインオーディオファイル処理
- システムキャリブレーションのための周波数特性測定と補正機能
- マルチチャンネル処理と出力

## セットアップガイド

EffeTuneを使用する前に、オーディオルーティングの設定が必要です。以下に、各種オーディオソースの設定方法を示します:

### 音楽ファイルプレーヤーのセットアップ

- ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
- 音楽ファイルを開いて再生し、正常に再生されることを確認する
   - 音楽ファイルを開き、アプリケーションとしてEffeTuneを選択する（デスクトップアプリのみ）
   - またはファイルメニューから「音楽ファイルを開く...」を選択する（デスクトップアプリのみ）
   - または音楽ファイルをウィンドウにドラッグする

### ストリーミングサービスのセットアップ

ストリーミングサービス（Spotify、YouTube Musicなど）からオーディオを処理するには:

1. 前提条件:
   - 仮想オーディオデバイスをインストールする（例: VB Cable、Voice Meeter、または ASIO Link Tool）
   - ストリーミングサービスの出力先を仮想オーディオデバイスに設定する

2. 設定:
   - ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
   - 入力ソースとして仮想オーディオデバイスを選択する
     - Chromeでは、初めて開いたときにオーディオ入力を選択して許可するダイアログボックスが表示されます
     - デスクトップアプリでは、画面右上の「オーディオ設定」ボタンをクリックして設定します
   - ストリーミングサービスで音楽を再生する
   - EffeTuneを通じてオーディオが流れていることを確認する
   - より詳細なセットアップ手順については[FAQ](faq.md)を参照

### 物理的なオーディオソースのセットアップ

CDプレーヤー、ネットワークプレーヤー、またはその他の物理的なソースでEffeTuneを使用するには:

- オーディオインターフェースをコンピュータに接続する
- ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
- 入力ソースと出力先としてオーディオインターフェースを選択する
   - Chromeでは、初めて開いたときにオーディオ入力を選択して許可するダイアログボックスが表示されます
   - デスクトップアプリでは、画面右上の「Config Audio」ボタンをクリックして設定します
- これにより、オーディオインターフェースは以下のように機能します:
   * **Input:** CDプレーヤー、ネットワークプレーヤー、またはその他のオーディオソース
   * **Processing:** EffeTuneによるリアルタイムエフェクト処理
   * **Output:** アンプまたはスピーカーへ送られる処理済みオーディオ

## 使用方法

### エフェクトチェーンの作成

1. 画面左側に **Available Effects** の一覧が表示されています  
   - **Available Effects** の横にある検索ボタンを使用してエフェクトを絞り込みます  
   - 名前またはカテゴリでエフェクトを検索するには、任意のテキストを入力してください  
   - ESCキーを押して検索をクリアします
2. リストからエフェクトをドラッグして、**Effect Pipeline** エリアに配置します
3. エフェクトは上から下へ順番に処理されます
4. ハンドル (⋮) をドラッグまたは▲▼ボタンで順序を変更
   - Sectionエフェクトの場合：Shift+▲▼ボタンクリックでセクション全体を移動（あるSectionから次のSection、パイプライン開始、またはパイプライン末尾まで）
5. エフェクト名をクリックし設定の展開・折りたたみ
   - SectionエフェクトでのShift+クリックでそのセクション内の全エフェクトを展開・折りたたみ
   - その他のエフェクトでのShift+クリックでAnalyzerカテゴリー以外の全エフェクトを一括展開・折りたたみ
   - Ctrl+クリックで全エフェクトを一括展開・折りたたみ
6. **ON** ボタンを使用して、個々のエフェクトをバイパスします
7. ？ボタンをクリックすると、詳細なドキュメントが新しいタブで開きます
8. ×ボタンを使ってエフェクトを削除します
   - Sectionエフェクトの場合：Shift+×ボタンクリックでセクション全体を削除
9. ルーティングボタンをクリックして、処理するチャンネルと入出力バスを設定します
   - [バス機能の詳細](bus-function.md)

### プリセットの使用

1. **エフェクトチェーンの保存:**
   - 希望のエフェクトチェーンとパラメーターを設定する
   - プリセットの名前を入力フィールドに入力する
   - saveボタンをクリックしてプリセットを保存する

2. **プリセットの読み込み:**
   - ドロップダウンリストからプリセット名を入力または選択する
   - プリセットは自動的に読み込まれる
   - すべてのエフェクトとその設定が復元される

3. **プリセットの削除:**
   - 削除したいプリセットを選択する
   - deleteボタンをクリックする
   - 確認ダイアログで削除を承認する

4. **プリセット情報:**
   - 各プリセットはエフェクトチェーンの完全な設定を保存する
   - エフェクトの順序、パラメーター、状態が含まれる

### セクション機能の使用方法

1. **Sectionエフェクトの使用:**
   - グループ化したいエフェクト群の先頭にSectionエフェクトを配置する
   - Commentフィールドに分かりやすい名前を入力する
   - SectionのON/OFFを切り替えると、そのセクション内のすべてのエフェクトが一括で有効/無効になる
   - 複数のSectionエフェクトを使用して、エフェクトチェーンを論理的なグループに整理する
   - [制御エフェクトの詳細](plugins/control.md)

### ABパイプライン機能の使用

1. **ABパイプライン概要:**
   - EffeTuneは2つの独立したエフェクトパイプラインを維持できます：パイプラインAとパイプラインB
   - 起動時はパイプラインAのみが読み込まれ、パイプラインBは必要に応じて作成されます
   - すべての処理、保存、読み込み、編集操作は現在選択されているパイプラインで動作します

2. **AB切り替えボタン:**
   - Effect Pipelineヘッダーの右側に配置されています
   - デフォルトで「A」を表示（パイプラインAがアクティブ）
   - クリックしてパイプラインAとパイプラインBを切り替えます
   - パイプラインBが存在しない状態で切り替えると、パイプラインAの設定がパイプラインBにコピーされます

3. **ABメニュー（ドロップダウンボタン）:**
   - AB切り替えボタンの右側に配置されています
   - 「A → B」：パイプラインAの設定をパイプラインBにコピーしてパイプラインBに切り替えます
   - 「B → A」：パイプラインBの設定をパイプラインAにコピーしてパイプラインAに切り替えます

### エフェクト選択とキーボードショートカット

1. **エフェクト選択方法:**
   - エフェクトのヘッダーをクリックして個々のエフェクトを選択する
   - Ctrlキーを押しながらクリックすると、複数のエフェクトを選択できる
   - Pipelineエリアの空白部分をクリックして、すべてのエフェクトの選択を解除する

2. **キーボードショートカット:**
   - Ctrl + Z: 元に戻す
   - Ctrl + Y: やり直す
   - Ctrl + S: 現在のパイプラインを保存
   - Ctrl + Shift + S: 現在のパイプラインを別名で保存
   - Ctrl + X: 選択したエフェクトを切り取る
   - Ctrl + C: 選択したエフェクトをコピー
   - Ctrl + V: クリップボードからエフェクトを貼り付ける
   - Ctrl + F: エフェクトを検索する
   - Ctrl + A: パイプライン内のすべてのエフェクトを選択する
   - Delete: 選択したエフェクトを削除する
   - ESC: すべてのエフェクトの選択を解除する
   - T: パイプラインAとパイプラインBを切り替える
   - A: パイプラインAに切り替える
   - B: パイプラインBに切り替える

3. **キーボードショートカット（プレイヤー使用時）**：
   - Space：再生/一時停止
   - Ctrl + → または N：次のトラック
   - Ctrl + ← または P：前のトラック
   - Shift + → または F または .：10秒早送り
   - Shift + ← または R または ,：10秒巻き戻し
   - Ctrl + M：リピートモード切り替え
   - Ctrl + H：シャッフルモード切り替え
   - T：パイプラインA/Bを切り替える
   - A：パイプラインAに切り替える
   - B：パイプラインBに切り替える

### オーディオファイルの処理

1. **ファイルドロップまたはファイル指定エリア:**
   - **Effect Pipeline** の下に常に表示される専用のドロップエリア
   - 単一または複数のオーディオファイルに対応
   - ファイルは現在のパイプライン設定で処理される
   - すべての処理はパイプラインのサンプルレートで行われる

2. **処理状況:**
   - プログレスバーが現在の処理状況を表示する
   - 処理時間はファイルサイズとエフェクトチェーンの複雑さに依存する

3. **ダウンロードまたは保存オプション:**
   - 処理されたファイルはWAV形式で出力される
   - 複数ファイルは自動的にZIPファイルにまとめられる

### エフェクトチェーンの共有

他のユーザーとエフェクトチェーンの設定を共有できます:
1. 希望のエフェクトチェーンを設定したら、**Effect Pipeline** エリアの右上にある **Share** ボタンをクリックする
2. ウェブアプリのURLが自動的にクリップボードにコピーされる
3. コピーされたURLを他のユーザーと共有する ― 共有されたURLを開くことで、まったく同じエフェクトチェーンを再現できます
4. ウェブアプリでは、すべてのエフェクト設定がURLに保存されるため、簡単に保存・共有が可能です
5. デスクトップアプリ版では、ファイルメニューからeffetune_presetファイルに設定をエクスポートできます
6. エクスポートしたeffetune_presetファイルを共有してください。effetune_presetファイルはウェブアプリウィンドウにドラッグして読み込むこともできます

### オーディオのリセット

オーディオの問題（ドロップアウト、グリッチ）が発生した場合:
1. ウェブアプリでは左上の **オーディオをリセット** ボタンをクリック、またはデスクトップアプリではViewメニューからReloadを選択する
2. オーディオパイプラインが自動的に再構築される
3. エフェクトチェーンの設定は保持される

### 周波数特性測定と補正

オーディオシステムの周波数特性を測定し、フラットな補正EQを作成するには:
1. Web版では[周波数応答測定ツール](https://effetune.frieve.com/features/measurement/measurement.html)を起動。アプリ版では設定メニューから「周波数応答測定」を選択
2. ガイドに従って測定用マイクと出力デバイスを設定する
3. 一つまたは複数のリスニングポジションでシステムの周波数特性を測定する
4. EffeTuneに直接インポート可能なパラメトリックEQ補正を生成する
5. 補正を適用して、より正確でニュートラルなサウンド再生を実現する

## よく使われるエフェクトの組み合わせ

あなたのリスニング体験を向上させるための人気のエフェクト組み合わせをいくつかご紹介します:

### ヘッドフォン強化

1. Stereo Blend -> RS Reverb  
   - **Stereo Blend:** 快適な音場を実現するためにステレオ幅を調整する (60-100%)  
   - **RS Reverb:** 微妙な部屋のアンビエンスを追加する (10-20% mix)  
   - **結果:** より自然で耳が疲れにくいヘッドフォンでのリスニング体験

### Vinyl Simulation

1. Wow Flutter -> Noise Blender -> Saturation  
   - **Wow Flutter:** やわらかなピッチの変動を加える  
   - **Noise Blender:** ヴィニールらしい雰囲気を作り出す  
   - **Saturation:** アナログ的な温かみを加える  
   - **結果:** 本物のヴィニールレコード体験

### FM Radio Style

1. Multiband Compressor -> Stereo Blend  
   - **Multiband Compressor:** "radio"サウンドを作り出す  
   - **Stereo Blend:** 快適な音場のためにステレオ幅を調整する (100-150%)  
   - **結果:** プロフェッショナルな放送のようなサウンド

### Lo-Fi Character

1. Bit Crusher -> Simple Jitter -> RS Reverb  
   - **Bit Crusher:** レトロな雰囲気のためにビット深度を削減する  
   - **Simple Jitter:** デジタルな不完全さを加える  
   - **RS Reverb:** 大気感のある空間を作り出す  
   - **結果:** クラシックなローファイ美学

## トラブルシューティングとFAQ

何らかの問題が発生している場合は[トラブルシューティングとFAQ](faq.md)をご参照ください。

問題が解決されない場合は[GitHub Issues](https://github.com/Frieve-A/effetune/issues)にご報告ください。

## Available Effects

| カテゴリ    | エフェクト             | 説明                                                                  | ドキュメント                                             |
|-----------|---------------------|---------------------------------------------------------------------|---------------------------------------------------------|
| Analyzer  | Level Meter         | ピークホールド機能付きのオーディオレベルを表示                                     | [詳細](plugins/analyzer.md#level-meter)               |
| Analyzer  | Oscilloscope        | リアルタイムで波形を可視化                                                   | [詳細](plugins/analyzer.md#oscilloscope)              |
| Analyzer  | Spectrogram         | 時間経過に伴う周波数スペクトルの変化を表示                                         | [詳細](plugins/analyzer.md#spectrogram)               |
| Analyzer  | Spectrum Analyzer   | リアルタイムスペクトル分析                                                  | [詳細](plugins/analyzer.md#spectrum-analyzer)         |
| Analyzer  | Stereo Meter        | ステレオバランスと音の動きを可視化                                              | [詳細](plugins/analyzer.md#stereo-meter)              |
| Basics    | Channel Divider     | ステレオ信号を周波数帯域に分割し、別々のチャンネルにルーティング                         | [詳細](plugins/basics.md#channel-divider)             |
| Basics    | DC Offset           | DCオフセットの調整                                                        | [詳細](plugins/basics.md#dc-offset)                   |
| Basics    | Matrix              | オーディオチャンネルを柔軟にルーティングおよびミキシング                                  | [詳細](plugins/basics.md#matrix)                      |
| Basics    | MultiChannel Panel  | 複数チャンネルを音量、ミュート、ソロ、遅延で個別制御するコントロールパネル                   | [詳細](plugins/basics.md#multichannel-panel)          |
| Basics    | Mute                | オーディオ信号を完全に無音化                                                   | [詳細](plugins/basics.md#mute)                        |
| Basics    | Polarity Inversion  | 信号の極性を反転                                                          | [詳細](plugins/basics.md#polarity-inversion)          |
| Basics    | Stereo Balance      | ステレオチャンネルのバランスを制御                                              | [詳細](plugins/basics.md#stereo-balance)              |
| Basics    | Volume              | 基本的なボリューム制御                                                       | [詳細](plugins/basics.md#volume)                      |
| Delay     | Delay          | 標準的なディレイエフェクト                                   | [詳細](plugins/delay.md#delay) |
| Delay     | Time Alignment | オーディオチャンネルのタイミングを微調整 | [詳細](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | 一貫したリスニング体験のためにLUFS測定に基づいて自動的に音量を調整 | [詳細](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | 安全で快適なリスニングのための透過的なピーク制御 | [詳細](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | しきい値、レシオ、ニーコントロール付きのダイナミックレンジ圧縮 | [詳細](plugins/dynamics.md#compressor) |
| Dynamics  | Gate | ノイズリダクションのためのしきい値、レシオ、ニーコントロール付きノイズゲート | [詳細](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | FMラジオ風のサウンドシェイピングを備えたプロフェッショナルな5バンドダイナミクスプロセッサ | [詳細](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | 周波数帯域別のダイナミックレンジ拡張を実現するプロフェッショナルな5バンドエクスパンダー | [詳細](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | 周波数別のアタックとサステインを独立制御する高度な3バンドトランジェントシェイパー | [詳細](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | 高負荷時のパワーアンプの電圧降下をシミュレート | [詳細](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | 信号のアタックとサステイン部分を独立してコントロール | [詳細](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | 15バンドグラフィックイコライザー | [詳細](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | 15の完全設定可能なバンドを備えたプロフェッショナルなパラメトリックイコライザー | [詳細](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | しきい値に基づく周波数調整が可能な5バンドダイナミックイコライザー | [詳細](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | 5つの完全設定可能なバンドを備えたプロフェッショナルなパラメトリックイコライザー | [詳細](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | 特定の周波数に焦点を当てる | [詳細](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | ハーモニックカラーリングとレゾナンスシミュレーション用のデジタルコームフィルター | [詳細](plugins/eq.md#comb-filter) |
| EQ        | Hi Pass Filter | 不要な低域を精密に除去 | [詳細](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | 不要な高域を精密に除去 | [詳細](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | 低音量リスニング向けの周波数バランス補正 | [詳細](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | ハイパスフィルターとローパスフィルターの組み合わせ | [詳細](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ      | クイックトーンシェイピング用のチルトイコライザー      | [詳細](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | 3バンドトーンコントロール | [詳細](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | ビット深度削減とゼロオーダーホールド効果 | [詳細](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | 様々なデジタルオーディオ伝送エラーとビンテージデジタル機器の特性をシミュレート | [詳細](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | Hum Generator | 高精度電源ハムノイズジェネレーター | [詳細](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | ノイズ生成とミキシング | [詳細](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | デジタルジッターシミュレーション | [詳細](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | アナログレコードノイズの物理的シミュレーション | [詳細](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | スピーカーコーンの微細な動きによる自然でダイナミックな音変化をシミュレート | [詳細](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | 軽量なピッチシフティングエフェクト | [詳細](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | 音量ベースのモジュレーション効果 | [詳細](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | 時間ベースのモジュレーション効果 | [詳細](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | カスタマイズ可能な寸法でのホーン共振シミュレーション | [詳細](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 高度な反射を備えた強化されたホーンモデル | [詳細](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 最大5つのレゾネーターを備えた周波数共振効果 | [詳細](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Dattorroアルゴリズムに基づくクラシックなプレートリバーブ | [詳細](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | リッチで密度の高いリバーブテクスチャを生成するフィードバック・ディレイ・ネットワーク・リバーブ | [詳細](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | 自然な拡散を伴うランダム散乱リバーブ | [詳細](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | スピーカーコーンの非線形変位をシミュレート | [詳細](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | 明瞭さとプレゼンスを向上させるハーモニック成分を追加 | [詳細](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | デジタルハードクリッピング効果 | [詳細](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 各ハーモニックを独立制御できるハーモニックディストーションで独自のキャラクターを付与 | [詳細](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | 周波数別のウォーム感を精密に制御する3バンドサチュレーション効果 | [詳細](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | サチュレーション効果 | [詳細](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | ベース強化のためにサブハーモニック信号をミックス | [詳細](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | 自然なステレオイメージングのためのヘッドフォンクロスフィードフィルター | [詳細](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | ステレオ操作のためのミッド・サイドエンコーディングとデコーディング | [詳細](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | 5バンド周波数依存のステレオバランス制御 | [詳細](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | ステレオ幅制御エフェクト | [詳細](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | マルチ波形オーディオ信号ジェネレーター | [詳細](plugins/others.md#oscillator) |
| Control   | Section | 複数エフェクトをまとめて一元制御 | [詳細](plugins/control.md) |

## 技術情報

### ブラウザ互換性

Frieve EffeTuneはGoogle Chromeで動作することがテストされ、確認されています。本アプリケーションは以下の機能をサポートする最新のブラウザが必要です:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### ブラウザサポートの詳細

1. Chrome/Chromium
   - 完全にサポートされ、推奨されています
   - 最適なパフォーマンスのために最新バージョンに更新してください

2. Firefox/Safari
   - サポートは限定的です
   - 一部の機能は期待通りに動作しない場合があります
   - 最良の体験のためにChromeの使用を検討してください

### 推奨サンプルレート

非線形エフェクトを最適に動作させるために、EffeTuneは96kHz以上のサンプルレートで使用することを推奨します。この高いサンプルレートにより、サチュレーションやコンプレッションなどの非線形エフェクト処理時に理想的な特性が得られます。

## 開発ガイド

自分だけのオーディオプラグインを作成してみたいですか？ 詳細は[プラグイン開発ガイド](../../plugin-development.md)をご覧ください。
デスクトップアプリをビルドしたいですか？ [ビルドガイド](../../../BUILD.md)をご覧ください。

## リンク

[バージョン履歴](../../version-history.md)

[ソースコード](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)
