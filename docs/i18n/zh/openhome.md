---
title: "OpenHome 远程控制（桌面应用） - EffeTune"
description: "通过局域网中的 OpenHome 控制器应用操作 EffeTune 桌面应用：设置方法、网络访问、兼容性与限制。"
lang: zh
---

# OpenHome 远程控制（桌面应用）

在受支持的桌面版本（Windows x64、macOS Intel/Apple silicon 和 Linux x64）中，EffeTune 可以作为 OpenHome 播放器出现在同一局域网内的控制器应用中。打开 **设置 > 配置...**，启用 **允许此网络中的 OpenHome 控制器**（默认关闭），并等待状态显示 EffeTune 已就绪。默认播放器名称为 `EffeTune (电脑名称)`；可通过 **播放器名称** 设置自定义名称，例如 `EffeTune Living Room`。

OpenHome 不需要登录。启用期间，同一局域网内的其他设备可以查看播放元数据、编辑播放器队列并控制播放。如果 Windows 防火墙请求权限，请只允许 EffeTune 访问 **专用网络**，不要允许 **公用网络**。不需要远程控制时请关闭此选项。

控制器可以添加 HTTP 或 HTTPS 音频流、管理远程播放队列，以及控制播放、暂停、停止、切歌、跳转、循环和随机播放。远程音频同样会照常经过当前的 EffeTune 效果链。基本的队列与播放控制已在 Android 版 BubbleUPnP 上验证；其他 OpenHome 应用显示服务的方式可能有所不同。EffeTune 作为 OpenHome Playlist 源运行（而非 UPnP AV MediaRenderer），不会通过 OpenHome 提供效果编辑、本地文件路径、主音量、Radio、Songcast 或多房间同步。

无法保证无间隙播放；在音源提供之前，技术元数据可能一直显示为未知。睡眠、唤醒、连接 VPN 或网络变化后，播放器可能会在重新连接期间短暂消失。

[← 返回 README](README.md)
