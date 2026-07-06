# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="主な操作">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Webアプリを開く</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">PWA版をインストール</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">デスクトップアプリをダウンロード</a>
</div>

オーディオ愛好家のためのリアルタイムオーディオエフェクトプロセッサです。EffeTuneを使うと、あらゆるオーディオソースに高品質なエフェクトをかけ、リスニング体験をリアルタイムで好みに合わせて調整できます。

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 紹介動画

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## コンセプト

EffeTuneは、音楽をもっと好みの音で楽しみたいオーディオ愛好家のために作られました。ストリーミングで聴く場合でも、物理メディアで再生する場合でも、EffeTuneなら高品質なエフェクトを加え、好みに合わせて音を調整できます。あなたのコンピュータを、オーディオソースとスピーカーまたはアンプの間に置ける強力なオーディオエフェクトプロセッサに変えましょう。

オーディオの迷信ではなく、科学に基づいた音作りを。

## 機能

- リアルタイムオーディオ処理
- エフェクトチェーン構築のためのドラッグ＆ドロップインターフェース
- カテゴリ別に整理された拡張可能なエフェクトシステム
- ライブオーディオビジュアライゼーション
- リアルタイムで変更可能なオーディオパイプライン
- 現在のエフェクトチェーンを使用したオフラインオーディオファイル処理
- システムキャリブレーションのための周波数特性測定と補正機能
- マルチチャンネル処理と出力
- スマートフォンやタブレットで使いやすいWebレイアウト
- Webアプリでの設定とオーディオ設定のブラウザ内保存
- インストール可能で、アプリ本体をオフラインでも開けるWebアプリ

## セットアップガイド

EffeTuneを使う前に、オーディオルーティングの設定が必要です。各種オーディオソースの設定方法は以下のとおりです:

### 音楽ファイルプレーヤーのセットアップ

- ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
- 音楽ファイルを開いて再生し、正常に再生されることを確認する
   - 音楽ファイルを開き、アプリケーションとしてEffeTuneを選択する（デスクトップアプリのみ）
   - またはファイルメニューから「音楽ファイルを開く...」を選択する（デスクトップアプリのみ）
   - または音楽ファイルをウィンドウにドラッグする
- 音楽ファイルプレーヤーだけで使う場合は、オーディオ設定の入力デバイスで「なし（音楽ファイルプレーヤー専用）」を選ぶと、ライブ入力を使わずに再生できます

### ストリーミングサービスのセットアップ

ストリーミングサービス（Spotify、YouTube Musicなど）からオーディオを処理するには:

1. 前提条件:
   - 仮想オーディオデバイスをインストールする（例: VB Cable、Voice Meeter、または ASIO Link Tool）
   - ストリーミングサービスの出力先を仮想オーディオデバイスに設定する

2. 設定:
   - ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
   - 入力ソースとして仮想オーディオデバイスを選択する
     - Chromeでは、初めて開いたときにオーディオ入力を選択して許可するダイアログボックスが表示されます
     - **設定** メニューの **オーディオ設定** から、入出力デバイスやオーディオ形式を選択します
   - ストリーミングサービスで音楽を再生する
   - EffeTuneを通じてオーディオが流れていることを確認する
   - より詳細なセットアップ手順については[FAQ](faq.md)を参照

### 外部オーディオ機器のセットアップ

CDプレーヤー、ネットワークプレーヤー、またはその他の外部オーディオ機器でEffeTuneを使うには:

- オーディオインターフェースをコンピュータに接続する
- ブラウザでEffeTuneウェブアプリを開く、またはEffeTuneデスクトップアプリを起動する
- 入力ソースと出力先としてオーディオインターフェースを選択する
   - Chromeでは、初めて開いたときにオーディオ入力を選択して許可するダイアログボックスが表示されます
   - **設定** メニューの **オーディオ設定** から、入出力デバイスやオーディオ形式を選択します
- これにより、オーディオインターフェースは以下のように機能します:
   * **Input:** CDプレーヤー、ネットワークプレーヤー、またはその他のオーディオソース
   * **Processing:** EffeTuneによるリアルタイムエフェクト処理
   * **Output:** アンプまたはスピーカーへ送られる処理済みオーディオ

## 使用方法

### エフェクトチェーンの作成

1. 画面左側に利用可能なエフェクトの一覧が表示されます
   - 一覧の横にある検索ボタンを使用してエフェクトを絞り込みます
   - 名前またはカテゴリでエフェクトを検索するには、任意のテキストを入力してください  
   - ESCキーを押して検索をクリアします
