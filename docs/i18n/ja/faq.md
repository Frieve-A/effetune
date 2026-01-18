---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
---

# EffeTune FAQ

EffeTuneはオーディオ愛好家向けのリアルタイムDSP（デジタル・シグナル・プロセッサ）アプリです。ウェブ版（ブラウザ）とデスクトップ版（Electron）の2系統を提供しており、どちらも同一のエフェクト群・操作体系で動作します。本ドキュメントでは導入・設定・トラブルシューティング・マルチチャンネル運用・エフェクト操作・周波数特性補正までを網羅的に解説します。

## 目次

1. ストリーミング再生のための初期セットアップ  
 1.1. VB-CABLEの導入と96 kHz化  
 1.2. ストリーミングサービス入力(Spotify例)  
 1.3. EffeTuneのオーディオ設定  
 1.4. 動作確認  
2. トラブルシューティング  
 2.1. オーディオ再生品質  
 2.2. CPU使用率  
 2.3. エコー  
 2.4. 入力／出力／エフェクトの不具合  
 2.5. マルチチャンネル出力の不整合  
3. マルチチャンネル&ハードウェア接続  
 3.1. HDMI+AVアンプ  
 3.2. 標準ドライバがマルチチャンネルに非対応のオーディオインターフェイス(例:MOTU M4)  
 3.3. チャンネルディレイ&タイムアライメント  
 3.4. 8ch上限と拡張要望について  
4. よくある質問(FAQ)  
5. 周波数特性補正・音場補正  
6. エフェクト操作Tips  
7. 参考リンク  

---

## 1. ストリーミング再生のための初期セットアップ

Windows環境でSpotify→VB-CABLE→EffeTune→DAC/AMPによる再生を例に説明します。他のストリーミングサービスやOSでも概念は同じです。

### 1.1. VB-CABLEの導入と96 kHz化
VB-CABLE Driver Pack45をダウンロードしてVBCABLE_Setup_x64.exeを管理者権限で実行し、PCを再起動します。  
再起動直後、OSの既定出力がCABLE Inputに変更されていますので、設定→システム→サウンド→出力で元のスピーカー／DACを既定に戻します。  
設定→システム→サウンドを開き、出力のCABLE Input/入力のCABLE Outputの形式をともに24-bit, 96 000 Hzに設定します。  
VBCABLE_ControlPanel.exe（VB Cableのインストールフォルダやzipに含まれる）を管理者権限で起動し、Menu▸Internal Sample Rate=96000 Hzを選択後Restart Audio Engineをクリックします。  
管理者権限で実施しないと再起動時に48 kHzに戻ります。必ず管理者権限で変更してください。  
VB Cable使用時、24 kHz以上に折り返しノイズが発生する場合は48 kHz動作が原因です。必ず96 kHz化を確認してください。

### 1.2. ストリーミングサービス入力(Spotify例)
設定→システム→サウンド→音量ミキサーを開き、アプリ一覧からSpotify.exeの出力デバイスをCABLE Inputに変更します。
この時点で曲を再生し、無音になっていればルーティング成功です。
macOSでは Rogue Amoeba製の **SoundSource** などを使い、Spotifyの出力を同様に **CABLE Input** に割り当ててください.

### 1.3. EffeTuneのオーディオ設定
アプリ版EffeTuneを起動し、右上**オーディオ設定**を開きます。  
* 入力デバイス:CABLE Output(VB-Audio Virtual Cable)  
* 出力デバイス:物理DAC/スピーカー  
* Sample Rate=96 000 Hz(96 kHz未満では内部処理が最適化されず、特に歪み系エフェクトで音質が劣化)

### 1.4. 動作確認
Spotifyを再生したままEffeTuneのマスターON/OFFを切り替え、音質変化を確認します。

---

## 2. トラブルシューティング

### 2.1. オーディオ再生品質の問題

| 症状 | 対処 |
| ------ | ------ |
| ドロップアウト／グリッチ | 1)ウェブ版は左上オーディオのリセット、デスクトップ版は表示▸リロードでオーディオパイプラインを再構築。2)アクティブなエフェクト数を減らす。3)デスクトップ版ではオーディオ設定▸レイテンシを大きめに設定し安定性を向上(映像との同期ズレ注意)。 |
| 音が歪む／クリップ | チェーン末尾にLevel Meterを挿入し0 dBFSを超えないよう調整。必要に応じBrickwall LimiterをLevel Meter直前に追加。 |
| 20 kHz以上に折り返しノイズ | VB-CABLEの内部サンプルレートが48 kHzのまま。初期セットアップを再確認。 |

### 2.2. CPU使用率が高すぎる
使用していないエフェクトを無効化するかEffect Pipelineから外してください。

### 2.3. エコーが発生する
入出力デバイスが誤ってループバック構成になっている可能性。EffeTune出力が再びEffeTune入力へ戻っていないか確認。

### 2.4. 入力／出力／エフェクトの不具合

