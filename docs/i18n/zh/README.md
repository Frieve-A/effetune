# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

[Open Web App](https://effetune.frieve.com/effetune.html)  [Download Desktop App](https://github.com/Frieve-A/effetune/releases/)

一个实时音频效果处理器，旨在为音频爱好者提升音乐聆听体验。EffeTune 允许您通过各种高质量效果处理任何音频源，从而实时定制并完善您的聆听体验。

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 概念

EffeTune 专为希望提升音乐聆听体验的音频爱好者而设计。无论您是在流媒体播放音乐还是从物理介质播放，EffeTune 都能让您添加专业级效果，以精确定制声音。将您的计算机转变为一个强大的音频效果处理器，置于音频源与扬声器或功放之间。

拒绝音响神话，纯粹科学。

## 功能

- 实时音频处理
- 拖放式界面构建效果链
- 可扩展的分类效果系统
- 实时音频可视化
- 可实时修改的音频管道
- 使用当前效果链的离线音频文件处理
- 分组功能，用于将多个效果组合在一起控制
- 音频设备频率响应测量功能
- 多通道处理与输出

## 设置指南

在使用 EffeTune 之前，您需要配置音频路由。以下是配置不同音频源的方法：

### 音乐文件播放器设置

- 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
- 打开并播放音乐文件以确保正常播放
   - 打开音乐文件并选择 EffeTune 作为应用程序（仅桌面应用）
   - 或从文件菜单选择打开音乐文件...（仅桌面应用）
   - 或将音乐文件拖入窗口

### Streaming Service Setup

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

### Physical Audio Source Setup

使用 EffeTune 与 CD 播放器、网络播放器或其他物理音源：

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
   - 切换分组效果的 ON/OFF 将启用/禁用该分组中的所有效果
   - 使用多个分组效果将效果链组织成逻辑分组
   - [更多关于控制效果的信息](plugins/control.md)

### 使用AB流程功能

1. AB流程概述：
   - EffeTune可以维护两个独立的效果流程：流程A和流程B
   - 启动时只加载流程A，流程B在需要时创建
   - 所有处理、保存、加载和编辑操作都在当前选定的流程上工作

2. AB切换按钮：
   - 位于Effect Pipeline标题的右侧
   - 默认显示"A"（流程A激活）
   - 点击在流程A和流程B之间切换
   - 如果切换时流程B不存在，流程A的设置将复制到流程B

3. AB菜单（下拉按钮）：
   - 位于AB切换按钮的右侧
   - "A → B"：将流程A的设置复制到流程B并切换到流程B
   - "B → A"：将流程B的设置复制到流程A并切换到流程A

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
   - T: 在流程A和流程B之间切换
   - A: 切换到流程A
   - B: 切换到流程B

3. 键盘快捷键（使用播放器时）：
   - Space：播放/暂停
   - Ctrl + → 或 N：下一曲
   - Ctrl + ← 或 P：上一曲
   - Shift + → 或 F 或 .：快进10秒
   - Shift + ← 或 R 或 ,：后退10秒
   - Ctrl + M：切换循环模式
   - Ctrl + H：切换随机模式
   - T：在流程A和流程B之间切换
   - A：切换到流程A
   - B：切换到流程B

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
   - 多个文件会自动打包成 ZIP 文件

### 频率响应测量

1. 对于网页版，请启动[频率响应测量工具](https://effetune.frieve.com/features/measurement/measurement.html)。对于应用版，请在"设置"菜单中选择"频率响应测量"
2. 将您的音频设备连接到计算机的输入和输出
3. 配置测量参数（扫频时间、频率范围）
4. 运行测量以生成频率响应图
5. 分析结果或导出测量数据进行深入分析

### 分享效果链

您可以与其他用户分享您的效果链配置：
1. 设置好所需的效果链后，点击 Effect Pipeline 区域右上角的 "Share" 按钮
2. 网页应用的 URL 会自动复制到剪贴板
3. 将复制的 URL 分享给他人 —— 他们可通过打开链接重现您完全相同的效果链
4. 在网页应用中，所有效果设置均存储在 URL 中，便于保存和分享
5. 在桌面应用版本中，可以从文件菜单导出设置到 effetune_preset 文件
6. 分享导出的 effetune_preset 文件。effetune_preset 文件也可以通过拖入网页应用窗口加载

### 音频重置

如果您遇到音频问题（断音、杂音）：
1. 在网页应用中点击左上角的 "Reset Audio" 按钮，或在桌面应用中从 View 菜单选择 Reload
2. 音频管道将自动重建
3. 您的效果链配置将被保留

## 常见效果组合

以下是一些流行的效果组合，旨在提升您的聆听体验：

### Headphone Enhancement
1. Stereo Blend -> RS Reverb
   - Stereo Blend: 调整立体声宽度以获得舒适感（60-100%）
   - RS Reverb: 添加微妙的房间氛围（混合比例 10-20%）
   - 结果: 更自然、更不易疲劳的耳机聆听体验

### Vinyl Simulation
1. Wow Flutter -> Noise Blender -> Saturation
   - Wow Flutter: 添加轻微的音高变化
   - Noise Blender: 营造出仿黑胶唱片的氛围
   - Saturation: 增加模拟暖音
   - 结果: 真实的黑胶唱片体验

### FM Radio Style
1. Multiband Compressor -> Stereo Blend
   - Multiband Compressor: 营造出"电台"般的声音
   - Stereo Blend: 调整立体声宽度以获得舒适感（100-150%）
   - 结果: 专业的广播级音效

### Lo-Fi Character
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - Bit Crusher: 降低位深以营造复古感觉
   - Simple Jitter: 添加数字瑕疵
   - RS Reverb: 营造出氛围空间
   - 结果: 经典的 lo-fi 美学

## 故障排除和常见问题

如果遇到问题，请参阅[常见问题](faq.md)。
若仍无法解决，请在[GitHub Issues](https://github.com/Frieve-A/effetune/issues)反馈。
## 可用效果

| Delay     | Delay | 标准延迟效果 | [详情](plugins/delay.md#delay) |
| Delay     | Time Alignment | 音频通道的时序微调 | [详情](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | 基于LUFS测量的自动音量调整，以实现一致的聆听体验 | [详情](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | 透明的峰值控制，确保安全舒适的聆听 | [详情](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | 具有阈值、比率和斜率控制的动态范围压缩 | [详情](plugins/dynamics.md#compressor) |
| Dynamics  | Gate | 带阈值、比率和斜率控制的噪声门，用于降噪 | [详情](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | 专业的5频段动态处理器，具有FM广播风格的音色塑造 | [详情](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | 专业的5频段扩展器，用于频段特定的动态范围扩展 | [详情](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | 高级3频段瞬态塑形器，提供频率特定的攻击和延音控制 | [详情](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | 模拟功率放大器在高负载条件下的电压跌落 | [详情](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | 控制信号的瞬态和延音部分 | [详情](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | 15频段图示均衡器 | [详情](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | 具有15个完全可配置频段的专业参数均衡器 | [详情](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | 基于阈值的频率调整的5频段动态均衡器 | [详情](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | 具有5个完全可配置频段的专业参数均衡器 | [详情](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | 专注于特定频率 | [详情](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | 用于谐波着色和共振模拟的数字梳状滤波器 | [详情](plugins/eq.md#comb-filter) |
| EQ        | Hi Pass Filter | 精确去除不需要的低频 | [详情](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | 精确去除不需要的高频 | [详情](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | 针对低音量聆听的频率平衡校正 | [详情](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | 高通和低通滤波器的组合 | [详情](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ | 倾斜均衡器，用于快速音色塑造 | [详情](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | 三频段音色控制 | [详情](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | 降低位深并应用零阶保持效果 | [详情](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | 模拟各种数字音频传输错误和复古数字设备特性 | [详情](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | Hum Generator | 高精度电源嗡鸣噪声生成器 | [详情](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | 噪音生成与混合 | [详情](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | 数字抖动模拟 | [详情](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | 模拟唱片噪音物理仿真 | [详情](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | 模拟因扬声器振膜微动引起的自然动态音色变化 | [详情](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | 轻量级移调效果 | [详情](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | 基于音量的调制效果 | [详情](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | 基于时间的调制效果 | [详情](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | 具有可自定义尺寸的号角共鸣模拟 | [详情](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 具有高级反射的增强号角模型 | [详情](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 支持最多5个谐振器的频率共鸣效果 | [详情](plugins/resonator.md#modal-resonator) |
| Reverb    | FDN Reverb | 反馈延迟网络混响，产生丰富密集的混响纹理 | [详情](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | 具有自然扩散的随机散射混响 | [详情](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | 模拟扬声器振膜的非线性位移 | [详情](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | 添加谐波内容以增强清晰度和存在感 | [详情](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | 数字硬削波效果 | [详情](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 通过独立控制各谐波添加独特音色 | [详情](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | 用于精确频率基暖音的三频段饱和效果 | [详情](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | 饱和效果 | [详情](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | 混入次谐波信号以增强低音 | [详情](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | 用于自然立体声成像的耳机交叉馈送滤波器 | [详情](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | 用于立体声处理的中侧编码和解码 | [详情](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | 具有5频段频率依赖立体声平衡控制 | [详情](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | 立体声宽度控制效果 | [详情](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | 多波形音频信号发生器 | [详情](plugins/others.md#oscillator) |
| Control   | Section | 将多个效果分组以实现统一控制 | [详情](plugins/control.md) |

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

想要创建您自己的音频插件？请查看我们的 [Plugin Development Guide](../../plugin-development.md)。
想要构建桌面应用？请查看我们的 [构建指南](../../build.md)。

## 链接

[Version History](../../version-history.md)

[Source Code](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)
