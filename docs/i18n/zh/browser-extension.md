---
title: "浏览器扩展 - EffeTune"
description: "使用 EffeTune 浏览器扩展处理一个 Chrome 或 Edge 标签页的音频。"
lang: zh
---

# EffeTune 浏览器扩展

浏览器扩展可用与 EffeTune 相同的立体声 **Effect Pipeline** 处理一个浏览器标签页的音频。它适合在不启动桌面应用、也不配置虚拟音频设备的情况下收听视频或音乐网站。

## 兼容性和安装

请在装有 Chrome 116 或更高版本，或兼容的基于 Chromium 的 Microsoft Edge 的 PC 上使用。Firefox、Safari、移动浏览器和隐私浏览不受支持。每个会话只处理一个选定标签页，并使用串行立体声效果链。

从扩展商店获得的扩展请在该商店安装。对于本地包，请将 `effetune-extension-<version>.zip` 解压到会保留的文件夹。在 Chrome 中打开 `chrome://extensions`，在 Edge 中打开 `edge://extensions`，开启 **Developer mode**，选择 **Load unpacked**，再选择该文件夹。**Load unpacked** 不能直接安装 ZIP 文件；替换文件后，请在此页面重新加载扩展。

## 开始、对比和停止处理

1. 打开要处理其音频的标签页并开始播放。
2. 从浏览器工具栏打开 EffeTune 扩展。
3. 选择 **Start processing**。效果链准备好后，状态会从 **Starting…** 变为 **Processing**。

选定的标签页会在整个会话中保持不变。若要处理其他标签页，请选择 **Stop processing**，在目标标签页中打开扩展，然后重新开始。**Bypass effects** 可在保持会话的同时收听没有效果的已捕获音频。**Stop processing** 会释放标签页音频并恢复正常播放路径。

关闭扩展弹窗或编辑器后，处理仍会继续。再次打开时会显示当前标签页和实际状态。重启浏览器后请手动开始新会话；扩展不会自动捕获标签页。

## 编辑效果链和使用预设

选择 **Edit pipeline** 可打开 **EffeTune Pipeline Editor**。您可像在 EffeTune 中一样添加、排序、启用或禁用效果，调节参数，并使用可用的分析显示。弹窗中的 **Saved preset** 和 **Apply** 可以不打开编辑器而更换完整效果链。在编辑器中打开 **Pipeline Presets**，可通过 **Save as** 保存完整效果链预设。要导入或导出完整预设，请打开 **Settings**，然后选择 **Import preset…** 或 **Export preset**。

已保存的设置和预设保存在扩展中，不会自动与网页应用或桌面应用同步。若预设需要不支持的路由、效果或不可用的外部资源，它不会被应用，当前效果链会保持不变。

要在 Room EQ 或 Crosstalk Cancellation 中使用网页应用或桌面应用的测量结果，请先在相应应用中将测量结果导出为 JSON。在扩展编辑器中打开 **Settings**，选择 **Import measurement…**，再选择该 JSON 文件。用于 Crosstalk Cancellation 或 Room EQ 相位校正时，导出时应包含脉冲响应。导入的测量结果会立即出现在 Room EQ 的 **Measurement** 列表中，保存在扩展的浏览器存储中，并且不会自动同步。如需删除导入的副本，请先在该列表中选中它，再选择列表旁的 **Delete**。确认后，会先清除所有使用该副本的 Room EQ 和 Crosstalk Cancellation 分配，再删除副本。

## 权限、限制和帮助

扩展只捕获您明确开始处理的标签页音频，不需要麦克风、所有网站的访问权限、录音或向其他位置发送音频。

它支持普通立体声效果链。不提供多总线或分支效果链、两个以上声道、执行新测量与设备控制、Music Library、批量文件转换，以及依赖设备或文件路径的桌面专用功能。

某些受保护内容可能无法捕获，扩展不会绕过内容保护。如果无法开始捕获，EffeTune 会停止处理，标签页会恢复正常播放。确认标签页正在播放音频后，再选择 **Start processing**。出现 **Needs attention** 时，也请这样操作。若无法应用预设，当前效果链会被保留；请更换预设或提供所需资源后重试。
