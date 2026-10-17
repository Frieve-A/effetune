---
title: "浏览器扩展 - 适用于 Chrome 和 Edge 的均衡器与音频效果 - EffeTune"
description: "使用 EffeTune 浏览器扩展同时处理最多四个 Chrome 或 Edge 标签页的音频，支持按 URL 自动切换预设和选择采样率。"
lang: zh
---

# EffeTune 浏览器扩展

EffeTune 浏览器扩展可同时处理最多四个浏览器标签页的音频，每个标签页都拥有独立的立体声 Effect Pipeline。无需启动桌面应用或配置虚拟音频设备，即可在视频或音乐网站上加工声音来聆听。

有关本地数据的处理方式以及可选的外部链接，请阅读[浏览器扩展隐私政策](../../browser-extension-privacy.md)。如需帮助，可以使用 [GitHub Issues](https://github.com/Frieve-A/effetune/issues)，但请不要在公开的 Issue 中发布音频、标签页标题或 URL、预设、测量数据、脉冲响应或其他个人信息。

## 兼容环境

请在电脑端使用 Chrome 116 或更高版本，或兼容的 Chromium 内核 Microsoft Edge。不支持 Firefox、Safari、移动端浏览器和无痕/隐私浏览模式。每个标签页使用一条立体声效果链。

## 安装本地扩展包

如果从浏览器扩展商店获取，请直接在商店中安装。若使用本地扩展包，请先将 `effetune-extension-<version>.zip` 解压到一个长期保留的文件夹中，然后加载该解压后的文件夹：

1. 在 Chrome 中打开 `chrome://extensions`；在 Edge 中打开 `edge://extensions`。
2. 开启 **Developer mode**。
3. 选择 **Load unpacked**，然后选择解压后的扩展文件夹。

**Load unpacked** 无法直接安装 ZIP 文件本身。替换解压文件夹内的文件后，请在该页面重新加载扩展。

## 开始、对比和停止处理

1. 打开要处理音频的标签页并开始播放。
2. 从浏览器工具栏打开 EffeTune 扩展。
3. 选择 **Start on this tab**。当效果链准备就绪后，状态会从 **Starting…** 变为 **Processing**。

若要添加另一个标签页，请在该标签页中打开扩展，然后选择 **Start on this tab**。弹窗中会列出所有会话。最多可同时运行四个标签页；启动第五个之前请先停止其中一个。

使用标签页旁的 **Bypass**，可在保持会话活动的同时聆听不加效果的声音。使用完毕后，选择该标签页旁的 **Stop**。停止后该标签页会恢复普通播放，而不会打断其他标签页。

关闭扩展弹窗或编辑器后，处理仍会继续。再次打开任一窗口时，会显示当前标签页及其处理状态。重启浏览器后，请开始新的会话；扩展不会自动捕获标签页。

## 编辑 Effect Pipeline 和使用预设

选择 **Edit pipeline** 打开 **EffeTune Pipeline Editor**，然后在顶部栏选择目标标签页。添加、排序、开关和调节效果器的方式与 EffeTune 相同；分析器显示会跟随所选标签页。当没有活动标签页时，可通过 **Offline pipeline** 编辑下次启动标签页时使用的默认效果链。

在编辑器顶部栏选择 **Visualizer** 可在 [Visualizer](visualizer.md) 中查看所选标签页处理后的音频，再次点击即可返回效果链。扩展中不显示曲目标题和专辑封面，**Share** / **Import Link** 的用法与网页版相同。

若要在弹窗中快速切换预设，请先选中标签页，选择 **Saved preset**，然后点击 **Apply to selected tab**。在编辑器中，可通过 **Pipeline Presets > Save as** 保存预设，或通过 **Settings > Import preset…** / **Export preset** 交换 `.effetune_preset` 文件。如果预设需要扩展不支持的多声道路由或效果器，或缺少外部资源，当前效果链会保持不变。

若要在 **Room EQ** 或 **Crosstalk Cancellation** 中使用来自网页版或桌面应用的房间或扬声器测量数据：

1. 在网页版或桌面应用中将测量结果导出为 JSON（用于 **Crosstalk Cancellation** 或 **Room EQ** 相位校正时，请包含脉冲响应）。
2. 在扩展编辑器中打开 **Settings > Import measurement…** 并选择该 JSON 文件。
3. 在 **Room EQ** 或 **Crosstalk Cancellation** 中选择导入的测量数据。若要删除导入的副本，请在 Room EQ 的 **Measurement** 列表中选中它并选择 **Delete**；确认后，所有使用该测量数据的 Room EQ 和 Crosstalk Cancellation 分配都会被清除。

若要在网页版、桌面应用和浏览器扩展之间一并迁移预设、效果器预设、Visualizer 预设、脉冲响应和导入的测量数据，请使用 **Settings > Backup / Restore**（`.effetune_backup`）。扩展中的预设、布局和导入的测量数据均保存在扩展内部，不会与网页版或桌面应用自动同步。备份不包含 URL 规则和扩展的采样率设置。

## URL 预设与采样率

打开 **Settings > URL rules…**，可在标签页 URL 匹配 `host/path` 模式（例如 `example.com/music/*`，其中 `*` 匹配任意文本）时自动加载已保存的预设。每个标签页仍需由你手动开始；规则只在开始时和 URL 变化时为其选择预设。列表中第一个匹配且已启用的规则优先生效；若无匹配规则，则使用默认效果链。规则的更改会在下次开始或页面跳转时生效。编辑由 URL 规则加载的效果链会更新该规则对应的已保存预设，而其他编辑（包括手动应用预设后的编辑）会更新默认效果链。删除预设后，使用该预设的规则会被停用，使用这些规则的标签页会恢复为默认效果链。

**Settings** 中的 **Sample rate**（**Auto**、**44.1 kHz**、**48 kHz**、**96 kHz** 或 **192 kHz**）对所有活动标签页生效。**Auto** 由浏览器自行选择。更改采样率会短暂重启活动标签页的处理，同时保留其捕获。如果某个标签页无法在新采样率下运行，会恢复普通播放；请改选其他采样率并重新开始该标签页。

## 权限与限制

扩展仅在你点击 **Start on this tab** 的标签页上捕获音频，且仅读取这些标签页的 URL 用于匹配 URL 预设规则。它绝不会读取网页内容、注入脚本、使用麦克风或通过网络发送音频。

每个标签页运行一条支持 **Main** 和 **Bus 1–4** 的立体声效果链。多声道输出（>2ch）、执行声学测量、音乐库、批量离线文件转换以及桌面端专属硬件功能在扩展中不可用。阻止浏览器捕获的受保护（DRM）流媒体会恢复普通播放。

## 常见问题排查

- **状态显示“Needs attention”或无法开始捕获：** 请确认该标签页正在播放音频，然后再次点击 **Start on this tab**。
- **无法应用预设：** 编辑器会保留当前效果链。请检查所需的测量数据或脉冲响应资源是否已事先导入到扩展中。

[← 返回 README](README.md)
