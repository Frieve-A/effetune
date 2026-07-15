# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="主要操作">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">打开 Web App</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">安装 PWA 版</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">下载桌面应用</a>
</div>

一个实时音频效果处理器，旨在为音频爱好者提升音乐聆听体验。EffeTune 允许您通过各种高质量效果处理任何音频源，从而实时定制并完善您的聆听体验。

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 介绍视频

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## 概念

EffeTune 专为希望提升音乐聆听体验的音频爱好者而设计。无论您是在流媒体播放音乐，还是从实体介质播放，EffeTune 都能让您加入高质量效果，按自己的偏好调整声音。它可以把您的计算机变成一台强大的音频效果处理器，放在音频源与扬声器或功放之间。

拒绝音响神话，纯粹科学。

## 功能

- 实时音频处理
- 拖放式界面构建效果链
- 可扩展的分类效果系统
- 实时音频可视化
- 可实时修改的音频管道
- 使用当前效果链的离线音频文件处理
- 可浏览本地子文件夹、元数据和播放列表的音乐库
- 用于系统校准的频率响应测量与校正
- 多通道处理与输出
- Web/PWA 版和桌面版均支持节能功能，可设置静音时的处理方式和音频输入保留时间

## 设置指南

在使用 EffeTune 之前，您需要配置音频路由。以下是配置不同音频源的方法：

### 音乐文件播放器设置

- 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
- 打开并播放音乐文件以确保正常播放
   - 打开音乐文件并选择 EffeTune 作为应用程序（仅桌面应用）
   - 或从“文件”菜单选择“打开音乐文件…”（仅桌面应用）
   - 或将音乐文件拖入窗口
- 如果只使用音乐文件播放器，请在“音频设置”的输入设备中选择“无（仅音乐文件播放器）”，这样无需使用实时音频输入

### 流媒体服务设置

处理流媒体服务（如 Spotify、YouTube Music 等）的音频：

1. 前提条件：
   - 安装虚拟音频设备（例如 VB Cable、Voice Meeter 或 ASIO Link Tool）
   - 将您的流媒体服务配置为将音频输出到虚拟音频设备

2. 配置：
   - 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
   - 选择虚拟音频设备作为输入源
     - 在 Chrome 中，首次打开时会出现一个对话框，要求您选择并允许音频输入
     - 在桌面应用中，通过点击屏幕右上角的 Config Audio 按钮进行设置
   - 开始播放流媒体音乐
   - 确认音频通过 EffeTune 正常传输
   - 如需更详细的设置说明，请参阅[常见问题](faq.md)

### 外部音频设备设置

使用 EffeTune 处理 CD 播放器、网络播放器或其他外部音频设备：

- 将您的音频接口连接到计算机
- 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
- 选择您的音频接口作为输入和输出源
   - 在 Chrome 中，首次打开时会出现一个对话框，要求您选择并允许音频输入
   - 在桌面应用中，通过点击屏幕右上角的 Config Audio 按钮进行设置
- 您的音频接口现在充当多效果处理器：
   * Input: 您的 CD 播放器、网络播放器或其他音频源
   * Processing: 通过 EffeTune 进行实时效果处理
   * Output: 将处理后的音频输出到功放或扬声器

## 使用方法

### 应用设置

打开 **设置 > 配置...**，可选择语言、设置 **启动时显示:**，以及配置 Effect Pipeline 的启动方式。**启动时显示:** 可设为 **Effect Pipeline（默认）** 或 **音乐库**。选择 **音乐库** 后，可从旁边的列表选择首先显示的视图：**曲目**、**专辑**、**艺人**、**流派** 或 **子文件夹**。

### 用音乐库查找音乐

1. 在 PC 布局中，点击页眉中的 **音乐库** 按钮；在移动端，打开 **音乐库** 标签；在桌面应用中，也可以通过 **视图 > 音乐库** 打开。
2. 选择 **添加音乐文件夹**，为包含音乐文件的文件夹建立索引。
3. 可按曲目、专辑、艺人、流派、子文件夹、文件夹、最近添加和播放列表浏览，也可用 **搜索音乐库** 搜索整个音乐库。**子文件夹** 按各个导入根目录内的曲目所在路径分类，**文件夹** 则用于管理这些根目录。
4. 找到的曲目可以通过当前 Effect Pipeline 播放，并可用 **下一首播放**、**添加到队列**、**添加到播放列表** 管理播放顺序和播放列表。
5. 修改文件后使用 **重新扫描**；如果浏览器或文件夹权限失效，使用 **重新连接**。
   - [音乐库详情](music-library.md)

