# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="主要操作">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">打开 Web App</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">安装 PWA 版</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">下载桌面应用</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">下载 VST 版</a>
  <a class="button button-secondary" href="https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp">安装 Chrome 扩展</a>
  <a class="button button-secondary" href="https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk">安装 Edge 扩展</a>
</div>

一款专为音频爱好者打造的实时音频效果处理器。通过 EffeTune，你可以为任何音频源添加高品质效果，实时按自己的喜好调校声音，获得更理想的听音体验。

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## 介绍视频

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=Qb5Airg0kI8)

## 概念

EffeTune 专为想要获得更理想听音体验的音频爱好者而设计。无论是流媒体播放还是实体介质播放，EffeTune 都能让你叠加高品质效果，按个人偏好精细调整声音。把你的电脑变成一台强大的音频效果处理器，串联在音源与音箱或功放之间。

拒绝玄学，唯凭科学。

## 功能

- 实时音频处理
- 拖放式界面构建效果链
- 可扩展的分类效果系统
- 实时音频可视化
- 可自由排布动态图表、专辑封面和曲目信息的 Visualizer
- 可实时修改的音频管道
- 使用当前效果链离线处理音频文件
- 可浏览本地子文件夹、元数据和播放列表的音乐库
- 桌面应用的紧凑型置顶迷你播放器
- 用于系统校准的频率响应测量与校正
- 多声道处理与输出
- 便于手机和平板使用的移动端网页布局

## 设置指南

### Android 应用

请使用 Android 10 或更高版本，并保持 Android System WebView 为最新版本。打开音乐文件，或在音乐库中选择文件夹，然后通过 Android 的选择界面授权 EffeTune 访问相应内容。如果文件夹无法访问，请在音乐库中重新选择。关闭屏幕后仍可继续播放，也可通过通知和锁屏控制同一个播放器。

导出的文件可通过 Android 的文件选择或分享界面保存、分享。批量导出音频时，请选择输出文件夹，并保持应用打开。Android 应用与网页版的数据分别保存。使用“备份 / 恢复”可交换预设、脉冲响应、测量数据和可视化工具数据（最大 256 MB）；不包含音乐文件、音乐目录、连接凭据及设置。效果仅处理 EffeTune 播放或接收的音频，不会替换其他 Android 应用的声音。

通过 MIDI 调节参数以及按时钟、定时器更改参数的操作，在关闭屏幕后仍会继续。使用键盘和游戏手柄时，请保持应用打开。Android 支持 MIDI 输入，但不向电动推子或 LED 发送反馈。点按工具栏中的 **Remote Control** 图标即可允许远程控制并复制配对链接。请勿公开此链接。

请根据你要收听的音频来源，选择下方对应的设置方式。

### 音乐文件播放器设置

- 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
- 打开并播放音乐文件，确认播放正常
   - 点击 **打开音乐文件** 按钮并选择音乐文件
   - 或打开音乐文件并选择 EffeTune 作为打开方式（仅桌面应用）
   - 或从 **文件** 菜单选择 **打开音乐文件…**（仅桌面应用）
   - 或直接将音乐文件拖入窗口
- 如果只使用音乐文件播放器，可在 **音频设置** 中将 **输入设备：** 设为 **无（仅音乐文件播放器）**，从而不使用实时音频输入。桌面应用默认使用此设置；如果已保存输入设备设置，则继续使用已保存的设置。

[音乐播放器](music-player.md)

### 桌面版内置浏览器

桌面版的 **浏览器** 可让网站音频通过当前效果链播放，无需虚拟音频设备。

1. 点击顶部的 **浏览器**，即可开始处理浏览器音频。
2. 输入 HTTP 或 HTTPS 地址，然后使用网站自己的操作登录并播放音乐。如果省略协议，会使用 HTTPS。
3. 切换到 **Effect Pipeline** 调整声音。切换视图不会中断浏览器音频。

使用后退、前进、重新加载和停止加载来浏览页面。打开**书签**，即可添加当前页面、打开已保存的页面、重命名或删除书签。浏览器菜单提供**显示起始页**、**在默认浏览器中打开**、**设为起始页**和**清除网站数据**。书签和起始页会保存。网站登录状态单独保留，重启应用后仍可使用。浏览器页面的缩放比例与应用的缩放比例保持一致。

焦点位于浏览器工具栏时，可用 **F5** 重新加载、**F6** 选中地址、**Alt+左右箭头** 后退或前进、**Alt+Home** 显示起始页。这些快捷键在页面内也可使用。焦点位于页面内时，**Ctrl/Cmd+L** 选中地址，**Ctrl/Cmd+R** 重新加载，**Ctrl/Cmd+D** 打开书签。macOS 还可用 **Cmd+[/]** 后退或前进。**Escape** 停止页面加载。右键点击页面可使用导航命令；右键点击链接可在此处或默认浏览器中打开链接，或复制链接地址；右键点击选中的文本或输入框可使用可用的编辑命令。在页面之外，应用现有快捷键保持原有功能。

打开或返回 **浏览器** 时，会自动选择浏览器音频。浏览器音频会与所选输入设备的音频混合播放。将输入设备设为**无**，即可仅收听浏览器音频。播放器的音频输入选项不会影响浏览器播放。本地音乐文件也可以与浏览器音频同时播放。如果音频捕获中断，请再次点击 **浏览器** 重试。**清除网站数据**会退出网站登录并删除其保存的数据，同时保留书签。

