---
title: "调制插件 - EffeTune"
description: "包含Auto Filter、Auto Pan、Chorus、Frequency Shifter、Phaser和Rotary Speaker的调制效果。"
lang: zh
---

# 调制插件

这些插件通过周期性或动态变化，为音乐加入移动感、复古摇摆或音高变化。

## 插件列表

- [Auto Filter](#auto-filter) - 由LFO或包络扫动共振滤波器
- [Auto Pan](#auto-pan) - 在声场中平滑移动每个立体声声道对
- [Chorus](#chorus) - 集成合唱、合奏、镶边和颤音
- [Doppler Distortion](#doppler-distortion) - 模拟扬声器振膜细微运动造成的自然动态变化
- [Frequency Shifter](#frequency-shifter) - 进行频率平移、Ring Mod或理发杆式扫频
- [Phaser](#phaser) - 通过全通滤波器产生移动的峰与陷波
- [Pitch Shifter](#pitch-shifter) - 在不改变速度的情况下调整音高
- [Pitch Shifter HQ](#pitch-shifter-hq) - 在音质比延迟和CPU占用更重要时，以更少的相位伪影调整音高
- [Rotary Speaker](#rotary-speaker) - 结合高音号角与低音鼓的独立运动
- [Tremolo](#tremolo) - 基于音量的调制效果
- [Wow Flutter](#wow-flutter) - 加入磁带或唱片式音高摇摆

## Auto Filter

自动移动共振滤波器。LFO 模式会反复扫频，Envelope 模式则跟随音乐音量，产生 Envelope Filter 或 Auto Wah 的声音。

### 音质调整提示

- 若想获得柔和的音色变化，可先选择LFO和Low-pass，使用较低的Resonance，并将Mix设为约30–50%。
- 若想获得Auto Wah效果，可选择Envelope和Band-pass，并调整Sensitivity，使较强的声音能适度打开滤波器。
- 延长Attack可柔化对声音起音的响应；延长Release可使滤波器更平滑地回落。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Auto Filter Sweep**（LFO）、**Stereo Filter Sweep**（LFO）、**Envelope Filter**（Envelope）、**Auto Wah**（Envelope）和**Reverse Auto Wah**（Envelope）。单独修改任一参数后会变为**Custom**。
- **Mode**：在周期性运动的LFO与跟随音量的Envelope之间切换。
- **Filter Type**：选择Low-pass、Band-pass或High-pass。
- **Minimum Frequency / Maximum Frequency**（20–20,000 Hz）：移动范围。若顺序相反会自动重排；若数值相同则保持固定。播放采样率较低时，可用上限也可能降低。
- **Resonance**（Q 0.5–20）：数值越高，对截止频率附近的强调越明显。
- **Mix**（0–100%）：原声与滤波后声音的比例。0%时仅保留原声。
- **Rate**、**Waveform**、**Stereo Phase**：LFO的速度、运动轨迹及每个立体声声道对内的相位差。仅用于LFO模式。
- **Sensitivity**、**Attack**、**Release**、**Direction**：包络的响应量、起音时间、回落时间及移动方向。仅用于Envelope模式。

## Auto Pan

让每个立体声声道对的音量在左右之间移动。若有未配对的声道，该声道会保持在中央。

### 音质调整提示

- 可从约0.2–0.5 Hz的Rate和适中的Depth开始，以获得舒缓的移动感。
- 如果耳机中的移动范围过宽，可降低Width；左右基准位置可用Center调整。
- Sine在两端移动较慢，Triangle则以更均匀的速度移动。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Gentle Auto Pan**、**Wide Auto Pan**和**Fast Auto Pan**。单独修改任一参数后会变为**Custom**。
- **Rate**（0.05–20 Hz）：移动速度。
- **Depth**（0–100%）：相对于Center的移动量。0%时无变化。
- **Center**（-100–100%）：将中心位置向左或向右移动。
- **Width**（0–100%）：使用的立体声宽度。
- **Waveform**：Sine或Triangle。
- **Phase**（0–360°）：周期运动的起始位置。

## Chorus

叠加多份不断变化的延迟声。Mode 可选择 Chorus、Stereo Chorus、Ensemble、Flanger 和 Vibrato；调高 Delay 和 Depth 后，处理声可能会比原声稍晚。

### 音质调整提示

- 若想自然地增加厚度，可使用Classic Chorus或Stereo Chorus，并采用适中的Rate和Depth。
- Ensemble会随Voices增加而变得更密集。Depth过高会使音高摇摆更明显。
- 只有Flanger使用Feedback；正值与负值会改变梳状滤波器的极性。
- Vibrato始终为100%处理声。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Classic Chorus**（Chorus）、**Stereo Chorus**（Stereo Chorus）、**Ensemble**（Ensemble）、**Flanger**（Flanger）、**Jet Flanger**（Flanger）和**Vibrato**（Vibrato）。单独修改任一参数后会变为**Custom**。
- **Mode**：选择Chorus、Stereo Chorus、Ensemble、Flanger或Vibrato。
- **Rate**（0.05–10 Hz）：摇摆速度。
- **Delay**（0.5–30 ms）：处理声的基准延迟。
- **Depth**（0–20 ms）：延迟的变化量。Depth 会自动限制为不高于 Delay。
- **Voices**（1–6）：Chorus和Ensemble中的可变抽头数。在其他模式中忽略。
- **Stereo Spread**（0–100%）：每个立体声声道对内的摇摆偏移。在Chorus模式中忽略。
- **Feedback**（-75–75%）：仅用于Flanger。
- **Mix**（0–100%）：原声与处理声的线性比例。在Vibrato中忽略，并始终为100%处理声。

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

## Frequency Shifter

将每个频率分量移动固定的 Hz 数，而不是按音乐音程移动。Ring Mod 会产生金属感的边带，Barber-pole 则营造持续上升或下降的错觉。该效果会产生随采样率变化的短暂处理延迟，即使 Mix 为 0% 也会保留。

### 音质调整提示

- 若想获得细微变化，可选择Shift并从约±5–15 Hz开始。与Pitch Shifter不同，它也会改变泛音间距。
- 若想获得金属质感，可使用Ring Mod。降低Carrier Frequency更容易保留原声的节奏。
- 若想获得持续移动感，可使用低Rate的Barber-pole，并将Mix保持适中以维持清晰度。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Shift Up**（Shift）、**Shift Down**（Shift）、**Fine Detune**（Shift）、**Ring Modulator**（Ring Mod）、**Barber-pole Up**（Barber-pole）和**Barber-pole Down**（Barber-pole）。单独修改任一参数后会变为**Custom**。
- **Mode**：Shift、Ring Mod或Barber-pole。
- **Shift**（-5,000–5,000 Hz）：Shift模式中的移动量。正值向上移动，负值向下移动。
- **Carrier Frequency**（0.1–10,000 Hz）：Ring Mod的载波频率。
- **Minimum Shift / Maximum Shift**（0–5,000 Hz）：Barber-pole的范围。若顺序相反会自动重排；若数值相同则保持固定。
- **Rate**（0.01–2 Hz）、**Direction**：Barber-pole的速度和方向。
- **Stereo Phase**（0–180°）：在所有模式下，使每个立体声声道对的左右载波或扫频产生相位差。
- **Mix**（0–100%）：等延迟原声与处理声的比例。即使为0%，所述固定延迟仍然存在。

如果较大的Shift产生了不需要的粗糙感或金属感，请降低Shift或Mix。

## Phaser

将原声与经过滤波的副本混合，产生移动的峰与陷波。Classic 往返扫动，Barber-pole 则营造持续上升或下降的感觉。

### 音质调整提示

- 若想获得清晰的陷波，可从Classic、4–6个Stages、适中的Range和约50%的Mix开始。
- 提高Stages和Feedback会让效果更深、更具共振感。如果声音起音被过度着色，可将其降低。
- 用Stereo Phase调整宽度；若需持续运动，可选择Barber-pole Up/Down。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Classic Phaser**（Classic）、**Deep Phaser**（Classic）、**Stereo Phaser**（Classic）、**Barber-pole Up**（Barber-pole）和**Barber-pole Down**（Barber-pole）。单独修改任一参数后会变为**Custom**。
- **Mode**：Classic或Barber-pole。
- **Rate**（0.05–10 Hz）：扫频速度。
- **Center Frequency**（80–8,000 Hz）：对数扫频的中心。
- **Range**（0–6 octaves）：扫频宽度。
- **Stages**（2–12中的偶数）：全通级数。增加时会产生更多陷波。
- **Feedback**（-90–90%）：将处理声反馈至输入的量。绝对值决定强度，符号改变强调方式。
- **Stereo Phase**（0–180°）：每个立体声声道对内的运动偏移。
- **Direction**：Barber-pole的Up/Down方向。在Classic中忽略。
- **Mix**（0–100%）：原声与处理声的线性比例。在中间位置附近抵消最深。

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

## Pitch Shifter HQ

这是一款更注重音质的移调器，适合希望减少相位模糊，且不以低延迟或低CPU占用为首要目标的聆听场景。它在不改变播放速度的情况下调整音高，并比标准Pitch Shifter更好地保持频谱成分之间的联系。相应地，它会占用更多CPU，并带来约106.7–116.1ms的固定处理延迟：在48、96和192kHz下约为106.7ms，在44.1、88.2和176.4kHz下约为116.1ms。它需要EffeTune的WASM DSP引擎；如果该引擎不可用，音频将不经处理直接通过。

Pitch Shifter HQ不保留共振峰。因此，移调幅度较大时，除了音高之外，人声和乐器的音色也会发生变化。

### 聆听体验指南

- 想要轻微改变时，可先将**Pitch Shift**设为-1或+1，并将**Fine Tune**保留在0。
- 音源只略微偏高或偏低、无需移动完整半音时，可用**Fine Tune**进行匹配。
- 如果愿意以更高的CPU占用和延迟换取更少的相位伪影，请选择Pitch Shifter HQ；若对延迟敏感或设备性能有限，请使用标准Pitch Shifter。
- 大幅移调时音高仍会稳定变化，但由于不保留共振峰，音色变化也会更加明显，请边比较边调整。

### 参数

- **Pitch Shift** - 以半音为单位调整整体音高（-6 到 +6）
  - 负值降低音高，正值升高音高
  - 0表示不改变音高
- **Fine Tune** - 以音分为单位调整音高（-50 到 +50）
  - 用于在半音之间进行精确调整
  - 100音分等于1个半音

## Rotary Speaker

将声音分给高频号角和低频鼓轮，并赋予不同的转速。音量移动和短暂的多普勒延迟会产生双转子的标志性旋转感。

### 音质调整提示

- Slow产生舒缓的移动感，Fast带来更强的旋转感。延长Acceleration可让转速变化听起来更自然。
- 用Doppler Depth调整音高运动，用Amplitude Depth调整音量运动。
- 用Rotor Balance调整鼓轮与号角的比例，用Stereo Width调整宽度。

### 参数

- **Style**：一次设置所有参数的完整出厂预设。可选**Rotary Slow**（Slow）、**Rotary Fast**（Fast）、**Gentle Rotary**（Slow）、**Leslie Slow**（Slow）和**Leslie Fast**（Fast）。单独修改任一参数后会变为**Custom**。
- **Speed State**：Stop、Slow或Fast。切换过程中，转子会平滑加速或减速，声音不会中断。
- **Speed**（25–200%）：号角与鼓轮的共同速度倍率。
- **Acceleration**（0.1–10 s）：设置转子接近新转速的快慢。
- **Crossover**（200–2,000 Hz）：分隔鼓轮频段与号角频段的频率。
- **Rotor Balance**（-100–100%）：负值强调鼓轮，正值强调号角。
- **Stereo Width**（0–100%）：立体声声道对的宽度。
- **Doppler Depth**（0–100%）：可变延迟产生的音高变化量。
- **Amplitude Depth**（0–100%）：虚拟转子方向产生的音量变化量。
- **Mix**（0–100%）：原声与旋转声的比例。0%时仅保留原声。

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