在 PC 和移动布局中，当曲目搜索或专辑、艺人、流派、子文件夹、播放列表详情的结果不超过 300 首时，所有曲目都会默认选中；达到 301 首时则不会自动选择。在移动端，自动选择只会改变选择状态。只有长按曲目才会进入选择模式并显示复选框、**全选** 和 **取消全选**；选择或取消选择曲目不会进入或退出该模式，同时仍可使用常用的行操作。

PC 上的 Chromium 浏览器可以持久保存 File System Access 文件夹句柄。Safari、Firefox、移动浏览器以及其他不支持该 API 的环境，只会在当前页面会话中保留所选的 `File` 对象。每次重新加载后都要重新选择文件夹或文件；EffeTune 会通过规范化的相对路径，将它们重新连接到现有目录。

2.1.0会从新的音乐库开始。之前的音乐库状态不会继承，请重新添加音乐文件夹并扫描；此过程不会修改文件夹中的音频文件。目录采用从磁盘分页读取的设计，可处理大型收藏。大规模性能测量只是可选的本地开发诊断，并非 commit、release、`verify` 或 GitHub Actions 的门槛，也不构成一般性的性能保证。

### 构建您的效果链

1. 屏幕左侧列出了 Available Effects
   - 使用 "Available Effects" 旁边的搜索按钮过滤效果
   - 输入任意文本以按名称或分类查找效果
   - 按 ESC 清除搜索
2. 将效果从列表拖放到 Effect Pipeline 区域
3. 效果按从上到下的顺序处理
4. 拖动手柄 (⋮) 或点击 ▲▼ 按钮重新排序效果
   - 对于Section效果：按住Shift键点击 ▲▼ 按钮可移动整个区段（从一个Section到下一个Section、管道开头或管道末尾）
5. 点击效果名称以展开/折叠其设置
   - 在Section效果上按住Shift键点击可折叠/展开该区段内的所有效果
   - 在其他效果上按住Shift键点击可折叠/展开除分析器类别以外的所有效果
   - 按住Ctrl键点击可折叠/展开所有效果
6. 使用 ON 按钮绕过单个效果
7. 点击 ? 按钮在新标签页中打开详细文档
8. 使用 × 按钮移除效果
   - 对于Section效果：按住Shift键点击 × 按钮可移除整个区段
9. 单击路由按钮以设置要处理的通道以及输入和输出总线
   - [更多关于总线功能的信息](bus-function.md)

### 使用 Presets

1. 保存您的效果链：
   - 设置好所需的效果链和参数
   - 在输入栏中输入您的 preset 名称
   - 点击 save 按钮保存您的 preset

2. 加载 Preset：
   - 在下拉列表中输入或选择 preset 名称
   - preset 将自动加载
   - 所有效果及其设置将被恢复

3. 删除 Preset：
   - 选择要删除的 preset
   - 点击 delete 按钮
   - 出现提示时确认删除

4. Preset 信息：
   - 每个 preset 存储了完整的效果链配置
   - 包括效果顺序、参数和状态

### 使用分组功能

1. 分组效果的使用：
   - 在效果链开始处添加一个分组效果
   - 在注释字段中输入描述性名称
   - 切换 Section 的 ON/OFF 会旁路或恢复该分组，同时保留每个效果自身的 ON/OFF 状态
   - 使用多个分组效果将效果链组织成逻辑分组
   - [更多关于控制效果的信息](plugins/control.md)

### 使用 AB Pipeline 功能

1. AB Pipeline 概述：
   - EffeTune 可以维护两个独立的 Effect Pipeline：Pipeline A 和 Pipeline B
   - 启动时只加载 Pipeline A，Pipeline B 会在需要时创建
   - 所有处理、保存、加载和编辑操作都作用于当前选定的 Pipeline

2. AB切换按钮：
   - 位于 Effect Pipeline 标题的右侧
   - 默认显示 "A"（Pipeline A 激活）
   - 点击可在 Pipeline A 和 Pipeline B 之间切换
   - 如果切换时 Pipeline B 不存在，Pipeline A 的设置会复制到 Pipeline B