2. リストからエフェクトをドラッグして、**Effect Pipeline** エリアに配置します
   - モバイルでは **Effects** タブを開き、+ ボタンから全画面リストを表示してエフェクトを追加します
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
   - SectionのON/OFFを切り替えると、各エフェクト自身のON/OFF状態を保ったまま、そのセクション全体をバイパスまたは復帰できる
   - 複数のSectionエフェクトを使用して、エフェクトチェーンを論理的なグループに整理する
   - [制御エフェクトの詳細](plugins/control.md)

### ABパイプライン機能の使用

1. **ABパイプライン概要:**
   - EffeTuneでは2つの独立したエフェクトパイプライン（パイプラインAとパイプラインB）を使えます
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

4. **ブラインドテスト:**
   - どちらが再生されているか分からない状態で、パイプラインAとパイプラインBを聴き比べます
   - ABXテストで2つのパイプラインを本当に聞き分けられるかを確認したり、A/B比較テストでどちらが好みかを判定したりでき、統計的有意性も確認できます
   - A/B切り替えボタン右の▼パイプラインメニューから開きます（デスクトップアプリではファイルメニューからも開けます）
   - [ブラインドテストの詳細](double-blind-test.md)

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
   - 複数ファイルの場合、処理開始前に出力フォルダを選択し、各ファイルは完了次第そのフォルダへ直接保存される
   - フォルダ選択に対応していない古いブラウザでは、複数ファイルはZIPファイルにまとめてダウンロードされる

### エフェクトチェーンの共有

他のユーザーとエフェクトチェーンの設定を共有できます:
1. 希望のエフェクトチェーンを設定したら、**Effect Pipeline** エリアの右上にある **共有** ボタンをクリックする
2. ウェブアプリのURLが自動的にクリップボードにコピーされる
3. コピーされたURLを他のユーザーと共有する ― 共有されたURLを開くことで、まったく同じエフェクトチェーンを再現できます
4. 共有URLには再現に必要なエフェクト設定が保存されます。通常の作業状態はWebアプリがブラウザ内にも保存します
5. デスクトップアプリ版では、ファイルメニューからeffetune_presetファイルに設定をエクスポートできます
6. エクスポートしたeffetune_presetファイルを共有してください。effetune_presetファイルはウェブアプリウィンドウにドラッグして読み込むこともできます

### オーディオのリセット

オーディオの問題（ドロップアウト、グリッチ）が発生した場合:
1. **設定** メニューまたはモバイルのオーバーフローメニューから **オーディオをリセット** を選択します。デスクトップアプリでは **表示** メニューの **リロード** も使えます
2. オーディオパイプラインが自動的に再構築される
3. エフェクトチェーンの設定は保持される

### 周波数特性測定と補正