点击浏览器工具栏中的**关闭**，即可停止浏览器音频处理，并返回 **Effect Pipeline**。页面和浏览历史会保留。再次打开 **浏览器** 时，会恢复处理同一页面的音频。

在**设置 > 配置... > 浏览器** 中，可以调整以下选项：

- **起始页**：首次打开浏览器时显示的 HTTP 或 HTTPS 地址。输入框默认为空；留空时打开 [EffeTune 流媒体指南](https://effetune.frieve.com/streaming/)。**重置**会清空输入框，不改变当前页面。
- **在默认浏览器中打开新标签页**：默认开启。关闭后，这类链接会在 EffeTune 的浏览器内打开。登录窗口等单独窗口不受此设置影响，仍在 EffeTune 内打开。
- **User-Agent**：向网站提供的浏览器标识信息。默认将浏览器标识为兼容 Chrome 的浏览器，并包含 EffeTune 名称。留空或点击**重置**即可恢复默认值。更改后，请在浏览器中重新加载页面。

要根据网站自动切换效果，请先将效果链保存为预设。在 **URL规则**下点击**添加规则**，输入网站和路径，例如 `example.com/music/*`，再选择效果链预设。请省略 `http://` 或 `https://`、查询字符串和 `#` 片段；`*` 可匹配任意文本。使用上下移动按钮调整优先顺序，然后点击**保存规则**。系统会采用第一个已启用、地址匹配且预设可用的规则。

只要选中了浏览器音频，规则就会生效，即使切换到其他界面也一样。保存规则、打开浏览器或进入匹配的页面时，可能会加载相应预设。在使用同一预设的页面之间跳转时，会保留手动调整。没有规则匹配时，当前效果链保持不变。

有些网站不允许使用内置浏览器、登录、播放受保护内容或采集音频。可用性取决于网站和操作系统，无法保证 DRM 内容的播放。如果网站拒绝登录，请尝试网站提供的其他登录方式，或使用常用浏览器。在常用浏览器中登录不会使 EffeTune 内也登录。浏览器仅适用于桌面版。

### 浏览器扩展设置

无需虚拟音频设备，即可为最多四个 Chrome 或 Edge 标签页分别设置独立效果链、按 URL 选择预设并指定采样率。详见[浏览器扩展指南](browser-extension.md)。

1. 从 [Chrome](https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp) 或 [Edge](https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk) 商店安装 EffeTune 扩展。
2. 在需要处理音频的标签页中播放声音，从浏览器工具栏打开 EffeTune，选择 **Start on this tab**。
3. 选择 **Edit pipeline**，添加效果并调整声音。

### 流媒体服务设置

处理流媒体服务（如 Spotify、YouTube Music 等）的音频：

桌面版可先尝试[内置浏览器](#桌面版内置浏览器)。如需使用独立的流媒体应用，或内置浏览器无法播放的音源，请按下方说明配置音频设备。

1. 前提条件：
   - 安装虚拟音频设备（例如 VB Cable、Voice Meeter 或 ASIO Link Tool）
   - 将流媒体服务的音频输出设置为该虚拟音频设备

2. 配置：
   - 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
   - 选择虚拟音频设备作为输入源
     - 在 Chrome 中，首次打开时会弹出对话框，要求选择并允许音频输入
     - 从 **设置** 菜单打开 **音频设置**，选择输入/输出设备和音频格式
   - 开始播放流媒体音乐
   - 确认音频正通过 EffeTune 传输
   - 如需更详细的设置说明，请参阅[常见问题](faq.md)

### 外部音频设备设置

将 EffeTune 用于 CD 播放机、网络播放器或其他外部音源：

- 将音频接口连接到计算机
- 在浏览器中打开 EffeTune 网页应用，或启动 EffeTune 桌面应用
- 将音频接口选为输入和输出设备
   - 在 Chrome 中，首次打开时会弹出对话框，要求选择并允许音频输入
   - 从 **设置** 菜单打开 **音频设置**，选择输入/输出设备和音频格式
- 此时音频接口即作为多效果处理器工作：
   * 输入：CD 播放机、网络播放器或其他音频源
   * 处理：通过 EffeTune 进行实时效果处理
   * 输出：将处理后的音频输出到功放或音箱

## 使用方法

桌面应用首次启动时，窗口会最大化。之后启动时，会恢复上次的窗口大小、位置和最大化状态。

首次启动时，简短的导览会介绍在哪里播放音乐、添加效果和调整声音。你可以随时通过设置菜单中的 **查看界面导览** 再次查看，也可以从桌面应用的 **帮助** 菜单或移动端的菜单按钮打开。

### 构建效果链

1. 屏幕左侧列出了可用效果
   - 使用“Available Effects”旁边的搜索按钮筛选效果
   - 输入任意文本，按名称或分类查找效果
   - 按 ESC 清除搜索
2. 将效果从列表拖放到 **Effect Pipeline** 区域
   - 在移动端，打开 **效果** 选项卡并点击 + 按钮，从全屏列表中添加效果
3. 效果按从上到下的顺序依次处理
4. 拖动手柄 (⋮) 或点击 ▲▼ 按钮调整效果顺序
   - 对于 Section 效果：按住 Shift 点击 ▲▼ 按钮可移动整个分段（从一个 Section 到下一个 Section、流程开头或流程末尾）
5. 点击效果名称可展开或收起其设置
   - 按住 Shift 点击 Section 效果，可展开/收起该分段内的所有效果
   - 按住 Shift 点击其他效果，可展开/收起除 Analyzer 分类外的所有效果
   - 按住 Ctrl 点击，可展开/收起所有效果
6. 使用 **ON** 按钮旁通单个效果
7. 点击 ? 按钮可在新标签页中打开详细文档
8. 使用 × 按钮删除效果
   - 对于 Section 效果：按住 Shift 点击 × 按钮可删除整个分段
9. 点击路由按钮设置要处理的声道以及输入和输出总线
   - [总线功能详情](bus-function.md)
10. 点击效果上的 **效果预设** 按钮，可仅保存或应用该效果的设置

点击 × 旁的锁形按钮可锁定或解锁效果设置。锁定后，无法通过参数控件、重置、效果预设或路由来更改设置。音频处理、ON/OFF、排序、折叠和删除仍可使用。折叠和锁定状态会随效果链一同保存和恢复，包括效果链预设和上次退出时的状态。锁定时，锁形图标会变为黄色；尝试编辑时，图标会闪烁。仍可查看图表上的数值和切换显示选项卡。

### 用音乐库查找音乐

您可以将设备中保存的音乐文件整理为音乐库。

1. 在电脑端点击页眉中的 **音乐库** 按钮，在移动端打开 **音乐库** 选项卡，或在桌面应用中选择 **视图 > 音乐库**。
2. 选择 **添加音乐文件夹**，为包含音乐文件的文件夹建立索引。与所引用 WAV 或 FLAC 文件放在同一文件夹中的外部 CUE 文件，可将整轨专辑拆分为独立曲目。
3. 可按 **曲目**、**专辑**、**艺人**、**流派**、**子文件夹**、**文件夹**、**最近添加** 或 **播放列表** 浏览，也可使用 **搜索音乐库** 筛选曲目。
4. 使用 **播放** 通过当前效果链聆听，或用 **下一首播放**、**添加到队列** 和 **添加到播放列表** 管理播放顺序。
5. 修改文件后使用 **重新扫描**；如果浏览器或文件夹权限失效，使用 **重新连接**。
   - [音乐库详情](music-library.md)

### Visualizer

您可以欣赏基于当前播放音乐的可视化效果。

可从电脑端页眉、移动端 **播放器** 选项卡或桌面应用的 **视图** 菜单打开 **Visualizer**。选择内置布局，或点击 **Edit** 自由排布音频图表、封面与曲目信息。修改会立即生效，并在下次启动时恢复；如需保存命名副本，请使用预设对话框。将鼠标移到画面上或轻点画面并选择 **⛶** 可铺满应用窗口。有关编辑、效果和显示选项，请参阅 [Visualizer 指南](visualizer.md)。

### 使用预设

您可以保存和加载自己创建的效果链。

点击 Effect Pipeline 标题栏中的 **效果链预设** 按钮打开预设对话框。

1. 从已保存的预设列表中选择即可加载，恢复包含效果顺序、设置和 ON/OFF 状态在内的完整效果链。
2. 输入名称并选择 **保存**，即可保存当前效果链。
3. 使用对应行的重命名按钮可更改预设名称。
4. 选择一个或多个已保存预设，点击 **删除所选项目** 并确认即可删除。
5. 按 Ctrl+S（macOS 为 Cmd+S）可直接打开对话框并编辑当前预设名称。

每个效果还配有独立的 **效果预设** 按钮，可用于打开系统预设（若该效果提供），以及保存、重命名、加载或删除该效果的个人预设。效果预设只改变该效果自身的参数，不会更改 ON/OFF 状态或总线路由。

原有的 `.effetune_preset` 文件导入、导出与分享功能仍用于完整效果链预设。

### 效果通用操作

- 如需微调滑块，请按住 Shift 拖动，数值会按最小步进变化
   - 可取正负值的滑块会从 0 填充到当前值；Ratio 滑块以 1.0 为起点。
- 在支持的频率或音符图表上，沿坐标轴拖动即可通过效果链试听所选频率。在 **配置 > 常规 > 频率试听声音** 中，可选择 **正弦波**（默认，-12 dB）或以该频率为中心的 **带通噪声**。Note Spectrogram、Pitch Meter、Chroma Spiral 和钢琴键盘始终使用正弦波。钢琴键盘会吸附到最近的半音，在琴键上拖动可试听对应音高

[使用 MIDI、游戏手柄或键盘控制效果参数](controller-mapping.md)

### 使用分组功能

您可以将多个效果分组并统一操作。

1. **Section 效果的用法：**
   - 在一组效果的开头添加 Section 效果
   - 在 Comment 栏输入便于识别的名称
   - 切换 Section 的 ON/OFF 可在保留各效果自身 ON/OFF 状态的同时，整段旁通或恢复该组效果
   - 使用多个 Section 效果可将效果链整理为清晰的逻辑分段
   - [控制类效果详情](plugins/control.md)

### 使用 AB Pipeline 功能

您可以在两条效果链之间切换，对比聆听效果。

1. **AB Pipeline 概述：**
   - EffeTune 可同时维护两条独立的效果流程：Pipeline A 和 Pipeline B
   - 启动时仅加载 Pipeline A，Pipeline B 会在需要时创建
   - 所有处理、保存、加载和编辑操作均作用于当前选中的 Pipeline

2. **AB 切换按钮：**
   - 位于 Effect Pipeline 标题栏右侧
   - 默认显示“A”（当前激活 Pipeline A）
   - 点击可在 Pipeline A 与 Pipeline B 之间切换
   - 若切换时 Pipeline B 尚不存在，会将 Pipeline A 的设置复制到 Pipeline B

3. **AB 菜单（下拉按钮）：**
   - 位于 AB 切换按钮右侧
   - “A → B”：将 Pipeline A 的设置复制到 Pipeline B 并切换到 Pipeline B
   - “B → A”：将 Pipeline B 的设置复制到 Pipeline A 并切换到 Pipeline A

4. **双盲测试：**
   - 在不知道当前播放哪一条流程的情况下，凭听感对比 Pipeline A 和 Pipeline B
   - 可运行 ABX 测试检验能否真正听出两条流程的差异，或运行 A/B 偏好测试找出更喜欢哪一条，并提供统计显著性检验
   - 从 AB 切换按钮右侧的 ▼ 菜单打开（桌面应用也可从 **文件** 菜单打开）
   - [双盲测试详情](double-blind-test.md)

### 效果选择和键盘快捷键

1. **效果选择方式：**
   - 点击效果标题栏可选择单个效果
   - 按住 Ctrl 点击可选择多个效果
   - 点击 Pipeline 区域的空白处可取消全选

2. **键盘快捷键：**
   - Ctrl + Z: 撤销
   - Ctrl + Y: 重做
   - Ctrl + S: 保存当前流程
   - Ctrl + Shift + S: 将当前流程另存为
   - Ctrl + X: 剪切选中效果
   - Ctrl + C: 复制选中效果
   - Ctrl + V: 从剪贴板粘贴效果
   - Ctrl + F: 搜索效果
   - Ctrl + A: 全选流程中的所有效果
   - Delete: 删除选中效果
   - ESC: 取消选择所有效果
   - T: 在 Pipeline A 和 Pipeline B 之间切换
   - A: 切换到 Pipeline A
   - B: 切换到 Pipeline B

3. **键盘快捷键（使用播放器时）：**
   - Space：播放/暂停
   - Ctrl + → 或 N：下一曲
   - Ctrl + ← 或 P：上一曲
   - Shift + → 或 F 或 .：快进 10 秒
   - Shift + ← 或 R 或 ,：快退 10 秒
   - Ctrl + M：切换循环模式
   - Ctrl + H：切换随机播放模式
   - T：切换 Pipeline A/B
   - A：切换到 Pipeline A
   - B：切换到 Pipeline B

### 处理音频文件

您可以用效果链处理音乐文件，并将处理后的音频保存为新文件。

1. **文件拖放或文件选择区域：**
   - Effect Pipeline 下方始终显示专用的文件拖放区
   - 支持单个或多个音频文件
   - 使用当前 Pipeline 的设置处理文件
   - 效果按 Pipeline 的采样率运行，输出采样率转换在效果处理完成后进行

2. **处理状态：**
   - 进度条显示当前处理进度
   - 处理时间取决于文件大小与效果链复杂度

3. **下载或保存选项：**
   - 在 **设置 > 配置... > 离线文件输出** 中可选择 WAV 或 FLAC，并设置采样率与品质。FLAC 支持 16 位或 24 位无损编码；默认格式为 96 kHz、24 位 PCM WAV
   - 不同格式的声道数上限不同。若文件超出所选格式上限，EffeTune 不会自动下混，而会停止并提示处理方式
   - 处理多个文件时，先选择输出文件夹，每个文件处理完成后会直接保存到该文件夹
   - 在不支持选择文件夹的旧版浏览器中，多个文件会打包为 ZIP 下载

### 分享效果链

你可以与其他用户分享自己的效果链配置。
1. 配好效果链后，点击 Effect Pipeline 右上角的 **分享** 按钮
2. 网页应用的 URL 会自动复制到剪贴板
3. 将复制的 URL 发给他人，对方打开链接即可重现完全相同的效果链
4. 分享链接保存了重现所需的效果设置；日常使用时，网页应用也会将工作状态保存在浏览器存储中
5. 在桌面应用中，可从 **文件** 菜单将设置导出为 `.effetune_preset` 文件
6. 分享导出的 `.effetune_preset` 文件；该文件也可直接拖入网页应用窗口加载

### 备份和恢复已保存的数据

打开 **设置 > 备份 / 恢复**，即可在网页应用、桌面应用和浏览器扩展之间迁移已保存的效果链预设、效果预设、脉冲响应和测量结果。在网页应用和桌面应用中，还可以包含已命名的 Visualizer 预设。选择预设时，会自动选中它所使用的测量数据或脉冲响应数据。

**包含测量数据** 和 **包含脉冲响应数据** 默认开启，使备份无需依赖其他文件即可恢复。只有当目标环境中已有对应的测量文件或脉冲响应文件时，才需要关闭这两个选项。恢复的脉冲响应会添加到 EffeTune 的 **脉冲响应库**。恢复备份不会更改当前的效果链、音量、所选预设、设备设置、音乐库或扩展的 URL 规则。每个 `.effetune_backup` 文件最大支持 256 MB；如有需要，请将较大的备份拆分为多个文件。即使恢复中途停止，已完成的项目也会保留，可以放心地再次恢复同一文件。

分享备份前，请检查所选内容：备份中可能包含预设名称和注释、原始脉冲响应文件以及测量详情。音乐文件、音乐库数据、应用偏好设置、设备选择、URL 规则、凭据以及未保存的当前效果链不包含在备份中。

### 应用设置

打开 **设置 > 配置...**，可选择 **语言**、设置 **启动时显示:**（**Effect Pipeline（默认）**、**音乐库** 或 **Visualizer**）、配置 **启动时的效果流程:**，以及选择 **主题**（Graphite、Paper、Midnight、Ember 或 Mint）。当 **启动时显示:** 设为 **音乐库** 时，还可以选择首先打开的音乐库分类。 桌面版还可以选择 **Browser** 作为启动时显示的页面。

在 **效果流水线列数** 中，选择 **手动** 可用 +/− 按钮调整列数；选择 **自动**（默认），则会根据窗口宽度调整列数，让各列与效果列表一同容纳在窗口内。调整窗口大小时，自动模式会随之调整列数。

Microsoft Store 版通过 Microsoft Store 获取更新。在 **设置 > 配置...** 中，使用 **打开 Microsoft Store 更新页面** 检查更新，或使用 **打开 Windows 启动应用设置** 选择是否自动启动 EffeTune。此版本的设置和 Browser 登录信息与其他桌面版分开保存。

### 声学特性测量

用麦克风检查音响系统的频率响应、脉冲响应、失真和衰减，并生成可导入 EffeTune 的校正 EQ；请参阅[声学特性测量](measurement.md)和 [Pipeline Analyzer 指南](pipeline-analyzer.md)。

### 音频重置

如果遇到断音、爆音等音频异常：
1. 从 **设置** 菜单或移动端更多菜单中选择 **重置音频**；在桌面应用中，也可选择 **视图 > 重新加载**
2. 音频管道将自动重建
3. 当前效果链配置会完整保留

### 网络音乐与远程控制

**桌面版：** 浏览包括 Subsonic / OpenSubsonic 在内的网络音乐服务器，共享选定文件夹，并在本设备、OpenHome 或 UPnP AV / DLNA 播放器上播放。与 EffeTune 播放设备配对后，还可在同一窗口编辑其音效。共享和接收远程控制默认关闭。请参阅[网络音乐与远程控制](openhome.md)。还可启用 UPnP AV / DLNA 和 AirPlay 接收功能，通过此电脑的效果链聆听其他设备发送的音乐。

PWA 可以通过本设备的音效播放已登记 EffeTune 电脑的共享音乐及获准使用的网络音乐库，也可以控制获准操作的网络播放器。还支持直接连接 Subsonic。浏览器和连接要求，请参阅 [PWA 设置与播放](openhome.md#pwa)。

### 使用 AI 助手控制 EffeTune（MCP）

你可以让 Codex 或 Claude Code 完成 MCP 配置，随后协助你在 EffeTune 桌面应用中添加效果、调整参数，以及加载或保存预设。请使用能够在你电脑上运行命令的 AI 智能体。

1. 在 EffeTune 桌面应用中打开 **设置 > 远程控制...**，开启 **允许远程控制**，然后点击 **复制链接**。
2. 将下方提示词中的占位内容替换为刚复制的链接，发送给 AI 智能体：

```text
请按照以下官方指南配置 EffeTune MCP。
https://github.com/Frieve-A/effetune/blob/main/mcp/README.md
连接链接：<在此粘贴复制的链接>
```

配置完成后，按提示重启客户端（如有需要），再试着问它：“显示我当前使用的效果。”请妥善保管连接链接；若点击了 **新令牌** 或更改了端口，请使用新链接重新配置。

先将歌曲添加到已连接的 EffeTune 的 Music Library，然后说：“播放[歌曲]。”助手会先搜索该 EffeTune 的音乐库，默认也通过它的播放器播放；无需共享其中的音乐文件夹。要使用其他音乐库或播放器，请明确说：“在[音乐库]中查找[歌曲]，并在[播放器]上播放。”如果音乐来自另一台运行 EffeTune 的电脑，请先在那台电脑上共享相应文件夹。

## 常见效果组合

以下是一些常用的效果搭配，可用来改善不同场景下的听感：

### 耳机聆听优化
1. Stereo Blend -> RS Reverb
   - **Stereo Blend:** 调整立体声宽度，获得更自然的声场（60-100%）
   - **RS Reverb:** 增添轻微的房间混响（10-20% mix）
   - **结果:** 耳机听感更自然、更不易疲劳

### 黑胶唱片模拟
1. Wow Flutter -> Noise Blender -> Saturation
   - **Wow Flutter:** 加入柔和的音高晃动
   - **Noise Blender:** 营造黑胶底噪氛围
   - **Saturation:** 增添模拟温暖感
   - **结果:** 富有黑胶唱片韵味的听感

### FM 电台风格
1. Multiband Compressor -> Stereo Blend
   - **Multiband Compressor:** 营造“电台”般的声音
   - **Stereo Blend:** 调整立体声宽度，获得舒适的声场（100-150%）
   - **结果:** 饱满顺滑的 FM 电台风格声音

### Lo-Fi 质感
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - **Bit Crusher:** 降低位深，营造复古颗粒感
   - **Simple Jitter:** 加入数字时基瑕疵
   - **RS Reverb:** 营造空间氛围
   - **结果:** 经典 Lo-Fi 质感

## 故障排除和常见问题

如果遇到问题，请参阅[故障排除和常见问题](faq.md)。

若问题仍未解决，请通过 [GitHub Issues](https://github.com/Frieve-A/effetune/issues) 反馈。

## 可用效果

| 分类 | 效果 | 说明 | 文档 |
|-----------|--------|-------------|---------------|
| Analyzer  | Analog Meter | 用带有 VU、PPM、峰值和响度刻度的指针表显示声道电平 | [详情](plugins/analyzer.md#analog-meter) |
| Analyzer  | Chroma Spiral | 以一圈一个八度的螺旋显示各音名的频率成分强度 | [详情](plugins/analyzer.md#chroma-spiral) |
| Analyzer  | Level Meter | 显示带峰值保持的音频电平 | [详情](plugins/analyzer.md#level-meter) |
| Analyzer  | Note Spectrogram | 以钢琴卷帘图显示随时间变化的估算音高 | [详情](plugins/analyzer.md#note-spectrogram) |
| Analyzer  | Oscilloscope | 实时波形可视化 | [详情](plugins/analyzer.md#oscilloscope) |
| Analyzer  | Pitch Meter | 随时间跟踪一个基频及其调音偏差 | [详情](plugins/analyzer.md#pitch-meter) |
| Analyzer  | Rhythm Analyzer | 按频段或鼓声类别显示节奏速度与起音时间 | [详情](plugins/analyzer.md#rhythm-analyzer) |
| Analyzer  | Spectrogram | 显示频谱随时间的变化 | [详情](plugins/analyzer.md#spectrogram) |
| Analyzer  | Spectrum Analyzer | 实时显示低频、中频和高频的强弱 | [详情](plugins/analyzer.md#spectrum-analyzer) |
| Analyzer  | Stereo Meter | 可视化立体声平衡与声道相关性 | [详情](plugins/analyzer.md#stereo-meter) |
| Basics    | Bass Management | 将低频重定向到一个或多个低音炮，并将 LFE 与主声道低频相加 | [详情](plugins/basics.md#bass-management) |
| Basics    | Channel Divider | 将立体声信号分成多个频段，并把各频段路由到独立的立体声输出对 | [详情](plugins/basics.md#channel-divider) |
| Basics    | DC Offset | DC 偏移调整 | [详情](plugins/basics.md#dc-offset) |
| Basics    | FIR Crossover | 将陡峭分频后的频段路由到立体声输出对的 FIR 分频器 | [详情](plugins/basics.md#fir-crossover) |
| Basics    | Matrix | 灵活路由并混合音频通道 | [详情](plugins/basics.md#matrix) |
| Basics    | MultiChannel Panel | 多通道控制面板，支持音量、静音、独奏和延迟 | [详情](plugins/basics.md#multichannel-panel) |
| Basics    | Mute | 完全静音音频信号 | [详情](plugins/basics.md#mute) |
| Basics    | Polarity Inversion | 信号极性反转 | [详情](plugins/basics.md#polarity-inversion) |
| Basics    | Stereo Balance | 立体声通道平衡控制 | [详情](plugins/basics.md#stereo-balance) |
| Basics    | Volume | 基本音量控制 | [详情](plugins/basics.md#volume) |
| Delay     | Delay | 标准延迟效果 | [详情](plugins/delay.md#delay) |
| Delay     | Time Alignment | 为扬声器与聆听位置校准微调播放时序 | [详情](plugins/delay.md#time-alignment) |
| Dynamics  | Attack Tonal Balance | 平衡短促起音与持续音调结构 | [详情](plugins/dynamics.md#attack-tonal-balance) |
| Dynamics  | Auto Leveler | 基于LUFS测量的自动音量调整，以实现一致的聆听体验 | [详情](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | 限制信号峰值以防止数字削波 | [详情](plugins/dynamics.md#brickwall-limiter) |
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
| EQ        | 5Band FIR PEQ | 采用 Minimum Phase 或 Linear Phase FIR 滤波的 5 频段参数均衡器 | [详情](plugins/eq.md#5band-fir-peq) |
| EQ        | 5Band PEQ | 灵活塑造低频、中频和高频的 5 频段均衡器 | [详情](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | 专注于特定频率 | [详情](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | 添加相位感、中空感或金属感染色 | [详情](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | 用于确认普通耳机线差异造成的频率响应变化通常很小 | [详情](plugins/eq.md#earphone-cable-sim) |
| EQ        | Group Delay EQ | 在不改变音色的前提下调整各频段的延迟 | [详情](plugins/eq.md#group-delay-eq) |
| EQ        | Group Delay PEQ | 在不改变音色的前提下用五个参量频段调整各频率的延迟 | [详情](plugins/eq.md#group-delay-peq) |
| EQ        | Hi Pass Filter | 精确去除不需要的低频 | [详情](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | 精确去除不需要的高频 | [详情](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | 针对低音量聆听的频率平衡校正 | [详情](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | 高通和低通滤波器的组合 | [详情](plugins/eq.md#narrow-range) |
| EQ        | Room EQ | 根据已保存的房间测量进行FIR校正 | [详情](plugins/eq.md#room-eq) |
| EQ        | Tilt EQ | 倾斜均衡器，用于快速音色塑造 | [详情](plugins/eq.md#tilt-eq)      |
| EQ        | Tonal Balance EQ | 按音乐风格目标自动校正长期音色平衡 | [详情](plugins/eq.md#tonal-balance-eq) |
| EQ        | Tone Control | 三频段音色控制 | [详情](plugins/eq.md#tone-control) |
| Lo-Fi     | AM Radio Simulator | 让音乐经过建模的 AM 广播与接收链路 | [详情](plugins/lofi.md#am-radio-simulator) |
| Lo-Fi     | Bit Crusher | 降低位深并应用零阶保持效果 | [详情](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Cassette Artifacts | 把音乐录到建模的紧凑型卡带上，再通过带 Dolby B/C 的 Type I/II/IV 卡座放出来 | [详情](plugins/lofi.md#cassette-artifacts) |
| Lo-Fi     | Digital Error Emulator | 模拟各种数字音频传输错误和复古数字设备特性 | [详情](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | 模拟 DSD64 超声噪声引发的可闻互调失真 | [详情](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | FM Radio Simulator | 让音乐通过物理仿真的 FM 广播与接收链路 | [详情](plugins/lofi.md#fm-radio-simulator) |
| Lo-Fi     | G.726 Simulator | 模拟 ITU-T G.726 语音编解码往返处理，并可选叠加有误码的无线链路 | [详情](plugins/lofi.md#g726-simulator) |
| Lo-Fi     | GSM-FR Simulator | 模拟 13 kbit/s GSM-FR 语音编解码往返处理，含帧丢失隐藏的无线链路 | [详情](plugins/lofi.md#gsm-fr-simulator) |
| Lo-Fi     | Hum Generator | 加入可控的 50/60 Hz 电气嗡声氛围，适合复古/lo-fi 聆听 | [详情](plugins/lofi.md#hum-generator) |
| Lo-Fi     | MD Simulator | 重现 MiniDisc 时代的 ATRAC 编码与解码往返处理 | [详情](plugins/lofi.md#md-simulator) |
| Lo-Fi     | MP3 Codec Simulator | 模拟低码率 MPEG Layer III 的纯净编码/解码往返处理 | [详情](plugins/lofi.md#mp3-codec-simulator) |
| Lo-Fi     | Noise Blender | 加入可调背景噪声质感，营造 lo-fi 氛围 | [详情](plugins/lofi.md#noise-blender) |
| Lo-Fi     | SBC Codec Simulator | 再现 Bluetooth A2DP SBC 编码/解码往返处理，并可选叠加链路丢包与隐藏处理 | [详情](plugins/lofi.md#sbc-codec-simulator) |
| Lo-Fi     | Simple Jitter | 数字抖动模拟 | [详情](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | SW Radio Simulator | 让音乐经过建模的短波广播、电离层传播与接收链路 | [详情](plugins/lofi.md#sw-radio-simulator) |
| Lo-Fi     | Tape Artifacts | 将音乐录到建模的开盘磁带上再放出来 | [详情](plugins/lofi.md#tape-artifacts) |
| Lo-Fi     | TV Audio Simulator | 让音乐经过建模的模拟电视和NICAM数字电视伴音通路 | [详情](plugins/lofi.md#tv-audio-simulator) |
| Lo-Fi     | Vinyl Artifacts | 加入黑胶风格的爆点、噼啪声、嘶声、隆隆声和立体声噪声串扰 | [详情](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi     | Vinyl Simulator | 将输入刻入模拟唱槽，再用物理唱针模型播放 | [详情](plugins/lofi.md#vinyl-simulator) |
| Modulation | Auto Filter | 通过LFO或音量包络扫动共振滤波器 | [详情](plugins/modulation.md#auto-filter) |
| Modulation | Auto Pan | 让每个立体声声道对的电平在声场中平滑移动 | [详情](plugins/modulation.md#auto-pan) |
| Modulation | Chorus | 通过移动延迟加入合唱、合奏、镶边或颤音 | [详情](plugins/modulation.md#chorus) |
| Modulation | Doppler Distortion | 模拟因扬声器振膜微动引起的自然动态音色变化 | [详情](plugins/modulation.md#doppler-distortion) |
| Modulation | Frequency Shifter | 进行频率平移、环形调制或理发杆式频移 | [详情](plugins/modulation.md#frequency-shifter) |
| Modulation | Phaser | 以经典或理发杆式扫频产生移动的峰和陷波 | [详情](plugins/modulation.md#phaser) |
| Modulation | Pitch Shifter | 在不改变速度的情况下升高或降低音乐音高 | [详情](plugins/modulation.md#pitch-shifter) |
| Modulation | Pitch Shifter HQ | 减少相位伪影，更细致地升高或降低音高 | [详情](plugins/modulation.md#pitch-shifter-hq) |
| Modulation | Rotary Speaker | 结合高音号角与低音鼓的独立旋转 | [详情](plugins/modulation.md#rotary-speaker) |
| Modulation | Tremolo | 基于音量的调制效果 | [详情](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | 加入轻微磁带或唱片式音高摇摆，营造复古特性 | [详情](plugins/modulation.md#wow-flutter) |
| Resonator | Adaptive Prediction | 学习音频预测，用于提取残差或生成不断变化的共鸣声 | [详情](plugins/resonator.md#adaptive-prediction) |
| Resonator | Horn Resonator | 具有可自定义尺寸的号角共鸣模拟 | [详情](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | 更平滑的号角扬声器共鸣，带来自然的聆听色彩 | [详情](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | 支持最多5个谐振器的频率共鸣效果 | [详情](plugins/resonator.md#modal-resonator) |
| Restoration | Click Remover | 修复短促的咔嗒声、噼啪声、爆音和短暂断音 | [详情](plugins/restoration.md#click-remover) |
| Restoration | Clip Restorer | 修复因硬削波而变平的峰值 | [详情](plugins/restoration.md#clip-restorer) |
| Restoration | Hum Remover | 去除持续的电源嗡声及其谐波 | [详情](plugins/restoration.md#hum-remover) |
| Restoration | Noise Reduction | 在保留音乐的同时降低持续的背景噪声 | [详情](plugins/restoration.md#noise-reduction) |
| Reverb    | Dattorro Plate Reverb | 基于Dattorro算法的经典板式混响 | [详情](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | 反馈延迟网络混响，产生丰富密集的混响纹理 | [详情](plugins/reverb.md#fdn-reverb) |
| Reverb    | IR Reverb | 使用导入房间和设备脉冲响应的卷积混响 | [详情](plugins/reverb.md#ir-reverb) |
| Reverb    | RS Reverb | 具有自然扩散的随机散射混响 | [详情](plugins/reverb.md#rs-reverb) |
| Saturation| Bandwidth Extender | 在检测或指定的截止频率以上生成高频内容 | [详情](plugins/saturation.md#bandwidth-extender) |
| Saturation| Bass Extender | 从合适的低频内容生成低一个八度的低音 | [详情](plugins/saturation.md#bass-extender) |
| Saturation| Dynamic Saturation | 模拟扬声器振膜的非线性位移 | [详情](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | 添加谐波内容以增强清晰度和存在感 | [详情](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | 数字硬削波效果 | [详情](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | 通过可调的 2 至 5 阶谐波失真添加个性 | [详情](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | 分别为低频、中频和高频添加暖度或边缘感 | [详情](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | 添加模拟风格的温暖、丰润和个性 | [详情](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | 混入经过滤波的低频信号以增强低音 | [详情](plugins/saturation.md#sub-synth) |
| Saturation| Tube Simulator | 模拟电子管线路级以及推挽或 300B/2A3 单端三极管功率放大器 | [详情](plugins/saturation.md#tube-simulator) |
| Spatial   | Crossfeed Filter | 用于自然立体声成像的耳机交叉馈送滤波器 | [详情](plugins/spatial.md#crossfeed-filter) |
| Spatial   | Crosstalk Cancellation | 使用耳边测量值减少立体声音箱之间的串扰 | [详情](plugins/spatial.md#crosstalk-cancellation) |
| Spatial   | MS Matrix | 在立体声和 Mid/Side 之间转换，用于调整中央与氛围成分 | [详情](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | 5 频段频率相关立体声平衡控制 | [详情](plugins/spatial.md#multiband-balance) |
| Spatial   | Phase Select EQ | 按 L/R 相位差和 Balance 选择并提升或衰减频率成分 | [详情](plugins/spatial.md#phase-select-eq) |
| Spatial   | Spatial Mapper | 将声音分为 Direct、Diffuse 和 Residual，以便灵活进行多通道路由 | [详情](plugins/spatial.md#spatial-mapper) |
| Spatial   | Stereo Blend | 从极性互换的立体声经单声道到增强立体声，控制声场宽度 | [详情](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | 用于检查扬声器/耳机的测试音和噪声发生器 | [详情](plugins/others.md#oscillator) |
| Others    | SFZ Note Player | 用导入的 SFZ 乐器播放检测到的音符 | [详情](plugins/others.md#sfz-note-player) |
| Control   | Section | 将效果分组，让整个区段可被旁路或恢复 | [详情](plugins/control.md) |

## 技术信息

### 浏览器兼容性

Frieve EffeTune 已在 Google Chrome 上完成测试验证。应用需要支持以下特性的现代浏览器：
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker（用于可安装网页应用和离线启动）

### 浏览器支持详情

1. Chrome/Chromium
   - 完整支持，推荐使用
   - 请更新到最新版本以获得最佳性能

2. Firefox/Safari
   - 支持有限
   - 输出设备选择、Wake Lock、安装行为和支持的音频格式等功能因浏览器而异
   - 建议使用 Chrome 以获得最佳体验

### 推荐采样率

请将 EffeTune 的 **采样率** 设为 96 kHz，这样可以减少饱和等非线性效果产生的可闻混叠。此设置决定 EffeTune 的内部处理采样率，独立于操作系统、音频接口或虚拟音频设备的采样率工作。请确认应用中显示的实际采样率：在保存设置之前，它可能沿用操作系统或浏览器的默认值；在网页应用中，如果无法使用 96 kHz，可能会改用其他采样率。如果播放出现断音，请先关闭高负载的效果或缩短效果链，只有在必要时才降低采样率。

## 开发指南

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

想要创建自己的音频插件？请参阅[插件开发指南](../../plugin-development.md)。

## DSP 库

EffeTune 的 DSP 引擎同时也是一个独立、确定性、采用 MIT 许可证的库，可用于 Python、JavaScript 和浏览器 AudioWorklet。其公开的 Chain 架构和自动生成的效果目录无需 EffeTune 应用即可使用。详情请参阅 [EffeTune DSP Library 文档](https://effetune.frieve.com/dsp/)。

安装方法和可直接运行的完整示例，请参阅各软件包的快速入门：

- [Python 软件包](https://effetune.frieve.com/dsp/getting-started/python/)
- [JavaScript 与 AudioWorklet 软件包](https://effetune.frieve.com/dsp/getting-started/javascript/)

[DSP Library 指南](https://effetune.frieve.com/dsp/)介绍了各效果、架构、处理行为以及所需的资源文件。

## 链接

[版本历史](../../version-history.md)

[源代码](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[在Ko-fi上支持我们](https://ko-fi.com/frievea)