| 症状 | 対処 |
| ------ | ------ |
| オーディオ入力がない | 1)再生アプリが正しくCABLE Inputへ出力しているか確認。2)ウェブ版はブラウザのマイク権限を許可し入力デバイスにCABLE Outputを選択。3)デスクトップ版も同様。 |
| エフェクトが動作しない | 1)マスター/各エフェクト/SectionのON/OFF確認。2)パラメータを初期値にリセットし再調整。 |
| オーディオ出力がない | 1)ウェブ版はOS既定音声出力とブラウザ出力が物理DAC/AMPになっているか確認。2)デスクトップ版はオーディオ設定で出力デバイスを確認。 |
| 他プレーヤーでCABLE Input in useエラー | 他アプリがCABLE Inputを占有していないか確認。 |

### 2.5. マルチチャンネル出力の不整合
EffeTuneは1→2→…→8 ch順で信号を出力しますが、Windowsスピーカー構成が4 chの場合、リア(3+4 ch)がセンター+サブに割り当てられることがあります。  
**回避策:** オーディオデバイス構成を7.1 chに設定し、EffeTune出力も8 chに設定、リア信号を5,6 chとして扱う。

---

## 3. マルチチャンネル&ハードウェア接続

### 3.1. HDMI+AVアンプ
PCのHDMI出力を7.1 chとして設定しAVアンプのHDMI入力へ接続。EffeTuneからは最大8 chまで送出可能。  
**メリット:** ケーブル1本で8 ch伝送できコスパ高。既存機器との切替え容易。  
**デメリット:** 古いAVアンプで音質劣化例あり。チャンネルリマッピング機能が意図せず働く場合あり。

### 3.2. マルチチャンネル非対応インターフェイス(MOTU M4等)
Out 1-2/Out 3-4を別デバイスとして認識し4 ch一括出力不可。  
**対応方法:**  
* Voicemeeterでマルチチャンネル出力を受けASIOドライバー経由でM4の4 chを統合  
* ASIO Link Proで4 chを1仮想デバイスとして公開(高難度だが柔軟)

### 3.3. チャンネルディレイ&タイムアライメント
Basic▸MultiChannel PanelまたはDelay▸Time Alignmentで各チャンネルを10 µs単位(最小1サンプル)で遅延。Bluetoothリア等で遅延が大きい場合はフロント側を100-400 ms遅延。マイナス遅延不可のため映像同期はプレーヤー側で映像を遅延。

### 3.4. 8ch上限と拡張要望
現行Windows/macOS/Linuxの標準ドライバは8 ch(7.1)出力が上限。10 ch以上はOS対応次第、EffeTune側で対応容易。

---

## 4. よくある質問(FAQ)

| 質問 | 回答 |
|------|------|
| サラウンド入力(5.1 ch等)対応? | Web Audio API制限で入力は最大2 ch。出力/エフェクトは8 ch対応。 |
| 推奨エフェクトチェーン長? | CPUが許す限り自由。音切れ・レイテンシーが出ない範囲で無制限。 |
| 最高音質を得るには? | 96 kHz以上を使用し控えめ設定から開始。チェーン末尾にLevel Meterを挿入しヘッドルーム監視、必要に応じBrickwall Limiterで歪み防止。 |
| どんなソースでも動作? | はい。仮想オーディオデバイス経由でストリーミング/ローカル/物理機器等任意ソース処理可能。 |
| AVアンプとインターフェイスどちらが経済的? | 既機器活用ならHDMI接続AVアンプが手軽。PC中心ならマルチチャンネル対応インターフェイス+小型D級アンプがコスト・音質両面有利。 |
| VB-CABLE導入直後に他アプリの音が出ない | OS既定出力がCABLE Inputに切替ったため。サウンド設定で元へ戻す。 |
| 4 ch分離後に3+4 chのみボリューム制御 | VolumeエフェクトをSplitter下流に配置しChannelを3+4に設定。分岐前に置くと全chが変化。 |

---

## 5. 周波数特性補正・音場補正

### 5.1. 15Band PEQへAutoEQ設定インポート
EffeTune v1.51以降、右上ボタンからAutoEQイコライザ設定を直接インポート可能。

### 5.2. 測定・補正設定のPipelineペースト
測定画面でコピーした5Band PEQ設定をEffect PipelineビューでCtrl+Vペースト。メニュー貼付でも同様。

---

## 6. エフェクト操作Tips
* 信号フローは最上段→最下段。  
* Matrixエフェクトで2→4 chや8→2 ch変換を自由構築(バスルーティングでChannel=All)。  
* MultiChannel Panelで8 ch分のレベル/ミュート/ディレイを一括管理。

---

## 7. 参考リンク
* EffeTune Desktop: <https://github.com/Frieve-A/effetune/releases>  
* EffeTune Web版: <https://effetune.frieve.com/features/measurement/measurement.html>  
* VB-CABLE: <https://vb-audio.com/Cable/>  
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>  
* ASIO Link Pro(非公式修正版): 検索で"ASIO Link Pro 2.4.1"を参照