オーディオシステムの周波数特性を測定し、フラットな補正EQを作成するには:
1. [周波数応答測定ツール](https://effetune.frieve.com/features/measurement/measurement.html)を開くか、**設定** メニューから **周波数応答測定** を選択します
2. ガイドに従って測定用マイクと出力デバイスを設定する
3. 一つまたは複数のリスニングポジションでシステムの周波数特性を測定する
4. EffeTuneに直接インポート可能なパラメトリックEQ補正を生成する
5. 補正を適用して、より正確でニュートラルなサウンド再生を実現する

## よく使われるエフェクトの組み合わせ

あなたのリスニング体験を向上させるための人気のエフェクト組み合わせをいくつかご紹介します:

### ヘッドホン強化

1. Stereo Blend -> RS Reverb  
   - **Stereo Blend:** 快適な音場を実現するためにステレオ幅を調整する (60-100%)  
   - **RS Reverb:** 控えめな部屋の響きを追加する (10-20% mix)
   - **結果:** より自然で耳が疲れにくいヘッドホンでのリスニング体験

### レコード風シミュレーション

1. Wow Flutter -> Noise Blender -> Saturation  
   - **Wow Flutter:** やわらかなピッチの変動を加える  
   - **Noise Blender:** レコードらしい雰囲気を作り出す
   - **Saturation:** アナログ的な温かみを加える  
   - **結果:** 本物らしいレコード再生の雰囲気

### FMラジオ風

1. Multiband Compressor -> Stereo Blend  
   - **Multiband Compressor:** ラジオ風のサウンドを作り出す
   - **Stereo Blend:** 快適な音場のためにステレオ幅を調整する (100-150%)  
   - **結果:** FMラジオ風に整ったサウンド

### ローファイ感

1. Bit Crusher -> Simple Jitter -> RS Reverb  
   - **Bit Crusher:** レトロな雰囲気のためにビット深度を削減する  
   - **Simple Jitter:** デジタルな不完全さを加える  
   - **RS Reverb:** 雰囲気のある空間を作り出す
   - **結果:** 昔ながらのローファイ感

## トラブルシューティングとFAQ

何らかの問題が発生している場合は[トラブルシューティングとFAQ](faq.md)をご参照ください。

問題が解決されない場合は[GitHub Issues](https://github.com/Frieve-A/effetune/issues)にご報告ください。

## 利用可能なエフェクト

| カテゴリ    | エフェクト             | 説明                                                                  | ドキュメント                                             |
|-----------|---------------------|---------------------------------------------------------------------|---------------------------------------------------------|
| Analyzer  | Level Meter         | ピークホールド機能付きのオーディオレベルを表示                                     | [詳細](plugins/analyzer.md#level-meter)               |
| Analyzer  | Oscilloscope        | リアルタイムで波形を可視化                                                   | [詳細](plugins/analyzer.md#oscilloscope)              |
| Analyzer  | Spectrogram         | 時間経過に伴う周波数スペクトルの変化を表示                                         | [詳細](plugins/analyzer.md#spectrogram)               |
| Analyzer  | Spectrum Analyzer   | 低域・中域・高域の強さをリアルタイムに表示                                                  | [詳細](plugins/analyzer.md#spectrum-analyzer)         |
| Analyzer  | Stereo Meter        | ステレオバランスとチャンネル相関を可視化                                              | [詳細](plugins/analyzer.md#stereo-meter)              |
| Basics    | Channel Divider     | ステレオ信号を周波数帯域に分割し、各帯域を別々のステレオ出力ペアへルーティング                         | [詳細](plugins/basics.md#channel-divider)             |
| Basics    | DC Offset           | DCオフセットの調整                                                        | [詳細](plugins/basics.md#dc-offset)                   |
| Basics    | Matrix              | オーディオチャンネルを柔軟に割り当て、混ぜ合わせる                                  | [詳細](plugins/basics.md#matrix)                      |
| Basics    | MultiChannel Panel  | 複数チャンネルを音量、ミュート、ソロ、遅延で個別制御するコントロールパネル                   | [詳細](plugins/basics.md#multichannel-panel)          |
| Basics    | Mute                | オーディオ信号を完全に無音化                                                   | [詳細](plugins/basics.md#mute)                        |
| Basics    | Polarity Inversion  | 信号の極性を反転                                                          | [詳細](plugins/basics.md#polarity-inversion)          |
| Basics    | Stereo Balance      | ステレオチャンネルのバランスを制御                                              | [詳細](plugins/basics.md#stereo-balance)              |
| Basics    | Volume              | 基本的なボリューム制御                                                       | [詳細](plugins/basics.md#volume)                      |
| Delay     | Delay          | 標準的なディレイエフェクト                                   | [詳細](plugins/delay.md#delay) |
| Delay     | Time Alignment | スピーカーやリスニング位置の調整に使う再生タイミングを微調整 | [詳細](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | 一貫したリスニング体験のためにLUFS測定に基づいて自動的に音量を調整 | [詳細](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | 安全で快適なリスニングのための透過的なピーク制御 | [詳細](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | 急に大きくなる部分をなめらかにし、より聴きやすくする | [詳細](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | しきい値以下の静かな音をさらに抑え、自然な強弱のコントラストを取り戻す | [詳細](plugins/dynamics.md#expander) |
| Dynamics  | Gate | 無音部や静かな部分の小さな音を抑える | [詳細](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | 安定したラジオ風のリスニングサウンドに整える5バンド音量バランス処理 | [詳細](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | 平坦に感じる録音の自然なコントラストを戻す5バンドエクスパンダー | [詳細](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | 低域・中域・高域のアタックとサステインを個別に整える | [詳細](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | 高負荷時のパワーアンプの電圧降下をシミュレート | [詳細](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | アタックとサステインを整え、音楽のパンチや厚みを調整 | [詳細](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | 15バンドグラフィックイコライザー | [詳細](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | リスニング用の細かな音色調整に使える15バンドパラメトリックイコライザー | [詳細](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | しきい値に基づく周波数調整が可能な5バンドダイナミックイコライザー | [詳細](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | 低域・中域・高域を整えやすい柔軟な5バンドイコライザー | [詳細](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | 特定の周波数に焦点を当てる | [詳細](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | フェイザー風、空洞感、金属的な色づきを追加 | [詳細](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | 通常範囲のイヤホンケーブル差による周波数特性変化の小ささを確認 | [詳細](plugins/eq.md#earphone-cable-sim) |
| EQ        | Hi Pass Filter | 不要な低域を精密に除去 | [詳細](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | 不要な高域を精密に除去 | [詳細](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | 低音量リスニング向けの周波数バランス補正 | [詳細](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | ハイパスフィルターとローパスフィルターの組み合わせ | [詳細](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ      | クイックトーンシェイピング用のチルトイコライザー      | [詳細](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | 3バンドトーンコントロール | [詳細](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | ビット深度削減とゼロオーダーホールド効果 | [詳細](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | 様々なデジタルオーディオ伝送エラーとビンテージデジタル機器の特性をシミュレート | [詳細](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | DSD64の超音波ノイズに由来する可聴域の相互変調歪み（IMD）をシミュレート | [詳細](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | Hum Generator | ビンテージ/ローファイ風の50/60 Hz電源ハムの雰囲気を調整して追加 | [詳細](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | ローファイな雰囲気のための背景ノイズ質感を調整して追加 | [詳細](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | デジタルジッターシミュレーション | [詳細](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | レコード風のポップノイズ、クラックル、ヒス、ランブル、ステレオノイズ漏れを追加 | [詳細](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | スピーカーコーンの微細な動きによる自然でダイナミックな音変化をシミュレート | [詳細](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | テンポを変えずに音楽のピッチを上げ下げ | [詳細](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | 音量ベースのモジュレーション効果 | [詳細](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | テープやレコード風のさりげないピッチ揺れでビンテージ感を追加 | [詳細](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | カスタマイズ可能な寸法でのホーン共振シミュレーション | [詳細](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | より滑らかなホーンスピーカー共振で自然なリスニング向けの色づきを追加 | [詳細](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 最大5つのレゾネーターを備えた周波数共振効果 | [詳細](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Dattorroアルゴリズムに基づくクラシックなプレートリバーブ | [詳細](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | リッチで密度の高いリバーブテクスチャを生成するフィードバック・ディレイ・ネットワーク・リバーブ | [詳細](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | 自然な拡散を伴うランダム散乱リバーブ | [詳細](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | スピーカーコーンの非線形変位をシミュレート | [詳細](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | 明瞭さと存在感を高める倍音成分を追加 | [詳細](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | デジタルハードクリッピング効果 | [詳細](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 2次から5次の倍音歪みを調整してキャラクターを追加 | [詳細](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | 低域・中域・高域に温かみやエッジを別々に追加 | [詳細](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | アナログ風の温かい豊かさとキャラクターを追加 | [詳細](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | ベース強化のため、フィルター処理した低周波信号をミックス | [詳細](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | 自然なステレオイメージのためのヘッドホン用クロスフィードフィルター | [詳細](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | 中央と左右の響きを調整するため、ステレオとMid/Sideを相互変換 | [詳細](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | 5バンド周波数依存のステレオバランス制御 | [詳細](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | モノラルから拡張ステレオまでステレオ幅を制御 | [詳細](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | スピーカーやヘッドホン確認用のテストトーン/ノイズジェネレーター | [詳細](plugins/others.md#oscillator) |
| Control   | Section | 複数のエフェクトをグループ化し、セクション全体をバイパスまたは復帰 | [詳細](plugins/control.md) |

## 技術情報

### ブラウザ互換性

Frieve EffeTuneはGoogle Chromeで動作確認済みです。本アプリケーションには、以下の機能をサポートする最新のブラウザが必要です:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker（インストール可能なWebアプリとオフライン起動用）

### ブラウザサポートの詳細

1. Chrome/Chromium
   - 正式にサポートしており、推奨ブラウザです
   - 最適なパフォーマンスのために最新バージョンに更新してください

2. Firefox/Safari
   - サポートは限定的です
   - 出力デバイス選択、Wake Lock、インストール動作、対応オーディオ形式などはブラウザによって異なります
   - 最良の体験のためにChromeの使用を検討してください

### 推奨サンプルレート

非線形エフェクトを最適に動作させるために、EffeTuneは96kHz以上のサンプルレートで使用することを推奨します。この高いサンプルレートにより、サチュレーションやコンプレッションなどの非線形エフェクト処理時に理想的な特性が得られます。

## 開発ガイド

自分だけのオーディオプラグインを作成してみたいですか？ 詳細は[プラグイン開発ガイド](../../plugin-development.md)をご覧ください。
EffeTuneをビルドまたはパッケージ化したいですか？ [ビルドガイド](../../../BUILD.md)をご覧ください。

## リンク

[バージョン履歴](../../version-history.md)

[ソースコード](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Ko-fiで支援する](https://ko-fi.com/frievea)
