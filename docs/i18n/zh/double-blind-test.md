---
title: "Double Blind Test 使用方法 - EffeTune"
description: "说明如何在 EffeTune 中对两个效果 Pipeline 进行 ABX Test 和 A/B Preference Test 盲听，并结合统计显著性确认结果。"
lang: zh
---

# Double Blind Test 使用方法

Double Blind Test 可让您在不知道自己正在听哪一个的状态下，通过听感比较 **Pipeline A** 和 **Pipeline B**。它用于排除先入为主的判断，确认“好像听到了差异”是否真的能被分辨，以及自己是否确实更偏好其中一个 Pipeline。

测试有两种。

- **ABX Test**：检查您是否能可靠地区分两个 Pipeline。
- **A/B Preference Test**：在不知道哪一个是哪一个的情况下选择更喜欢的一方。

无论哪种测试，EffeTune 都会记录回答，并结合 p 值显示结果是否达到统计显著性。

## 准备两个 Pipeline

测试会比较 [AB Pipeline 功能](README.md#使用-ab-pipeline-功能) 中说明的两个 Pipeline。

- **Pipeline A** 和 **Pipeline B** 各自至少需要包含一个效果。
- 将要比较的两组设置分别放入 Pipeline A 和 Pipeline B。除要测试的一点差异（例如：*With EQ* 与 *Without EQ*）之外，最好让两边保持一致，这样才能只验证该差异本身。
- 对于 **A/B Preference Test**，两组设置哪一个放在 Pipeline A、哪一个放在 Pipeline B 都可以。测试中每一次 trial 都会随机决定哪条 Pipeline 作为 A 或 B 呈现，因此任何一边都不会占优势。如果交换两组设置，结果中显示的胜出 Pipeline 标签也会随之交换，但统计解释不变。重要的是记住每条 Pipeline 中放了什么设置。结果会显示 Pipeline A 和 Pipeline B 中哪一个被显著偏好，您需要把它与自己的设置对应起来，判断自己更喜欢哪种声音。明确的结果通常表示您能持续选择出真正影响偏好的差异；如果两者听起来相同，或选择分散，通常不会显示为显著偏好。
- 测试面板可以随时打开，但在两个 Pipeline 都准备好之前，开始按钮会保持禁用。如果没有 Pipeline B，界面会显示相应提示。

## 打开测试

- **Web App:** 在 Effect Pipeline 标题中，点击 A/B 切换按钮（根据当前 Pipeline 显示 “A” 或 “B” 的按钮）右侧的 **▼** 按钮，然后从打开的菜单中选择 **Double Blind Test**。
- **桌面应用:** 除了上述 **▼** 菜单，也可以从 **文件** 菜单中的 **Double Blind Test** 打开。

测试打开期间，Effect Pipeline 的显示会被隐藏，以免看到哪些效果正在启用，从而保持盲听状态。按 **×** 按钮可随时结束测试并返回普通界面。

## 设置测试

设置画面中可以指定以下项目。

- **Test name**：表示要测试的差异（例如：*With EQ vs. Without EQ*）。该输入框的操作感与 Effect Presets 类似，可以保存、加载和删除命名测试。保存的测试会包含两个 Pipeline 和测试次数，因此之后可以重新调用相同的比较。分享测试时必须填写测试名称。
- **Your name**：可选。会显示在结果中。留空时会变为 *Anonymous*。
- **Number of tests**：通过输入框或滑块指定 trial 次数。次数越多，结果越可靠，但所需时间也越长。默认值为 20。

按 **Start ABX Test** 或 **Start A/B Preference Test** 即可开始。

> **注意:** 测试中的 **A** 和 **B** 与 Effect Pipeline 的 Pipeline A、Pipeline B 是不同概念。每一次 trial 都会重新随机决定两条 Pipeline 中哪一条被分配给 A、哪一条被分配给 B，而且这个对应关系不会显示在画面上。因此，当前作为 A 听到的声音不一定是 Pipeline A，也无法凭 “A 应该就是 Pipeline A” 来猜测。这样才能保持不知道自己正在听哪一条 Pipeline 的状态。

## 播放音频

测试本身只是切换 Pipeline，因此音乐仍按平常方式准备。

- 拖放音乐文件（或从文件菜单打开），或
- 从物理音频源向 EffeTune 输入音频。

测试画面会显示音频设备的采样率作为参考。

## 进行 ABX Test

1. 使用 **Switch to A**、**Switch to B**、**Switch to X** 按钮切换正在播放的声音。**X** 与 A 或 B 中的一个相同，并且每一次 trial 都会随机决定。
2. 在判断 **X** 与哪一个相同之前，可以任意多次切换并比较。
3. 按 **X matches A** 或 **X matches B** 后，回答会被记录，并进入下一次 trial。

也可以用键盘切换。按 **A**、**B**、**X** 键，或按 **1**、**2**、**3** 键（主键盘上方或数字键盘）时，会像点击对应切换按钮一样切换当前播放的样本。投票时，**Q** 键对应 **X matches A**，**W** 键对应 **X matches B**。

## 进行 A/B Preference Test

1. 用 **Switch to A** 和 **Switch to B** 比较两个声音（此模式没有 X）。
2. 决定偏好后，按 **Prefer A** 或 **Prefer B**。

也可以用键盘切换。按 **A**、**B** 键，或按 **1**、**2** 键（主键盘上方或数字键盘）即可切换当前播放的样本。投票时，**Q** 键对应 **Prefer A**，**W** 键对应 **Prefer B**。

## 读取结果

所有 trial 结束后，会显示结果。

- **ABX Test**：显示正确率、正确数／总次数，以及单侧二项检验的 p 值。如果 **p < 0.05**，则结果具有统计显著性，说明您的回答不太可能仅由偶然造成，可以说您能够区分两个 Pipeline。否则，不能说您能够区分它们。
- **A/B Preference Test**：显示被选择次数更多的 Pipeline（同数时显示为 Pipeline A）、选择次数（次数／总数），以及双侧二项检验的 p 值。显示的百分比表示胜出一侧，因此始终为 50% 以上；百分比高本身并不表示存在真实偏好。判断应依据 p 值。如果 **p < 0.05**，可以说偏好存在显著偏向。否则，不能说存在显著偏好（接近 50% 的结果属于偶然范围）。

结果中也会显示完成测试所花费的总时间。

## 分享测试

按 **Share this test** 会将 URL 复制到剪贴板。该 URL 会 **重现两个效果 Pipeline 并打开盲听测试**，因此收到的人可以进行相同的 Pipeline 比较。可以在开始前的设置画面分享，也可以在测试结束后分享。开始前分享时，共享的重点是由两个 Pipeline 构成的比较；开始前请确认测试次数。完成测试后分享时，您的结果也会包含在内，收到的人可以先查看该结果，再自己进行相同的 Pipeline 比较。

分享测试需要两个 Pipeline 和测试名称。这样才能确保共享的比较有意义，并且能在对方环境中重现。

使用共享测试 URL 的方法：

- **Web App:** 在浏览器中打开共享 URL。EffeTune 会恢复两个 Pipeline，并自动打开 Double Blind Test。
- **桌面应用:** 复制共享 URL，切换到 EffeTune，然后通过 **编辑 > 粘贴**、**Ctrl+V**（macOS 为 **Command+V**），或工具栏的 **粘贴效果** 按钮进行粘贴。EffeTune 会读取剪贴板中的 URL，恢复两个 Pipeline，并打开 Double Blind Test。请在 Double Blind Test 面板尚未打开的状态下粘贴 URL。

[← 返回 README](README.md)