3. AB菜单（下拉按钮）：
   - 位于AB切换按钮的右侧
   - "A → B"：将 Pipeline A 的设置复制到 Pipeline B 并切换到 Pipeline B
   - "B → A"：将 Pipeline B 的设置复制到 Pipeline A 并切换到 Pipeline A

4. Double Blind Test：
   - 在不知道当前播放的是哪一个的情况下，通过听感比较 Pipeline A 和 Pipeline B
   - 可用 ABX Test 检查自己是否真的能分辨两个 Pipeline，也可用 A/B Preference Test 判断更偏好哪一个，并同时查看统计显著性
   - 从 AB 切换按钮右侧的 ▼ Pipeline 菜单打开（桌面应用也可从“文件”菜单打开）
   - [Double Blind Test 详情](double-blind-test.md)

### 效果选择和键盘快捷键

1. 效果选择方法：
   - 点击效果标题以选择单个效果
   - 按住 Ctrl 键点击以选择多个效果
   - 点击 Pipeline 区域空白处取消所有效果的选择

2. 键盘快捷键：
   - Ctrl + Z: 撤销
   - Ctrl + Y: 重做
   - Ctrl + S: 保存当前流程
   - Ctrl + Shift + S: 另存为当前流程
   - Ctrl + X: 剪切选中的效果
   - Ctrl + C: 复制选中的效果
   - Ctrl + V: 从剪贴板粘贴效果
   - Ctrl + F: 搜索效果
   - Ctrl + A: 选择流程中的所有效果
   - Delete: 删除选中的效果
   - ESC: 取消选择所有效果
   - T: 在 Pipeline A 和 Pipeline B 之间切换
   - A: 切换到 Pipeline A
   - B: 切换到 Pipeline B

3. 键盘快捷键（使用播放器时）：
   - Space：播放/暂停
   - Ctrl + → 或 N：下一曲
   - Ctrl + ← 或 P：上一曲
   - Shift + → 或 F 或 .：快进10秒
   - Shift + ← 或 R 或 ,：后退10秒
   - Ctrl + M：切换循环模式
   - Ctrl + H：切换随机模式
   - T：切换 Pipeline A/B
   - A：切换到 Pipeline A
   - B：切换到 Pipeline B

### 处理音频文件

1. 文件拖放或文件指定区域：
   - 一个专用拖放区域始终显示在 Effect Pipeline 下方
   - 支持单个或多个音频文件
   - 文件将使用当前 Pipeline 设置进行处理
   - 所有处理均以 Pipeline 的采样率进行

2. 处理状态：
   - 进度条显示当前处理状态
   - 处理时间取决于文件大小和效果链复杂度

3. 下载或保存选项：
   - 处理后的文件以 WAV 格式输出
   - 处理多个文件时，处理开始前需选择输出文件夹，各文件完成后直接保存到该文件夹
   - 在不支持文件夹选择的旧版浏览器中，多个文件将打包成 ZIP 文件供下载

### 分享效果链

您可以与其他用户分享您的效果链配置：
1. 设置好所需的效果链后，点击 Effect Pipeline 区域右上角的 **Share** 按钮
2. 网页应用的 URL 会自动复制到剪贴板
3. 将复制的 URL 分享给他人 —— 他们可通过打开链接重现您完全相同的效果链
4. 在网页应用中，所有效果设置均存储在 URL 中，便于保存和分享
5. 在桌面应用版本中，可以从“文件”菜单将设置导出为 effetune_preset 文件
6. 分享导出的 effetune_preset 文件。effetune_preset 文件也可以通过拖入网页应用窗口加载

### 音频重置

如果您遇到音频问题（断音、杂音）：
1. 在网页应用中点击左上角的 **Reset Audio** 按钮，或在桌面应用中从“视图”菜单选择“重新加载”
2. 音频管道将自动重建
3. 您的效果链配置将被保留

### 频率响应测量与校正

