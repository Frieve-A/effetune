---
title: "调制插件 - EffeTune"
description: "包含 Doppler Distortion、Pitch Shifter、Tremolo 和 Wow Flutter 的调制效果插件。"
lang: zh
---

# 调制插件

这些插件通过周期性或动态变化，为音乐加入移动感、复古摇摆或音高变化。

## 插件列表

- [Doppler Distortion](#doppler-distortion) - 模拟扬声器振膜细微运动造成的自然动态变化
- [Pitch Shifter](#pitch-shifter) - 在不改变速度的情况下调整音高
- [Tremolo](#tremolo) - 基于音量的调制效果
- [Wow Flutter](#wow-flutter) - 加入磁带或唱片式音高摇摆

## Doppler Distortion

一种独特的音频效果，用物理模型模拟扬声器振膜运动引起的细微多普勒失真。它能让声音带有自然的动态移动感。

### 参数

- **Coil Force (N / V)**
  控制输入信号驱动模拟扬声器音圈运动的强度。数值越高，多普勒失真越明显。

- **Speaker Mass (kg)**
  模拟扬声器振膜重量，影响运动的自然程度。
  - **较高值：** 增加惯性，使响应更慢，失真更平滑、更细微。
  - **较低值：** 减少惯性，产生更快、更明显的调制效果。

- **Spring Constant (N/m)**
  表示扬声器悬边的刚性。较高值会限制运动，声音更紧。

- **Damping Factor (N·s/m)**
  控制运动的阻尼。较高值会更快抑制振膜运动。
  - **较高值：** 更快稳定，减少振荡，效果更紧、更可控。
  - **较低值：** 让运动持续更久，产生更松散、更延展的动态波动。

### 推荐设置

为了获得平衡自然的增强，可从以下设置开始：
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg
- **Spring Constant:** 6000 N/m
- **Damping Factor:** 1.5 N·s/m

## Pitch Shifter

一个移调效果，可在不改变播放速度的情况下升高或降低音乐音高。适合轻微调音、创意听感，或让歌曲与特定音高更合拍。

### 参数
- **Pitch Shift** - 以半音为单位调整整体音高（-6 到 +6）
  - 负值：降低音高
  - 0：原始音高
  - 正值：升高音高
- **Fine Tune** - 以音分为单位进行细微音高调整（-50 到 +50）
  - 适合细微校准
  - 当一个完整半音变化太大时使用
- **Window Size** - 控制分析窗口长度（80 到 500ms）
  - 较小值（80-150ms）：更适合打击乐等瞬态丰富的素材
  - 中等值（150-300ms）：适合大多数音乐的平衡选择
  - 较大值（300-500ms）：更适合平滑、持续的声音
- **XFade Time** - 设置处理片段之间的交叉淡化时间（20 到 40ms）
  - 影响移调片段之间的衔接平滑度
  - 较低值可能更直接，但平滑度可能降低
  - 较高值过渡更平滑，但可能增加摇晃感或重叠感

## Tremolo

通过周期性改变音量，为音乐加入类似脉冲的起伏感。它可以从轻微摇动到明显切分，为聆听增加律动或复古风味。

### 聆听体验指南
- 轻微运动：
  - 缓慢、浅幅调制带来柔和起伏
  - 适合氛围感和轻微复古感
- 经典 Tremolo：
  - 中等 Rate 和 Depth 形成明显音量波动
  - 适合吉他、电子音乐和复古风格
- 强烈切分：
  - 高 Depth 和较快 Rate 产生断续效果
  - 适合创意听感，请注意舒适度

### 参数
- **Rate** - 音量变化速度（0.1 到 50 Hz）
  - 慢速（0.1-2 Hz）：柔和、细微的脉冲
  - 中速（2-6 Hz）：经典 tremolo 效果
  - 快速（6-20 Hz）：戏剧化、切分感强
  - 极快（20-50 Hz）：非常快速的音量调制，可加入粗糙或嗡鸣质感；为舒适聆听请谨慎使用
- **Depth** - 音量变化幅度（0 到 12 dB）
  - 轻微（0-3 dB）：柔和音量变化
  - 中等（3-6 dB）：明显脉冲感
  - 强烈（6-12 dB）：大幅音量起伏
- **Ch Phase** - 立体声声道之间的相位差（-180 到 180 度）
  - 0°：两个声道一起脉冲（单声道 tremolo）
  - 90° 或 -90°：产生旋转、盘旋效果
  - 180° 或 -180°：两个声道反向脉冲（最大立体声宽度）
- **Randomness** - 音量变化变得不规则的程度（0 到 96 dB）
  - 低值：更可预测、更规律的脉冲
  - 中等：自然的复古变化
  - 高值：更不稳定、更有机的声音
- **Randomness Cutoff** - 随机变化发生的速度（1 到 1000 Hz）
  - 较低值：更慢、更柔和的随机变化
  - 较高值：更快、更不规则的变化
- **Randomness Slope** - 控制随机滤波的强度（-12 到 0 dB）
  - -12 dB：更平滑、更渐进的随机变化（更柔和）
  - -6 dB：平衡响应
  - 0 dB：更锐利、更明显的随机变化（更强烈）
- **Ch Sync** - 左右声道随机变化的同步程度（0 到 100%）
  - 0%：每个声道使用独立随机变化
  - 50%：两个声道部分同步
  - 100%：两个声道共享同一个随机模式

### 不同风格的推荐设置

1. 经典吉他放大器 Tremolo
   - Rate: 4-6 Hz（中等速度）
   - Depth: 6-8 dB
   - Ch Phase: 0°（单声道）
   - Randomness: 0-5 dB
   - 适合：Blues、Rock、Surf Music

2. 立体声迷幻效果
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180°（左右声道相反）
   - Randomness: 10-20 dB
   - 适合：Psychedelic Rock、Electronic、Experimental

3. 轻微增强
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - 适合：任何需要轻微运动感的音乐

4. 强烈脉冲
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - 适合：Electronic、Dance、Ambient

### 快速入门指南
1. 想要经典 tremolo 声音：
   - 从中等 Rate（4-5 Hz）开始
   - 加入适中 Depth（6 dB）
   - Ch Phase 设为 0° 获得单声道 tremolo，或设为 90° 获得立体声运动
   - 将 Randomness 保持较低（0-5 dB）
   - 按听感微调

2. 想要更多个性：
   - 逐渐增加 Randomness
   - 尝试不同 Ch Phase 设置
   - 尝试不同 Rate 和 Depth 组合
   - 以实际听感为准

## Wow Flutter

为音乐加入类似唱片偏心、磁带走带不稳的细微音高摇摆。轻微使用可带来复古味道，较强设置会变成明显特殊效果。

### 聆听体验指南
- 黑胶唱片感：
  - 低速、轻微音高变化
  - 增添怀旧、不完美的播放感
- 磁带 Flutter：
  - 较快的小幅摇摆
  - 模拟老式磁带机的不稳定
- 创意效果：
  - 较大 Depth 和 Randomness 会产生明显扭曲
  - 适合 lo-fi 或实验性聆听

### 参数
- **Rate** - 周期性摇摆速度（0.1 到 20 Hz）
  - 慢速（0.1-2 Hz）：黑胶唱片式运动
  - 中速（2-6 Hz）：盒式磁带式 flutter
  - 快速（6-20 Hz）：创意效果
- **Depth** - 延迟时间调制强度，也就是音高摇摆强度（0 到 40 ms）
  - 轻微（0-6 ms）：柔和复古特性
  - 中等（6-15 ms）：明显的磁带/黑胶感觉
  - 强烈（15-40 ms）：戏剧化特殊效果
- **Ch Phase** - 立体声声道之间的相位差（-180 到 180 度）
  - 0°：两个声道一起摇摆
  - 90° 或 -90°：产生旋转、盘旋效果
  - 180° 或 -180°：左右声道反向摇摆
- **Randomness** - 随机音高不稳定量（0 到 40 ms）
  - 低值：更可预测、更规律的运动
  - 中等：自然的复古变化
  - 高值：更不稳定，有老旧设备的感觉
- **Randomness Cutoff** - 随机变化发生的速度（0.1 到 20 Hz）
  - 较低值：缓慢、漂移感
  - 较高值：更快、更颤动
- **Randomness Slope** - 控制随机滤波的强度（-12 到 0 dB）
  - -12 dB：更平滑、更渐进的随机变化（更柔和）
  - -6 dB：平衡响应
  - 0 dB：更锐利、更明显的随机变化（更强烈）
- **Ch Sync** - 左右声道随机变化的同步程度（0 到 100%）
  - 0%：两声道随机变化独立
  - 50%：两个声道部分同步
  - 100%：两声道随机变化相同

### 不同风格的推荐设置

1. 经典黑胶体验
   - Rate: 0.3-0.8 Hz（缓慢柔和）
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - 适合：Jazz、Classical、Vintage Rock

2. 复古磁带感
   - Rate: 4-6 Hz（较快 flutter）
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - 适合：Lo-Fi、Pop、Rock

3. 梦幻氛围
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - 适合：Ambient、Electronic、Experimental

4. 轻微增强
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - 适合：任何需要轻微复古味道的音乐

### 快速入门指南

1. 想要自然复古声：
   - 从慢速 Rate（0.5-1 Hz）开始
   - 加入轻微 Depth（2-6 ms）
   - 加一点 Randomness（1-4 ms）
   - 将 Randomness Cutoff 设在 0.5-3 Hz 左右
   - 保持 Ch Phase 为 0°、Ch Sync 为 100%
   - 按喜好微调
