# サチュレーションプラグイン

音楽に温かみと個性を加えるプラグインのコレクションです。これらのエフェクトは、デジタル音楽をよりアナログ的に響かせ、ビンテージオーディオ機器が音に与えるような心地よい豊かさを追加することができます。

## プラグイン一覧

- [Hard Clipping](#hard-clipping) - サウンドに強さとエッジを追加
- [Multiband Saturation](#multiband-saturation) - 異なる周波数帯域を独立して形成・強調
- [Saturation](#saturation) - ビンテージ機器のような温かみと豊かさを追加
- [Sub Synth](#sub-synth) - 低域強調のためのサブハーモニック信号の生成とブレンド

## Hard Clipping

微妙な温かみから強烈な個性まで、音楽に追加できるエフェクトです。音波を穏やかにまたは積極的に整形することで、穏やかな強調からドラマチックなエフェクトまで、様々な効果を生み出します。

### リスニング向上ガイド
- 微妙な強調:
  - デジタル音楽をわずかに温かく
  - 穏やかな「アナログ的な」質感を追加
  - 明瞭さを保ちながら耳障りさを低減
- 中程度のエフェクト:
  - よりエネルギッシュなサウンドを作成
  - リズム要素に躍動感を追加
  - 音楽により「駆動感」を与える
- クリエイティブエフェクト:
  - ドラマチックなサウンド変換を作成
  - 音楽にアグレッシブな個性を追加
  - 実験的なリスニングに最適

### パラメータ
- **Threshold** - サウンドへの影響量を制御(-60dBから0dB)
  - 高い値(-6dBから0dB):微妙な温かみ
  - 中間値(-24dBから-6dB):目立つ個性
  - 低い値(-60dBから-24dB):ドラマチックな効果
- **Mode** - サウンドのどの部分に影響を与えるかを選択
  - Both Sides:バランスの取れた、自然な感じのエフェクト
  - Positive Only:より明るく、アグレッシブなサウンド
  - Negative Only:より暗く、ユニークな個性

### 視覚的表示
- サウンドの整形方法をリアルタイムで表示するグラフ
- 設定を調整する際の明確な視覚的フィードバック
- 調整の目安となる参照ライン

### リスニングのヒント
- 微妙な強調のために:
  1. 高いThreshold(-6dB)から開始
  2. "Both Sides"モードを使用
  3. 追加された温かみに注目
- クリエイティブエフェクトのために:
  1. Thresholdを徐々に下げる
  2. 異なるModeを試す
  3. 他のエフェクトと組み合わせてユニークなサウンドを作成

## Multiband Saturation

音楽の特定の周波数帯域に温かみと個性を追加できる多目的なエフェクトです。サウンドを低域、中域、高域に分割することで、各帯域を独立して形成し、精密なサウンド強調を実現します。

### リスニング向上ガイド
- 低域の強調:
  - 低周波数に温かみとパンチを追加
  - ベースギターやキックドラムの強調に最適
  - より充実した、豊かな低域を作成
- 中域の形成:
  - ボーカルや楽器の芯を引き出す
  - ギターやキーボードの存在感を追加
  - より明確で、定義された音を作成
- 高域の甘さ付け:
  - シンバルやハイハットに輝きを追加
  - 空気感と煌めきを強調
  - クリスプで詳細な高域を作成

### パラメータ
- **クロスオーバー周波数**
  - Freq 1 (20Hz-2kHz): 低域バンドが終わり中域バンドが始まる位置を設定
  - Freq 2 (200Hz-20kHz): 中域バンドが終わり高域バンドが始まる位置を設定
- **バンドコントロール** (低域、中域、高域の各バンド):
  - **Drive** (0.0-10.0): サチュレーションの強さを制御
    - 軽め(0.0-3.0): 微妙な強調
    - 中程度(3.0-6.0): 目立つ温かみ
    - 強め(6.0-10.0): 強い個性
  - **Bias** (-0.3から0.3): サチュレーションカーブの対称性を調整
    - マイナス: 負のピークを強調
    - ゼロ: 対称的なサチュレーション
    - プラス: 正のピークを強調
  - **Mix** (0-100%): エフェクトとオリジナルをブレンド
    - 低め(0-30%): 微妙な強調
    - 中程度(30-70%): バランスの取れた効果
    - 高め(70-100%): 強い個性
  - **Gain** (-18dBから+18dB): バンドの音量を調整
    - バンド間のバランスを取るために使用
    - 音量変化を補正

### 視覚的表示
- インタラクティブなバンド選択タブ
- 各バンドのリアルタイム伝達カーブグラフ
- 設定調整時の明確な視覚的フィードバック

### 音楽向上のヒント
- 全体的なミックスの強調:
  1. 全バンドで穏やかなDrive(2.0-3.0)から開始
  2. 自然なサチュレーションのためにBiasを0.0に保持
  3. 自然なブレンドのためにMixを40-50%に設定
  4. 各バンドのGainを微調整

- 低域の強調:
  1. 低域バンドに注目
  2. 中程度のDrive(3.0-5.0)を使用
  3. 一貫した反応のためにBiasをニュートラルに保持
  4. Mixを50-70%に保持

- ボーカルの強調:
  1. 中域バンドに注目
  2. 軽めのDrive(1.0-3.0)を使用
  3. 自然な音のためにBiasを0.0に保持
  4. お好みでMixを調整(30-50%)

- 明るさの追加:
  1. 高域バンドに注目
  2. 穏やかなDrive(1.0-2.0)を使用
  3. クリーンなサチュレーションのためにBiasをニュートラルに保持
  4. Mixを控えめに(20-40%)

### クイックスタートガイド
1. クロスオーバー周波数を設定してサウンドを分割
2. 全バンドで低いDrive値から開始
3. 最初はBiasを0.0に保持
4. Mixを使用してエフェクトを自然にブレンド
5. Gainコントロールで微調整
6. 耳を信頼して好みに調整!

## Saturation

ビンテージチューブ機器の温かく心地よいサウンドをシミュレートするエフェクトです。音楽に豊かさと個性を追加し、より「アナログ」的で「デジタル」感の少ないサウンドを作り出すことができます。

### リスニング向上ガイド
- 温かみの追加:
  - デジタル音楽をより自然に響かせる
  - サウンドに心地よい豊かさを追加
  - ジャズやアコースティック音楽に最適
- 豊かな個性:
  - より「ビンテージ」なサウンドを作成
  - 深みと次元を追加
  - ロックやエレクトロニック音楽に最適
- 強いエフェクト:
  - サウンドをドラマチックに変換
  - 大胆で個性的な音色を作成
  - 実験的なリスニングに理想的

### パラメータ
- **Drive** - 温かみと個性の量を制御(0.0から10.0)
  - 軽め(0.0-3.0):微妙なアナログの温かみ
  - 中程度(3.0-6.0):豊かなビンテージキャラクター
  - 強め(6.0-10.0):大胆でドラマチックな効果
- **Bias** - サチュレーションカーブの対称性を調整(-0.3から0.3)
  - 0.0:対称的なサチュレーション
  - プラス:正のピークを強調
  - マイナス:負のピークを強調
- **Mix** - エフェクトとオリジナルサウンドのバランス(0%から100%)
  - 0-30%:微妙な強調
  - 30-70%:バランスの取れたエフェクト
  - 70-100%:強い個性
- **Gain** - 全体的な音量を調整(-18dBから+18dB)
  - エフェクトが大きすぎる場合はマイナス値を使用
  - エフェクトが小さすぎる場合はプラス値を使用

### 視覚的表示
- サウンドの整形方法を示す明確なグラフ
- リアルタイムの視覚的フィードバック
- 見やすいコントロール

### 音楽向上のヒント
- クラシック & ジャズ:
  - 自然な温かみのために軽めのDrive(1.0-2.0)
  - クリーンなサチュレーションのためにBiasを0.0に保持
  - 控えめさのために低めのMix(20-40%)
- ロック & ポップス:
  - 豊かな個性のために中程度のDrive(3.0-5.0)
  - 一貫した反応のためにBiasをニュートラルに保持
  - バランスのために中程度のMix(40-60%)
- エレクトロニック:
  - 大胆な効果のためにより高いDrive(4.0-7.0)
  - 異なるBias値を試す
  - 個性のためにより高いMix(60-80%)

### クイックスタートガイド
1. 穏やかな温かみのために低いDriveから開始
2. 最初はBiasを0.0に保持
3. Mixでエフェクトのバランスを調整
4. 適切な音量のために必要に応じてGainを調整
5. 実験して耳を信頼しましょう!

## Sub Synth

サブハーモニック信号を生成・ブレンドして音楽の低域を強調する専門的なエフェクトです。低域が不足している録音に深みとパワーを追加したり、豊かで充実したベースサウンドを作成したりするのに最適です。

### リスニング向上ガイド
- 低域の強調:
  - 薄い録音に深みとパワーを追加
  - より充実した、豊かな低域を作成
  - ヘッドフォンでのリスニングに最適
- 周波数コントロール:
  - サブハーモニック周波数の精密な制御
  - クリーンな低域のための独立したフィルタリング
  - パワーを追加しながら明瞭さを維持

### パラメータ
- **Sub Level** - サブハーモニック信号のレベルを制御(0-200%)
  - 軽め(0-50%):微妙な低域強調
  - 中程度(50-100%):バランスの取れた低域ブースト
  - 強め(100-200%):ドラマチックな低域効果
- **Dry Level** - オリジナル信号のレベルを調整(0-200%)
  - サブハーモニック信号とのバランスを取るために使用
  - オリジナルサウンドの明瞭さを維持
- **Sub LPF** - サブハーモニック信号用ローパスフィルター(5-400Hz)
  - 周波数:サブの上限を制御
  - スロープ:フィルターの傾きを調整(Offから-24dB/oct)
- **Sub HPF** - サブハーモニック信号用ハイパスフィルター(5-400Hz)
  - 周波数:不要な低域ノイズを除去
  - スロープ:フィルターの傾きを制御(Offから-24dB/oct)
- **Dry HPF** - オリジナル信号用ハイパスフィルター(5-400Hz)
  - 周波数:低域の重なりを防止
  - スロープ:フィルターの傾きを調整(Offから-24dB/oct)

### 視覚的表示
- インタラクティブな周波数レスポンスグラフ
- フィルターカーブの明確な視覚化
- リアルタイムの視覚的フィードバック

### 音楽向上のヒント
- 一般的な低域強調:
  1. Sub Levelを50%から開始
  2. Sub LPFを100Hz付近に設定(-12dB/oct)
  3. Sub HPFを20Hzに保持(-6dB/oct)
  4. お好みでDry Levelを調整

- クリーンな低域ブースト:
  1. Sub Levelを70-100%に設定
  2. Sub LPFを80Hzで使用(-18dB/oct)
  3. Sub HPFを30Hzに設定(-12dB/oct)
  4. Dry HPFを40Hzで有効化

- 最大のインパクト:
  1. Sub Levelを150%まで上げる
  2. Sub LPFを120Hzに設定(-24dB/oct)
  3. Sub HPFを15Hzに保持(-6dB/oct)
  4. Dry Levelでバランスを取る

### クイックスタートガイド
1. 適度なSub Level(50-70%)から開始
2. Sub LPFを100Hz付近に設定
3. Sub HPFを20Hz付近で有効化
4. Dry Levelでバランスを調整
5. 必要に応じてフィルターを微調整
6. 耳を信頼して徐々に調整しましょう!