测量音频系统的频率响应并生成平直校正 EQ：
1. 网页版请启动[频率响应测量工具](https://effetune.frieve.com/features/measurement/measurement.html)。桌面应用请从“设置”菜单选择“频率响应测量”。
2. 按照引导设置测量麦克风和输出设备
3. 在一个或多个聆听位置测量系统的频率响应
4. 生成可直接导入 EffeTune 的参数均衡校正
5. 应用校正，让播放更准确、更中性

## 常见效果组合

以下是一些流行的效果组合，旨在提升您的聆听体验：

### 耳机聆听优化
1. Stereo Blend -> RS Reverb
   - Stereo Blend: 调整立体声宽度以获得舒适感（60-100%）
   - RS Reverb: 添加微妙的房间氛围（混合比例 10-20%）
   - 结果: 更自然、更不易疲劳的耳机聆听体验

### 黑胶唱片模拟
1. Wow Flutter -> Noise Blender -> Saturation
   - Wow Flutter: 添加轻微的音高变化
   - Noise Blender: 营造出仿黑胶唱片的氛围
   - Saturation: 增加模拟暖音
   - 结果: 真实的黑胶唱片体验

### FM 电台风格
1. Multiband Compressor -> Stereo Blend
   - Multiband Compressor: 营造出"电台"般的声音
   - Stereo Blend: 调整立体声宽度以获得舒适感（100-150%）
   - 结果: FM 电台风格的顺滑声音

### Lo-Fi 质感
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - Bit Crusher: 降低位深以营造复古感觉
   - Simple Jitter: 添加数字瑕疵
   - RS Reverb: 营造出氛围空间
   - 结果: 经典的 lo-fi 美学

## 故障排除和常见问题

如果遇到问题，请参阅[常见问题](faq.md)。
若仍无法解决，请在[GitHub Issues](https://github.com/Frieve-A/effetune/issues)反馈。
## 可用效果

| 分类 | 效果 | 说明 | 文档 |
|-----------|--------|-------------|---------------|
| Analyzer  | Level Meter | 显示带峰值保持的音频电平 | [详情](plugins/analyzer.md#level-meter) |
| Analyzer  | Oscilloscope | 实时波形可视化 | [详情](plugins/analyzer.md#oscilloscope) |
| Analyzer  | Spectrogram | 显示频谱随时间的变化 | [详情](plugins/analyzer.md#spectrogram) |
| Analyzer  | Spectrum Analyzer | 实时显示低频、中频和高频的强弱 | [详情](plugins/analyzer.md#spectrum-analyzer) |
| Analyzer  | Stereo Meter | 可视化立体声平衡与声道相关性 | [详情](plugins/analyzer.md#stereo-meter) |
| Basics    | Channel Divider | 将立体声信号分成多个频段，并把各频段路由到独立的立体声输出对 | [详情](plugins/basics.md#channel-divider) |
| Basics    | DC Offset | DC 偏移调整 | [详情](plugins/basics.md#dc-offset) |
| Basics    | Matrix | 灵活路由并混合音频通道 | [详情](plugins/basics.md#matrix) |
| Basics    | MultiChannel Panel | 多通道控制面板，支持音量、静音、独奏和延迟 | [详情](plugins/basics.md#multichannel-panel) |
| Basics    | Mute | 完全静音音频信号 | [详情](plugins/basics.md#mute) |
| Basics    | Polarity Inversion | 信号极性反转 | [详情](plugins/basics.md#polarity-inversion) |
| Basics    | Stereo Balance | 立体声通道平衡控制 | [详情](plugins/basics.md#stereo-balance) |
| Basics    | Volume | 基本音量控制 | [详情](plugins/basics.md#volume) |
| Delay     | Delay | 标准延迟效果 | [详情](plugins/delay.md#delay) |
| Delay     | Time Alignment | 为扬声器与聆听位置校准微调播放时序 | [详情](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | 基于LUFS测量的自动音量调整，以实现一致的聆听体验 | [详情](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | 透明的峰值控制，确保安全舒适的聆听 | [详情](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | 平滑突然变大的段落，让聆听更舒适 | [详情](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | 让低于阈值的安静声音更安静，以恢复动态对比 | [详情](plugins/dynamics.md#expander) |
| Dynamics  | Gate | 在间隙或安静段落降低低电平声音 | [详情](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | 5 频段音量平衡，获得稳定、类似电台的聆听声音 | [详情](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | 5 频段扩展器，为过于平坦的录音恢复自然对比 | [详情](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | 分别塑造低频、中频和高频的起音与延音 | [详情](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | 模拟功率放大器在高负载条件下的电压跌落 | [详情](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | 通过塑造起音与延音调整音乐的冲击力和厚度 | [详情](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | 15频段图示均衡器 | [详情](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | 用于细致聆听音色调整的 15 频段参数均衡器 | [详情](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | 基于阈值的频率调整的5频段动态均衡器 | [详情](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | 灵活塑造低频、中频和高频的 5 频段均衡器 | [详情](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | 专注于特定频率 | [详情](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | 添加相位感、中空感或金属感染色 | [详情](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | 用于确认普通耳机线差异造成的频率响应变化通常很小 | [详情](plugins/eq.md#earphone-cable-sim) |
| EQ        | Hi Pass Filter | 精确去除不需要的低频 | [详情](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | 精确去除不需要的高频 | [详情](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | 针对低音量聆听的频率平衡校正 | [详情](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | 高通和低通滤波器的组合 | [详情](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ | 倾斜均衡器，用于快速音色塑造 | [详情](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | 三频段音色控制 | [详情](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | 降低位深并应用零阶保持效果 | [详情](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | 模拟各种数字音频传输错误和复古数字设备特性 | [详情](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | 模拟 DSD64 超声噪声引发的可闻互调失真 | [详情](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | Hum Generator | 加入可控的 50/60 Hz 电气嗡声氛围，适合复古/lo-fi 聆听 | [详情](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | 加入可调背景噪声质感，营造 lo-fi 氛围 | [详情](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | 数字抖动模拟 | [详情](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | 加入黑胶风格的爆点、噼啪声、嘶声、隆隆声和立体声噪声串扰 | [详情](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | 模拟因扬声器振膜微动引起的自然动态音色变化 | [详情](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | 在不改变速度的情况下升高或降低音乐音高 | [详情](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | 基于音量的调制效果 | [详情](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | 加入轻微磁带或唱片式音高摇摆，营造复古特性 | [详情](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | 具有可自定义尺寸的号角共鸣模拟 | [详情](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 更平滑的号角扬声器共鸣，带来自然的聆听色彩 | [详情](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 支持最多5个谐振器的频率共鸣效果 | [详情](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | 基于Dattorro算法的经典板式混响 | [详情](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | 反馈延迟网络混响，产生丰富密集的混响纹理 | [详情](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | 具有自然扩散的随机散射混响 | [详情](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | 模拟扬声器振膜的非线性位移 | [详情](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | 添加谐波内容以增强清晰度和存在感 | [详情](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | 数字硬削波效果 | [详情](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 通过可调的 2 至 5 阶谐波失真添加个性 | [详情](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | 分别为低频、中频和高频添加暖度或边缘感 | [详情](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | 添加模拟风格的温暖、丰润和个性 | [详情](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | 混入经过滤波的低频信号以增强低音 | [详情](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | 用于自然立体声成像的耳机交叉馈送滤波器 | [详情](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | 在立体声和 Mid/Side 之间转换，用于调整中央与氛围成分 | [详情](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | 5 频段频率相关立体声平衡控制 | [详情](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | 从单声道到增强立体声控制声场宽度 | [详情](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | 用于检查扬声器/耳机的测试音和噪声发生器 | [详情](plugins/others.md#oscillator) |
| Control   | Section | 将效果分组，让整个区段可被旁路或恢复 | [详情](plugins/control.md) |

## 技术信息

### 浏览器兼容性

Frieve EffeTune 已在 Google Chrome 上测试验证运行。该应用需要支持以下功能的现代浏览器：
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### 浏览器支持详情
1. Chrome/Chromium
   - 完全支持，推荐使用
   - 请更新至最新版本以获得最佳性能

2. Firefox/Safari
   - 支持有限
   - 部分功能可能无法如预期般运行
   - 建议使用 Chrome 以获得最佳体验

### 推荐采样率

为了在非线性效果下获得最佳性能，建议在 96kHz 或更高采样率下使用 EffeTune。更高的采样率有助于在处理饱和和压缩等非线性效果时达到理想特性。

## 开发指南

想要创建您自己的音频插件？请查看我们的 [插件开发指南](../../plugin-development.md)。
想要构建桌面应用？请查看我们的 [构建指南](../../../BUILD.md)。

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

## 链接

[版本历史](../../version-history.md)

[源代码](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[在Ko-fi上支持我们](https://ko-fi.com/frievea)
