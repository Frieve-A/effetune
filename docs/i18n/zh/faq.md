---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
---

# EffeTune 常见问题解答（FAQ）

EffeTune 是一款面向音频爱好者的实时 DSP 应用程序，提供网页版和桌面版。本文档涵盖了设置、故障排除、多通道使用、效果操作和频率校正等内容。

## 目录
1. 流媒体初始设置
   1.1. 安装 VB-CABLE 并使用 96 kHz
   1.2. 流媒体服务输入（以 Spotify 为例）
   1.3. EffeTune 音频设置
   1.4. 操作检查
2. 故障排除
   2.1. 音频播放质量
   2.2. CPU 使用率
   2.3. 回声
   2.4. 输入、输出或效果问题
   2.5. 多通道输出不匹配
3. 多通道和硬件连接
   3.1. HDMI + AV 接收器
   3.2. 无多通道驱动的接口
   3.3. 通道延迟和时间对齐
   3.4. 8通道限制和扩展
4. 常见问题
5. 频率响应和房间校正
6. 效果操作技巧
7. 参考链接

---

## 1. 流媒体初始设置

Windows 示例：Spotify → VB-CABLE → EffeTune → DAC/放大器。其他服务和操作系统的概念类似。

### 1.1. 安装 VB-CABLE 并启用 96 kHz
下载 VB-CABLE Driver Pack45，以管理员身份运行 `VBCABLE_Setup_x64.exe` 并重启。将操作系统默认输出恢复为您的扬声器/DAC，并将 **CABLE Input** 和 **CABLE Output** 格式都设置为 24 位，96,000 Hz。以管理员身份启动 `VBCABLE_ControlPanel.exe`，选择 **菜单▸Internal Sample Rate = 96000 Hz**，然后点击 **Restart Audio Engine**。

### 1.2. 流媒体服务路由（以 Spotify 为例）
打开 **设置▸系统▸声音▸音量混合器**，将 `Spotify.exe` 输出设置为 **CABLE Input**。播放一首曲目以确认扬声器没有声音。
在 macOS 上，可使用 Rogue Amoeba 的 **SoundSource** 将 Spotify 输出同样设置为 **CABLE Input**。

### 1.3. EffeTune 音频设置
启动桌面应用并打开 **配置音频**。
- **输入设备：** CABLE Output (VB-Audio Virtual Cable)
- **输出设备：** 物理 DAC/扬声器
- **采样率：** 96,000 Hz（较低的采样率可能会降低音质）

### 1.4. 操作检查
在 Spotify 播放时，切换 EffeTune 中的主 **ON/OFF** 并确认声音发生变化。

---

## 2. 故障排除

### 2.1. 音频播放质量问题

| 症状 | 解决方案 |
| ------ | ------ |
| 音频中断或故障 | 点击网页应用左上角的 **重置音频** 按钮或在桌面应用的 **视图** 菜单中选择 **重新加载**。如有必要，减少活跃效果的数量。 |
| 失真或剪切 | 在效果链末端插入 **Level Meter** 并保持电平低于 0 dBFS。如果需要，在 Level Meter 之前添加 **Brickwall Limiter**。 |
| 20 kHz 以上出现混叠 | VB-CABLE 可能仍以 48 kHz 运行。重新检查初始设置。 |

### 2.2. CPU 使用率高
禁用不使用的效果或从 **效果管道** 中移除它们。

### 2.3. 回声
您的输入和输出设备可能形成回路。确保 EffeTune 的输出不会返回到其输入。

### 2.4. 输入、输出或效果问题

| 症状 | 解决方案 |
| ------ | ------ |
| 无音频输入 | 确保播放器输出到 **CABLE Input**。在浏览器中允许麦克风权限并选择 **CABLE Output** 作为输入设备。 |
| 效果不工作 | 确认主开关、每个效果和任何 **Section** 都处于 **ON** 状态。如有必要，重置参数。 |
| 无音频输出 | 对于网页应用，检查操作系统和浏览器输出是否指向您的 DAC/放大器。对于桌面应用，检查 **配置音频** 中的输出设备。 |
| 其他播放器报告"CABLE Input 正在使用中" | 确保没有其他应用程序正在使用 **CABLE Input**。 |

### 2.5. 多通道输出不匹配
EffeTune 按 1→2→…→8 的顺序输出通道。如果 Windows 配置为 4 通道，后置通道可能会映射到中置/重低音。**解决方法：** 将设备设置为 7.1ch，从 EffeTune 输出 8ch，并使用通道 5 和 6 用于后置音频。

---

## 3. 多通道和硬件连接

### 3.1. HDMI + AV 接收器
将 PC 的 HDMI 输出设置为 7.1ch 并连接到 AV 接收器。EffeTune 可以通过单根电缆发送多达 8 个通道。较旧的接收器可能会降低音质或意外重新映射通道。

### 3.2. 无多通道驱动的接口（例如 MOTU M4）
Out 1‑2 和 Out 3‑4 显示为独立设备，无法实现 4 通道输出。解决方法：
- 使用 **Voicemeeter** 通过 ASIO 合并通道。
- 使用 **ASIO Link Pro** 创建一个虚拟 4 通道设备（高级）。

### 3.3. 通道延迟和时间对齐
使用 **MultiChannel Panel** 或 **Time Alignment** 以 10 微秒为步长延迟通道（最小 1 个样本）。对于大延迟，将前置通道延迟 100-400 毫秒。视频同步必须在播放器端调整。

### 3.4. 8通道限制和扩展
当前操作系统驱动支持最多 8 个通道。当操作系统允许时，EffeTune 可以支持更多通道。

---

## 4. 常见问题

| 问题 | 回答 |
| ------ | ------ |
| 环绕声输入（5.1ch 等）？ | Web Audio API 将输入限制为 2 个通道。输出和效果支持最多 8 个通道。 |
| 推荐的效果链长度？ | 使用 CPU 允许的尽可能多的效果，同时不造成音频中断或高延迟。 |
| 如何获得最佳音质？ | 使用 96 kHz 或更高采样率，从微妙设置开始，用 **Level Meter** 监控余量，如有需要添加 **Brickwall Limiter**。 |
| 它适用于任何音源吗？ | 是的。借助虚拟音频设备，您可以处理流媒体、本地文件或物理设备的音频。 |
| AV 接收器与音频接口的成本比较？ | 重用带 HDMI 的 AV 接收器很简单。对于以 PC 为中心的设置，多通道接口加小型放大器提供良好的成本和质量。 |
| 安装 VB-CABLE 后其他应用没有声音 | 操作系统默认输出被切换到 **CABLE Input**。在声音设置中改回来。 |
| 分割后只有 3+4 通道改变音量 | 在分配器后放置 **Volume** 效果并将 **Channel** 设置为 3+4。如果放在前面，所有通道都会改变。 |

---

## 5. 频率响应和房间校正

### 5.1. 将 AutoEQ 设置导入 15Band PEQ
从 EffeTune v1.51 或更高版本开始，您可以通过右上角的按钮直接导入 AutoEQ 均衡器设置。

### 5.2. 粘贴测量校正设置
从测量页面复制 5Band PEQ 设置，并使用 **Ctrl+V** 或菜单粘贴到 **效果管道** 视图中。

---

## 6. 效果操作技巧
* 信号流是从上到下。
* 使用 **Matrix** 效果进行转换，如 2→4ch 或 8→2ch（在总线路由中设置 **Channel = All**）。
* 使用 **MultiChannel Panel** 管理最多 8 个通道的电平、静音和延迟。

---

## 7. 参考链接
* EffeTune 桌面版：<https://github.com/Frieve-A/effetune/releases>
* EffeTune 网页版：<https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE：<https://vb-audio.com/Cable/>
* Voicemeeter：<https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro（非官方修复版）：搜索 "ASIO Link Pro 2.4.1"
