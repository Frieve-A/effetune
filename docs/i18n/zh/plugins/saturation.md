---
title: "Saturation 插件 - EffeTune"
description: "饱和与失真插件,包括 Saturation、Exciter、Hard Clipping 等。"
lang: zh
---

# 饱和插件

一组为音乐添加温暖感和特色的插件。这些效果可以使数字音乐听起来更像模拟设备,并为声音添加令人愉悦的丰富感,类似于复古音频设备为声音添加的色彩。

## 插件列表

- [Bandwidth Extender](#bandwidth-extender) - 在检测或指定的截止频率以上生成高频内容
- [Dynamic Saturation](#dynamic-saturation) - 模拟扬声器音圈的非线性位移
- [Exciter](#exciter) - 增加谐波内容以提高清晰度和存在感
- [Hard Clipping](#hard-clipping) - 为声音添加强度和锐利感
- [Harmonic Distortion](#harmonic-distortion) - 通过可调的 2 阶到 5 阶非线性失真增添特色
- [Multiband Saturation](#multiband-saturation) - 独立塑造低频、中频和高频范围
- [Saturation](#saturation) - 添加类似复古设备的温暖感和丰富感
- [Sub Synth](#sub-synth) - 添加经过滤波的低频信号以增强低频
- [Tube Simulator](#tube-simulator) - 模拟电子管线路级和推挽功率放大器

## Bandwidth Extender

Bandwidth Extender 适用于高频存在明确截止的音频，例如部分低码率 MP3。它会共同分析左右声道，并且只在检测或指定的边界以上添加新内容。它无法还原原始丢失波形；Auto 找不到稳定截止频率时通常不会进行处理。

生成频带由两个可独立调节的部分组成：与输入相关的谐波延伸，以及确定性的整形噪声。原信号保持单位增益，并延迟到与重叠相加处理路径对齐。

### 听感改善指南

- 建议从 **Auto** 以及两个 Amount 的默认值 100% 开始。已知截止频率时可使用 **Manual**。
- 对持续的有调素材可降低 **Noise Amount**；对打击乐或气息类素材可降低 **Harmonic Amount**。素材兼有两类特征时可同时启用并分别调节。
- 请在相同音量下与旁路比较。若只是想让全频带音频更明亮，请使用 Exciter。

### 参数

- **Harmonic Amount**（0-200%，默认 100%）仅控制谐波延伸：0% 移除此部分，100% 是参考电平，200% 将其加倍且不改变噪声或原信号。
- **Noise Amount**（0-200%，默认 100%）仅控制整形噪声：0% 移除此部分，100% 是参考电平，200% 将其加倍且不改变谐波或原信号。
- **Cutoff** 可选择 **Auto**（寻找两个声道共有的陡峭、持续的频谱下降）或 **Manual**。
- **Manual Cutoff**（6000-20000 Hz）设置 Manual 模式下开始生成的频率。

支持 44.1-192 kHz 的单声道和立体声对，并且需要 WebAssembly。约 21 ms 的分析窗会作为延迟报告给宿主，使原信号与生成信号保持时间对齐。

## Dynamic Saturation

一种基于物理原理的效果器，可以模拟不同条件下扬声器音圈的非线性位移。通过建模扬声器的机械行为，然后对该位移应用饱和处理，它创造了一种独特的失真形式，能够动态响应您的音乐。

### 聆听增强指南
- **微妙增强:**
  - 添加柔和的温暖感和轻微的圆化峰值行为
  - 在不产生明显失真的情况下创造自然的"推动音箱"感
  - 为声音添加细微的运动感和深度
- **中等效果:**
  - 创造更具动态性和响应性的失真
  - 为持续音添加独特的运动感和生动感
  - 让瞬态具有会随声音移动的响应感
- **创意效果:**
  - 产生随输入信号演变的复杂失真模式
  - 创造共振的、类似扬声器的行为特性
  - 为实验性聆听创造大胆、会演变的特色

### 参数
- **Speaker Drive** (0.0-10.0) - 控制音频信号推动音圈的强度
  - 低值：轻微运动和温和效果
  - 高值：戏剧性运动和更强特色
- **Speaker Stiffness** (0.0-10.0) - 模拟音圈悬挂系统的刚度
  - 低值：松散、自由运动，衰减时间更长
  - 高值：紧实、受控运动，响应迅速
- **Speaker Damping** (0.1-10.0) - 控制音圈运动的衰减速度
  - 接近 0.1 的低值：延长振动和共振
  - 高值：快速阻尼获得受控声音
- **Speaker Mass** (0.1-5.0) - 模拟音圈惯性
  - 低值：快速、灵敏的运动
  - 高值：较慢、更明显的运动
- **Distortion Drive** (0.0-10.0) - 控制位移饱和的强度
  - 低值：微妙的非线性
  - 高值：强烈的饱和特性
- **Distortion Bias** (-1.0-1.0) - 调整饱和曲线的对称性
  - 零值：对称饱和
  - 正值/负值：通过改变位移哪一侧更强烈地饱和来增加不对称特色
- **Distortion Mix** (0-100%) - 在线性和饱和位移之间混合
  - 低值：更线性的响应
  - 高值：更饱和的特性
- **Cone Motion Mix** (0-100%) - 控制音圈运动对原始声音的影响程度
  - 低值：微妙增强
  - 高值：戏剧性效果
- **Output Gain** (-18.0-18.0dB) - 调整最终输出电平

### 视觉显示
- 实时传输曲线图，显示位移如何被饱和处理
- 清晰的失真特性视觉反馈
- 视觉呈现Distortion Drive和Bias如何影响声音

### 音乐增强技巧
- 微妙温暖感:
  - Speaker Drive: 2.0-3.0
  - Speaker Stiffness: 1.5-2.5
  - Speaker Damping: 0.5-1.5
  - Distortion Drive: 1.0-2.0
  - Cone Motion Mix: 20-40%
  - Distortion Mix: 30-50%

- 动态特性:
  - Speaker Drive: 3.0-5.0
  - Speaker Stiffness: 2.0-4.0
  - Speaker Mass: 0.5-1.5
  - Distortion Drive: 3.0-6.0
  - Distortion Bias: 尝试±0.2获得不对称特性
  - Cone Motion Mix: 40-70%

- 强烈实验效果:
  - Speaker Drive: 6.0-10.0
  - Speaker Stiffness: 尝试极端值（非常低或高）
  - Speaker Mass: 2.0-5.0获得夸张运动效果
  - Distortion Drive: 5.0-10.0
  - 实验Bias值
  - Cone Motion Mix: 70-100%

### 快速入门指南
1. 从中等Speaker Drive (3.0)和Stiffness (2.0)开始
2. 设置Speaker Damping控制共振（1.0获得平衡响应）
3. 根据喜好调整Distortion Drive（中等效果使用3.0）
4. 先将Distortion Bias设为0.0,获得对称饱和
5. 将Distortion Mix和Cone Motion Mix设为50%
6. 调整Speaker Mass改变效果的特性
7. 使用Output Gain微调平衡电平

## Exciter

一个增加谐波内容以提高清晰度和存在感的效果器。通过过滤高频内容并应用饱和处理，它创造了额外的谐波，能够亮化和增强您的音乐。

### 听音增强指南
- **微妙增强：**
  - 为声音和高频细节增加清晰度和空气感
  - 增强整个播放信号的存在感
  - 创造更开放、细节丰富的声音
- **中等效果：**
  - 发掘混音中隐藏的细节
  - 增加亮度和光辉感
  - 使音乐听起来更"Hi-Fi"
- **创意效果：**
  - 创造明亮、切割的音色
  - 增加攻击性存在感
  - 当你想要更明亮、更靠前的声音时很有用,但最好少量使用

### 参数
- **HPF Freq** (500-10000Hz) - 设置高通过滤的截止频率
  - 低值 (500-2000Hz)：影响更多信号
  - 中值 (2000-5000Hz)：针对存在感频率
  - 高值 (5000-10000Hz)：专注于空气感和光辉感
- **HPF Slope** - 控制过滤器的陡峪程度
  - Off：无过滤，处理全频谱
  - 6dB/oct：柔和过滤
  - 12dB/oct：更陡峪的过滤
- **Drive** (0.0-10.0) - 控制饱和强度
  - 轻度 (0.0-3.0)：微妙谐波增强
  - 中等 (3.0-6.0)：明显亮度
  - 高度 (6.0-10.0)：强烈激励
- **Bias** (-0.3到0.3) - 调整饱和不对称性
  - 零值：对称饱和
  - 正值/负值：通过改变所生成增强信号哪一侧更强烈地饱和来增加不对称特色
- **Mix** (0-100%) - 控制所生成谐波增强加入原始声音的量
  - 低 (0-30%)：细微增加亮度
  - 中 (30-60%)：更清晰的存在感和细节
  - 高 (60-100%)：强烈增加谐波;请谨慎使用以免刺耳

### 视觉显示
- 高通过滤器频率响应图
- 饱和传输曲线可视化
- 过滤器和饱和处理的清晰视觉反馈

### 音乐增强技巧
- 歌曲、播客或视频中的声音更清晰：
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05到0.1
  - Mix: 20-40%

- 繁忙录音中的中高频细节更清楚：
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- 细微的整轨亮度：
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0到0.1
  - Mix: 10-25%

### 快速入门指南
1. 设置HPF Freq针对期望的频率范围
2. 选择HPF Slope（从6dB/oct开始）
3. 从中等Drive（3.0）开始
4. 将 Bias 设在 0.1 附近，带来略微不对称的质感
5. 将Mix设为25%并根据喜好调整
6. 在听音时对所有参数进行微调

## Hard Clipping

一个数字削波效果器,会限制超过设定阈值的峰值。想增加边缘感、密度或创意失真时可以使用;若只需轻微峰值控制,请保持较高 Threshold,再逐步降低以得到更强特色。

### 聆听增强指南
- 细微增强:
  - Threshold 保持较高时,可加入一点边缘感和密度
  - 轻度使用时可修剪尖锐峰值
  - 因削波过度会变刺耳,请与旁路状态比较
- 适度效果:
  - 创造更有活力的声音
  - 为节奏元素添加兴奋感
  - 使音乐感觉更有"驱动力"
- 创意效果:
  - 创造戏剧性的声音转换
  - 为音乐添加激进的特色
  - 完美适合实验性聆听

### 参数
- **Threshold** - 控制受影响的声音量(-60dB 到 0dB)
  - 较高值(-6dB 到 0dB):轻度峰值控制或细微边缘感
  - 中等值(-24dB 到 -6dB):明显削波特色和密度
  - 较低值(-60dB 到 -24dB):重度失真和戏剧性效果
- **Mode** - 选择影响声音的哪些部分
  - Both Sides:对正负峰值进行对称削波,最容易预测
  - Positive Only:只削正峰值,产生不对称削波和不同音色
  - Negative Only:只削负峰值,产生与 Positive Only 不同感受的不对称削波

### 视觉显示
- 显示声音如何被塑造的实时图表
- 调整设置时的清晰视觉反馈
- 帮助指导调整的参考线

### 聆听技巧
- 获得细微增强:
  1. 从 Threshold 0dB 开始
  2. 使用"Both Sides"模式
  3. 逐步降低到 -3dB 到 -6dB,在效果刚能听出时停止
- 获得创意效果:
  1. 逐渐降低阈值
  2. 尝试不同模式
  3. 与其他效果组合创造独特声音

## Harmonic Distortion

Harmonic Distortion 插件使用可调的 2 阶到 5 阶非线性项塑造波形。它可以调节偶次和奇次失真的特色,从细微温暖到更强烈的染色都能覆盖,让过于干净、单薄或平淡的音乐听起来更鲜活。

### 聆听增强指南
- **细微效果:**
  - 增添柔和的谐波温暖层
  - 提升自然音色而不掩盖原始信号
  - 适合增加模拟风格的微妙深度
- **中等效果:**
  - 加入更明显的谐波特色
  - 可为整段录音增加厚度、亮度或边缘感
  - 当声音过于平面或克制时很有用
- **强烈效果:**
  - 强化多个非线性项,产生丰富复杂的失真
  - 为实验性聆听创造大胆质感
  - 推得很重时可能变得锐利或非常规
- **正值与负值对比:**
  - 正值和负值会翻转每个非线性项的方向
  - 偶次项主要改变不对称性和音色
  - 奇次项主要改变对称失真的特色

### 参数
- **2nd Harm (%):** 设置二阶失真项（-30 至 30%，默认值：2%）
- **3rd Harm (%):** 设置三阶失真项（-30 至 30%，默认值：3%）
- **4th Harm (%):** 设置四阶失真项（-30 至 30%，默认值：0.5%）
- **5th Harm (%):** 设置五阶失真项（-30 至 30%，默认值：0.3%）
- **Sensitivity (x):** 调整整体输入灵敏度（0.1-2.0，默认值：0.5）
  - 较低的灵敏度提供含蓄的效果
  - 较高的灵敏度增加失真强度
  - 作为影响非线性塑形强度的全局控制

### 视觉显示
- 传输曲线显示输入电平如何被塑造成输出电平
- 直观的滑块和输入框，提供即时反馈
- 图表会随谐波和灵敏度设置变化

### 快速入门指南
1. **初始化：** 使用默认设置开始（2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5）
2. **调整参数：** 一次改变一两个 Harm 控制,边听边注意刺耳感或清晰度损失
3. **混合你的音色：** 使用 Sensitivity 调整平衡，实现微妙的温暖感或明显的失真效果

## Multiband Saturation

一个多功能效果器,可为整个播放信号的特定频率范围添加温暖感和特色。通过将声音分为低、中、高频段,你可以独立塑造每个范围,实现精确的声音增强。

### 聆听增强指南
- 低频增强:
  - 为低频添加温暖感和冲击力
  - 为整个播放信号的低频范围增加饱满度和轻微冲击力
  - 创造更饱满、更丰富的低端
- 中频塑造:
  - 为很多声音和乐器所在的中频增加主体感和定义
  - 帮助繁忙录音听起来更清楚
  - 创造更清晰、更定义的声音
- 高频甜化:
  - 为高频范围增加闪亮感
  - 增强空气感和明亮度
  - 创造清脆、细腻的高频

由于它按频段处理,所选范围内的所有声音都会受到影响,并不能只作用于单独的乐器或人声。

### 参数
- **分频点频率**
  - Freq 1 (20Hz-2kHz): 设置低频段结束和中频段开始的位置
  - Freq 2 (200Hz-20kHz, 始终保持在 Freq 1 或以上): 设置中频段结束和高频段开始的位置
  - 如果 Freq 2 设置得低于 Freq 1,它会自动提高以保持低-中-高频段顺序
- **频段控制** (适用于低、中、高每个频段):
  - **Drive** (0.0-10.0): 控制饱和度强度
    - 轻微(0.0-3.0): 细微增强
    - 中等(3.0-6.0): 明显温暖感
    - 强烈(6.0-10.0): 强烈特色
  - **Bias** (-0.3 到 0.3): 调整饱和曲线的对称性
    - 零: 对称饱和
    - 正值/负值: 通过改变波形哪一侧更强烈地饱和来增加不对称特色
  - **Mix** (0-100%): 混合效果与原声
    - 低(0-30%): 细微增强
    - 中(30-70%): 平衡效果
    - 高(70-100%): 强烈特色
  - **Gain** (-18dB 到 +18dB): 调整频段音量
    - 用于平衡各频段之间的关系
    - 补偿任何音量变化

### 视觉显示
- 交互式频段选择标签
- 每个频段的实时传输曲线图
- 调整设置时的清晰视觉反馈

### 音乐增强技巧
- 整体混音增强:
  1. 所有频段从温和Drive开始(2.0-3.0)
  2. 保持Bias在0.0获得自然饱和
  3. 设置Mix在40-50%获得自然混合
  4. 微调每个频段的Gain

- 低频增强:
  1. 专注于低频段
  2. 使用中等Drive(3.0-5.0)
  3. 保持Bias中性获得一致响应
  4. 保持Mix在50-70%

- 人声增强:
  1. 专注于中频段
  2. 使用轻微Drive(1.0-3.0)
  3. 保持Bias在0.0获得自然声音
  4. 根据喜好调整Mix(30-50%)

- 添加亮度:
  1. 专注于高频段
  2. 使用温和Drive(1.0-2.0)
  3. 保持Bias中性获得清晰饱和
  4. 保持Mix适度(20-40%)

### 快速入门指南
1. 设置分频点频率分割声音
2. 所有频段从低Drive值开始
3. 初始保持Bias在0.0
4. 使用Mix自然混合效果
5. 用Gain控制微调
6. 相信您的耳朵并调整到满意!

## Saturation

一个模拟复古电子管设备温暖、令人愉悦声音的效果器。它可以为您的音乐添加丰富感和特色,使其听起来更"模拟"而不是"数字"。

### 聆听增强指南
- 添加温暖感:
  - 使数字音乐听起来更自然
  - 为声音添加令人愉悦的丰富感
  - 完美适合爵士乐和原声音乐
- 丰富特色:
  - 创造更"复古"的声音
  - 添加深度和维度
  - 非常适合摇滚和电子音乐
- 强烈效果:
  - 戏剧性地转换声音
  - 创造大胆、富有特色的音色
  - 理想用于实验性聆听

### 参数
- **Drive** - 控制温暖感和特色的量(0.0 到 10.0)
  - 轻微(0.0-3.0):细微的模拟温暖感
  - 中等(3.0-6.0):丰富的复古特色
  - 强烈(6.0-10.0):大胆的戏剧性效果
- **Bias** - 调整饱和曲线的对称性(-0.3 到 0.3)
  - 0.0:对称饱和
  - 正值:使波形负半周更突出
  - 负值:使波形正半周更突出
- **Mix** - 平衡效果与原始声音(0% 到 100%)
  - 0-30%:细微增强
  - 30-70%:平衡效果
  - 70-100%:强烈特色
- **Gain** - 调整整体音量(-18dB 到 +18dB)
  - 如果效果太响亮使用负值
  - 如果效果太安静使用正值

### 视觉显示
- 清晰图表显示声音如何被塑造
- 实时视觉反馈
- 易读控制界面

### 音乐增强技巧
- 古典乐 & 爵士乐:
  - 轻微Drive(1.0-2.0)获得自然温暖感
  - 保持Bias在0.0获得清晰饱和
  - 低Mix(20-40%)获得细微效果
- 摇滚乐 & 流行乐:
  - 中等Drive(3.0-5.0)获得丰富特色
  - 保持Bias中性获得一致响应
  - 中等Mix(40-60%)获得平衡
- 电子音乐:
  - 较高Drive(4.0-7.0)获得大胆效果
  - 尝试不同Bias值
  - 较高Mix(60-80%)获得鲜明特色

### 快速入门指南
1. 从低Drive开始获得温和温暖感
2. 先将Bias设为0.0,获得对称饱和
3. 调整Mix平衡效果
4. 如需合适音量调整Gain
5. 尝试和相信您的耳朵!

## Sub Synth

一种专门通过混入从原始音频派生并经过滤波的低频信号来增强低频的效果器。当低频偏薄的音乐需要更多温暖、饱满度或适合耳机的冲击力时很有用。

### 聆听增强指南
- 低频增强:
  - 为薄弱录音添加深度和力量
  - 创造更饱满、更丰富的低端
  - 完美适合耳机聆听
- 频率控制:
  - 控制保留哪一段新增低频
  - 独立滤波获得干净低频
  - 在添加力量的同时保持清晰度

### 参数
- **Sub Level** - 控制新增低频信号电平(0-200%)
  - 轻微(0-50%):细微低频增强
  - 中等(50-100%):平衡低频提升
  - 强烈(100-200%):戏剧性低频效果
- **Dry Level** - 调整原始信号电平(0-200%)
  - 用于与新增低频信号平衡
  - 保持原始声音清晰度
- **Sub LPF** - 新增低频信号的低通滤波器(5-400Hz)
  - 频率:控制新增低频信号上限
  - 斜率:调整滤波器陡度(Off到-24dB/oct)
- **Sub HPF** - 新增低频信号的高通滤波器(5-400Hz)
  - 频率:去除新增低频信号中不需要的隆隆声
  - 斜率:控制滤波器陡度(Off到-24dB/oct)
- **Dry HPF** - 原始信号的高通滤波器(5-400Hz)
  - 频率:防止低频堆积
  - 斜率:调整滤波器陡度(Off到-24dB/oct)

### 视觉显示
- 交互式频率响应图
- 清晰的滤波器曲线可视化
- 实时视觉反馈

### 音乐增强技巧
- 一般低频增强:
  1. 从50%的Sub Level开始
  2. 设置Sub LPF在100Hz左右(-12dB/oct)
  3. 保持Sub HPF在20Hz(-6dB/oct)
  4. 根据喜好调整Dry Level

- 干净低频提升:
  1. 将Sub Level设为70-100%
  2. 使用80Hz的Sub LPF(-18dB/oct)
  3. 设置Sub HPF为30Hz(-12dB/oct)
  4. 将Dry HPF设为40Hz(-6dB/oct)

- 最大冲击力:
  1. 增加Sub Level至150%
  2. 设置Sub LPF为120Hz(-24dB/oct)
  3. 保持Sub HPF在15Hz(-6dB/oct)
  4. 用Dry Level平衡

### 快速入门指南
1. 从适中的Sub Level(50-70%)开始
2. 设置Sub LPF在100Hz左右
3. 在20Hz左右启用Sub HPF(-6dB/oct)
4. 调整Dry Level获得平衡
5. 根据喜好微调滤波器
6. 相信您的耳朵并逐步调整!

## Tube Simulator

Tube Simulator 使用真实的电子管电路元件参数模拟完整电气信号链。**Line** 只使用两级小信号电子管放大器；**Push-Pull Power** 则把同一驱动器经过一个固定音量送入按实管差分对求解的 12AX7 倒相级，再送入一对 EL84、EL34、6L6GC 或 KT88 输出管、输出变压器和频率相关的扬声器负载。偏置、B+、变压器和负载状态会随信号实时求解，使谐波、压缩、电源下垂和电气阻尼随音乐变化。扬声器负载模拟的是放大器看到的电气负载，不是箱体或麦克风模拟。

在 Driver Type 中选择 **Bypass** 会跳过共用的两级驱动器。Push-Pull Power 仍保留必需的倒相级和输出管；SE Triode 则直接驱动所选输出管。

**SE Triode** 不使用倒相级或帘栅电源，而由单只 300B 或 2A3 驱动带气隙的单端输出变压器。建议从预设的 3dB Negative Feedback 开始；轻度反馈通常在 0–6dB 范围内调节。

### 聆听调整指南

- 插件启动时采用 **EL84 Pentode @2%**，包括已完成电平匹配的 Output Trim -7.372dB。
- 如果饱和过强，请降低 Input Volume 以减少进入电路的电压，再用 Output Trim 恢复听感音量。Output Trim 不会恢复电路内部余量。
- 若要获得透明的线路级染色，请选择 **Pre** 中的 **0.01%** 或 **0.1%** 预设；需要更明显的谐波时，可继续使用现有的 **@1%** 选项。
- **Pre** 组用于单独的两级驱动器，**Power** 组用于 Driver Type 设为 Bypass 的功率级，**Pre+Power** 组用于完整的驱动器和功率级信号链。所有可选预设都已校准到适合聆听的失真率和相同的播放电平。
- 请从 **EL84 Distributed 10 W @2%** 开始体验较克制的功放响应。与 **EL84 Pentode 10 W @2%** 切换比较，可在保持管型不变时听出帘栅连接和变压器负载的影响。
- 要体验更高电压的 EL34 电路，请选择 **EL34 Distributed 20–37 W @2%**。其电平已与其他 Power 和 Pre+Power 设置匹配。
- 请选择 **6L6GC Pentode @2%** 体验较低跨导的束射四极管电路，或选择 **KT88 Distributed @2%** 体验电流更大、帘栅抽头为 43% 的 KT88 模型。
- 请选择 **300B SE @2%** 和 **2A3 SE @2%** 比较两个完整的单端电路。由于只有一只输出管，它们不会像平衡 push-pull 管对那样抵消偶次谐波。
- 在 SE Triode 模式下，请从预设的 3dB Negative Feedback 开始。轻度反馈通常适用的范围是 0–6dB：0dB 会打开反馈环路，6dB 则能让响应更受控，同时不会使其变成高反馈设计。
- 降低 Negative Feedback 会保留更多开环谐波和电平变化；提高则使闭环响应更受控。如果极端组合触发安全旁路，请恢复预设。
- 如果只想轻微加入电子管响应，请降低 Wet/Dry Mix。

### 面板布局

24 个参数分布在 **Preset** 下拉菜单下方的五个标签页中。

- **Input** - Input Volume、Input Reference、Source Z
- **Driver** - Driver Type、Bias、Plate、Supply、Negative Feedback
- **Power** - Output Circuit；Push-Pull Power 的 Power Tubes、Output B+ 和 Cathode Resistor；单端电路的 SE Triode、SE B+ 和 SE Cathode Resistor
- **Transformer** - Screen Tap、Push-Pull Primary、SE Primary、Assumed Speaker Load、Actual Speaker Load
- **Output** - Output Trim、Output Safety Trim、Auto Gain Reduction、Wet/Dry Mix

Preset 下拉菜单以 **Custom** 开头，其后是 **Pre**、**Power** 和 **Pre+Power** 三组。Pre 包含 Line 设置，Power 包含 Driver Type 设为 Bypass 的功率级设置，Pre+Power 包含完整的驱动器与功率级信号链。当前设置与任何预设都不匹配时会显示 Custom；输出保护设置 (Output Safety Trim 和 Auto Gain Reduction) 不参与该比较。Power 和 Transformer 标签页只显示所选 Output Circuit 使用的控件。Line 会隐藏全部功率输出控件，Push-Pull Power 会隐藏四个 SE 专用控件，SE Triode 会隐藏五个 Push-Pull Power 专用控件。隐藏控件的值会保留，并在下次选择相应电路时继续使用。

### 电路预设与默认值

启动时，所有电路、驱动、负载和输出参数都与 **EL84 Pentode @2%** 一致，因此 Preset 菜单会直接显示该项。此后，改动参与预设匹配的电路、驱动或输出参数会显示 Custom；Output Safety Trim 和 Auto Gain Reduction 不参与匹配，因此改变任一保护设置都不会改变预设选择。

| Circuit Preset | Output Circuit | 驱动管 / 输出管 | Negative Feedback | 功率级设置 | 输入 / 输出 |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | 保留功率控件的值，但隐藏控件 | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V，Cathode Resistor 270 Ω / valve，Screen Tap 0%，Transformer Primary 8.0 kΩ，Assumed Speaker Load 15 Ω | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim -19.675dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V，Cathode Resistor 270 Ω / valve，Screen Tap 20%，Transformer Primary 6.6 kΩ，Assumed Speaker Load 15 Ω | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim -17.331dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V，Cathode Resistor 470 Ω / valve，Screen Tap 43%，Transformer Primary 6.6 kΩ，Assumed Speaker Load 8 Ω | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim -17.230dB |
| 6L6GC Pentode | Push-Pull Power | 12AX7 / 6L6GC ×2 | 3dB | Output B+ 391.454 V，Cathode Resistor 483.871 Ω / valve，Screen Tap 0%，Transformer Primary 6.6 kΩ，Assumed Speaker Load 8 Ω | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim -15.267dB |
| KT88 Distributed | Push-Pull Power | 12AX7 / KT88 ×2 | 4dB | Output B+ 379.290 V，Cathode Resistor 400 Ω / valve，Screen Tap 43%，Transformer Primary 6.0 kΩ，Assumed Speaker Load 8 Ω | Input Volume 0dB，Input Reference 2.828 Vpk，Output Trim -16.166dB |
| 300B Single-Ended | SE Triode | 12AU7 / 300B | 3dB | SE B+ 400 V，SE Cathode Resistor 1000 Ω，SE Primary 3.5 kΩ，Assumed Speaker Load 8 Ω | Input Volume -42dB，Input Reference 2.828 Vpk，Output Trim +38.795dB |
| 2A3 Single-Ended | SE Triode | 12AU7 / 2A3 | 3dB | SE B+ 300 V，SE Cathode Resistor 750 Ω，SE Primary 2.5 kΩ，Assumed Speaker Load 8 Ω | Input Volume -42dB，Input Reference 2.828 Vpk，Output Trim +37.461dB |

八个预设均使用 Bias 0%、Plate 250 V、Source Z 10 kΩ、Supply 10 kΩ 和 Wet/Dry Mix 100%。每个预设还会把 Actual Speaker Load 设为其 Assumed Speaker Load，因此都从电路的设计点开始。

新增的 Power 设计会明确区分公开电路数据与为适配插件控件而作的投影。6L6GC 预设遵循 [Ei-RC 6L6GC 数据](https://frank.pocnet.net/sheets/084/6/6L6GC.pdf)中以阴极为参考的推挽 AB1 工作点；其阴极电阻用于在直流上等效该固定偏置工作点。KT88 电流模型遵循 [GEC KT88 数据](https://keith-snook.info/valve-data/KT88%20GEC%20Data.pdf)中的阴极偏置超线性工作点，并将资料中的 40% 抽头和 5 kΩ 负载投影到可选的 43% 与 6.0 kΩ 控件。初级绕组电阻和小信号电感采用 [Monolith B-8/6K6](https://www.monolithmagnetics.com/sites/default/files/datasheets/Push-Pull-output-transformers/datasheet%20B-8%206K6%20300B%20push%20pull%20output%20tube%20amplifier%20transformer%20prelim.pdf)及 [B-8/8k](https://www.monolithmagnetics.com/sites/default/files/B-8_8k_0.pdf)的测量值。其余变压器损耗、谐振、反馈和电源系数仍是明确的模型参数，不会被表述为这些变压器的实测值。

### 已校准预设

全部35个可选设置使用与Pipeline Analyzer默认值共用的可复现校准点。在设计扬声器负载下稳定三秒后，关闭Auto Gain Reduction，以96 kHz、1 kHz、峰值-12dBFS（RMS -15.01dBFS）的正弦波测量THD和播放电平。选择该电平是为了提供一个实用参考，用于近似一般商业母带音乐从平均到响亮的主体部分，而不把偶尔接近满刻度的峰值当作正常工作状态。它不是响度标准，也不保证真实音乐具有相同THD。表中的Measured THD仅适用于稳定后的正弦波；音乐的瞬时THD会随波形、峰值因数、频谱、瞬时电平和电路状态而变化。Input Volume和Input Reference设定正弦波失真点，再用同一参考调整Output Trim，使交流RMS增益达到0dB。为保证稳定性，Power-only KT88使用2dB Negative Feedback；对应的Pre+Power电路保留4dB。

| 组 | Preset | Input Volume | Input Reference | Output Trim | Measured THD |
| --- | --- | ---: | ---: | ---: | ---: |
| Pre | Line 12AT7 @0.01% | -13.7480dB | 2.828 Vpk | +0.619dB | 0.0100% |
| Pre | Line 12AT7 @0.1% | 0dB | 4.5552 Vpk | -17.268dB | 0.1000% |
| Pre | Line 12AX7 @0.01% | -24.2637dB | 2.828 Vpk | +8.508dB | 0.0100% |
| Pre | Line 12AX7 @0.1% | -4.4922dB | 2.828 Vpk | -11.264dB | 0.1000% |
| Pre | Line 12AU7 Open-Loop @0.1% | -19.2715dB | 2.828 Vpk | +28.495dB | 0.1000% |
| Pre | Line 12AT7 @1% | 0dB | 7.3556 Vpk | -21.421dB | 0.9974% |
| Pre | Line 12AX7 @1% | 0dB | 6.7213 Vpk | -23.276dB | 1.0003% |
| Pre | Line 12AU7 Open-Loop @1% | -9.2656dB | 2.828 Vpk | +18.592dB | 1.0002% |
| Power | EL84 Pentode 10 W @0.1% | -26.5957dB | 2.828 Vpk | +8.696dB | 0.1001% |
| Power | EL84 Distributed 10 W @0.1% | -21.7676dB | 2.828 Vpk | +7.363dB | 0.1002% |
| Power | EL34 Distributed 20–37 W @0.1% | -8.1543dB | 2.828 Vpk | +3.767dB | 0.1000% |
| Power | 6L6GC Pentode @0.1% | -19.3047dB | 2.828 Vpk | +12.251dB | 0.1003% |
| Power | KT88 Distributed @0.1% | 0dB | 3.1263 Vpk | -3.485dB | 0.1002% |
| Power | 300B SE @0.1% | 0dB | 35.4586 Vpk | +16.582dB | 0.1000% |
| Power | 300B SE @1% | 0dB | 295.9454 Vpk | -1.794dB | 1.0000% |
| Power | 2A3 SE @0.1% | 0dB | 18.1347 Vpk | +21.072dB | 0.1000% |
| Power | 2A3 SE @1% | 0dB | 167.2455 Vpk | +1.816dB | 1.0000% |
| Power | EL84 Pentode 10 W @2% | -9.7148dB | 2.828 Vpk | -7.483dB | 1.9995% |
| Power | EL84 Distributed 10 W @2% | -6.5352dB | 2.828 Vpk | -7.322dB | 2.0005% |
| Power | EL34 Distributed 20–37 W @2% | 0dB | 5.2781 Vpk | -9.510dB | 1.9995% |
| Power | 6L6GC Pentode @2% | 0dB | 3.3694 Vpk | -7.187dB | 2.0004% |
| Power | KT88 Distributed @2% | 0dB | 7.4992 Vpk | -10.748dB | 1.9970% |
| Pre+Power | EL84 Distributed @0.1% | -58.4629dB | 2.828 Vpk | +9.910dB | 0.1000% |
| Pre+Power | EL34 Distributed @0.1% | -56.4629dB | 2.828 Vpk | +17.947dB | 0.1000% |
| Pre+Power | 6L6GC Pentode @0.1% | -58.4551dB | 2.828 Vpk | +17.255dB | 0.1000% |
| Pre+Power | KT88 Distributed @0.1% | -56.4629dB | 2.828 Vpk | +21.698dB | 0.1000% |
| Pre+Power | 300B SE @0.1% | -15.2227dB | 2.828 Vpk | +12.027dB | 0.1000% |
| Pre+Power | 2A3 SE @0.1% | -23.2598dB | 2.828 Vpk | +18.722dB | 0.1000% |
| Pre+Power | EL84 Pentode @2% | -44.0059dB | 2.828 Vpk | -7.372dB | 2.0004% |
| Pre+Power | EL84 Distributed @2% | -40.9746dB | 2.828 Vpk | -7.091dB | 2.0005% |
| Pre+Power | EL34 Distributed @2% | -31.6797dB | 2.828 Vpk | -6.779dB | 2.0000% |
| Pre+Power | 6L6GC Pentode @2% | -35.2070dB | 2.828 Vpk | -5.145dB | 1.9998% |
| Pre+Power | KT88 Distributed @2% | -31.5391dB | 2.828 Vpk | -3.147dB | 1.9997% |
| Pre+Power | 300B SE @2% | -2.4824dB | 2.828 Vpk | -0.439dB | 2.0000% |
| Pre+Power | 2A3 SE @2% | -4.2266dB | 2.828 Vpk | -0.093dB | 2.0002% |

Line 12AU7 Open-Loop的0.01%工作点需要约+48.5dB的Output Trim才能匹配电平，略高于当前+48dB上限，因此该电路只提供0.1%和1%预设。完整的EL84 Pentode Pre+Power通路在实用测量范围内无法低于0.3055%，所以不提供Pre+Power @0.1%预设。Input Reference上限已扩展到300 Vpk，使Driver Type设为Bypass的300B和2A3 SE电路无需改变电路设计即可校准到0.1%和1%。旧的不可选SE兼容记录仍固定为20 Vpk，新预设则使用独立的校准记录。

### 参数
- **Preset** - 加载 Pre、Power 或 Pre+Power 设置
- **Input Volume** (-96 至 0dB) - 在所选有效信号路径之前衰减经过校准的输入
  - 0dB 表示完全打开；降低该值会减小内部驱动并增加余量
- **Driver Type** (12AX7、12AT7、12AU7 或 Bypass) - 选择两级驱动管，或将该驱动器移出信号链
  - 12AX7 的电压增益最高，12AT7 居中，12AU7 的增益最低而余量最大
  - 在 Push-Pull Power 中，它驱动固定的 12AX7 倒相级；在 SE Triode 中，它直接驱动所选输出三极管
  - Bypass 用于 Power 预设。Push-Pull Power 仍保留倒相级；SE Triode 不经过共用驱动器而直接馈入输出三极管。Line 与 Bypass 组合时是延迟对齐的直通路径，Negative Feedback 在其中不起作用
- **Bias** (-50 至 +50%) - 移动阴极偏置工作点
  - 提高该值会减小模型中的阴极电阻，使各级工作在更大的电流下
  - 降低该值会增大阴极电阻，使各级工作在更小的电流下
- **Plate** (150 至 300V) - 设置模型中的阳极电源电压
  - 提高该值通常会增加电压余量，使响应更加稳定
  - 降低该值会使压缩与非线性行为更早出现
- **Source Z** (0.6 至 100kΩ) - 设置驱动第一级的信号源阻抗
  - 提高该值会增强与模拟输入电容的相互作用，使高频和瞬态驱动更柔和
  - 降低该值会更有力地驱动输入，并保留更多高频能量
- **Supply** (0.1 至 47kΩ) - 设置 B+ 电源电阻
  - 提高该值会使各级消耗电流时的 B+ 降幅增大，电源下垂更加明显
  - 降低该值会使电源更稳定，电压波动更小
- **Negative Feedback** (0 至 30dB) - 设置校准的全局负反馈量
  - Line 取自第二级阳极；Push-Pull Power 取自变压器的固定次级反馈绕组
  - 提高通常减少开环增益和失真并收紧响应；0dB 打开反馈环
  - 扬声器负载的电气阻尼正是由这个反馈环产生的，因此提高该值也会加强放大器对负载的控制力
- **Output Trim** (-48 至 +48dB) - 在模拟电路之后进行数字电平校准
  - 它只改变处理后信号的电平，不会增加电子管级的内部余量
- **Output Safety Trim** (-96 至 0dB) - 在模拟电路之后施加一个与 Output Trim 相互独立的线性电平调整，供输出电平保护专用
  - Auto Gain Reduction 只会降低该调整量，绝不会写入 Output Trim
  - 滑块及其数值框显示的是有效调整量，即您设定的值减去当前施加的自动衰减；存储的设定值是您最后一次自己设定的值，保存的也是它
  - 抓住滑块时，当前显示的有效值即成为您的设定值，因此电平不会跳变，累积的衰减也在此时清除
- **Auto Gain Reduction** (默认开启) - 允许输出电平保护自行降低 Output Safety Trim
  - 关闭后不再累积新的衰减，已经施加的衰减保持不变
- **Wet/Dry Mix** (0 至 100%) - 混合已经时间对齐的原始信号和处理信号
  - 较低的值会保留更多原始信号；较高的值会突出电子管模型的响应
  - 即使为 0%，原声路径仍延迟 64 samples，以保持时间对齐
- **Input Reference** (0.100 至 300.000 Vpk) - 设置数字 0dBFS 峰值所代表的输入端峰值电压
  - 2.828 Vpk 对应满幅正弦波的 2 Vrms；5.657 Vpk 对应 4 Vrms
  - 有效信号路径接收 Input Reference 与 Input Volume 相乘后的电压；这是物理输入校准，并非额外的输出增益控制
- **Output Circuit** (Line、Push-Pull Power 或 SE Triode) - 选择电路拓扑；SE Triode 加入单只 300B 或 2A3 与带气隙变压器
  - Line 在两级驱动器后结束，不运行功率管、变压器或扬声器负载；Power 模式加入倒相级和完整功率输出电路
- **Power Tubes** (EL84 ×2、EL34 ×2、6L6GC ×2 或 KT88 ×2) - 选择输出管电流模型及配套元件；仅影响 Power 模式
  - 四种模型在阳极、帘栅和控制栅电压上均依据实际输出管数据，包括栅压足够负时的完全截止
- **Output B+** (300 至 470 V) - 设置功率级电源；提高会增大可用电压摆幅和管耗
- **Cathode Resistor** (270 至 500 Ω / valve) - 每支输出管的独立阴极偏置电阻；提高会减小静态电流，降低会增大
- **Screen Tap** (0%、20% 或 43%) - 选择帘栅连接。0% 使用固定帘栅电源；20% 和 43% 连至对应的变压器初级抽头，实现分布负载（超线性）
  - 抽头即匝数比，因此帘栅跟随初级绕组磁通耦合中相应的那一份
- **SE Triode** (300B 或 2A3) - 选择单端输出管
- **SE B+** (250–450 V) - 设置单端输出级电源
- **SE Cathode Resistor** (700–1300 Ω) - 设置输出管阴极偏置电阻
- **Push-Pull Primary** (6.0、6.6 或 8.0 kΩ) - 选择推挽变压器的阳极间初级阻抗
- **SE Primary** (2.5、3.5 或 5.0 kΩ) - 选择带气隙单端变压器的初级阻抗
- **Assumed Speaker Load** (4、8、15 或 16 Ω) - 选择变压器次级抽头以及电路所依据的标称扬声器阻抗。每个选项都是频率相关的 RLC 电气负载，会影响变压器负载和反馈
- **Actual Speaker Load** (2 至 32 Ω) - 设置实际接在该抽头上的扬声器阻抗
  - 负载网络按其与 Assumed Speaker Load 之比缩放，因此谐振频率和 Q 值保持不变，只有阻抗水平改变
  - 匝数比仍取自 Assumed Speaker Load，因此两者不一致时反射到输出管的阻抗会改变，阻尼、可用功率和驱动状态随之变化；两者相同时电路工作在设计点

### 输出电平保护

载入任一预设时都会应用其校准后的Output Trim，因此35个可选预设在上述参考条件下均已匹配电平。手动更改Driver Type、Output Circuit或其他参数时，Output Trim不会自动补偿，因此可能出现较大的电平跳变。Output Safety Trim和Auto Gain Reduction可保护接在输出端的设备免受此类跳变的影响。

- 每当输出采样的幅度超过 0 dBFS 峰值时，Output Safety Trim 会立即按该采样超出的量精确降低。由于逐采样检查，因此没有检测窗口，也不做平均。该阈值是固定的策略值。
- 衰减通过 20 ms 的单向斜坡施加，因此电平变化不会出现台阶。
- 它只会衰减，绝不恢复。没有释放也没有回升，因此既不是限制器，也不是自动电平调整器。
- 滑块及其数值框显示的是有效调整量，即您的设定值减去当前施加的衰减量。存储的设定值仍是您最后一次自己设定的值，保存的也是它。
- 当您自己抓住 Output Safety Trim 时，累积的衰减会被清除。此时显示的有效值即成为您的设定值，因此电平不会跳变。
- 载入预设会把 Output Safety Trim 恢复为 0dB。累积的衰减会在该调整值本身发生变化、或一次提交同时改变两个及以上的值时被清除，通常的预设载入即属于后者；只改动一个控件后再次选择电路当前所在的预设，只会改变那一个值，因此衰减会被保留。
- 关闭 Auto Gain Reduction 后不再累积新的衰减，已经施加的衰减保持不变。
- 当前衰减量会显示在图表下方的状态行中，即使为 0.0 dB 也会显示。
- 该机制位于放大器模型之外。电路求解、谐波、压缩和电源下垂均不改变；改变的只是输出电平，过载的音质特征不受影响。它抑制的是输出端的数字满刻度溢出，而不是模型产生的失真。

### 安全旁路与恢复

- 如果检测到反馈振荡，湿声电路会渐变到延迟对齐的干声路径，并锁定安全旁路。降低 Negative Feedback、选择可用预设或改变其他电路参数后，新设置会在保持干声时试运行；若稳定，则平滑恢复处理声，否则继续旁路。
- 如果遇到其他处理安全故障，插件会切换到安全干声输出。请恢复默认电路设置，然后重新加载效果。
- 不支持的采样率或声道模式、WebAssembly 不可用或处理引擎停止时也会旁路。HUD 下方的状态会说明处理方法。

### HUD 读取方法
- **Input Reference (0 dBFS)** 以 Vpk、正弦波 Vrms 和 **dBuFS** 显示输入端校准值。**Stage 1 External Input (0 dBFS)** 显示经过 Input Volume 后的峰值电压
- **Stage 1 Bias**、**Stage 2 Bias**、**B+** 和 **Plate − B+ Sag** 显示两级驱动器的实时工作点。Driver Type 为 Bypass 时，这些值显示为不可用。Sag 数值越负，表示阳极电压低于其电源电压的幅度越大
- Line 中，两个图表分别显示 Stage 1 和 Stage 2 的阳极特性和最近的工作点，工作点以离散的点绘制，而不连成线
  - 横轴为阳极-阴极电压 **Vak (V)**，纵轴为阳极电流 **Ia (mA)**
  - 细灰线表示电子管在多个 **Vgk** 值下的静态阳极特性，较亮的灰色虚线表示电路的负载线
  - 青色代表左声道，橙色代表右声道；点的分布范围越大，表示音乐驱动该级跨越的工作范围越宽
- Push-Pull Power 中，图表切换为 **Push** 和 **Pull** 负载线，并以点绘出两支输出管最近的阳极电流工作点。
- **Power LTP Balance** 显示 Push-Pull Power 倒相级的差分电压。**Power B+** 显示两种功率拓扑中下垂后的功率级电源。
- **Speaker Output (100 ms)** 和 **Speaker Real Power (100 ms)** 显示选定负载上不重叠的 100 ms 电气测量。Real Power 由瞬时负载电压和电流计算，不是简单的 Vrms²/标称阻抗。
- **Transformer Flux** 以韦伯显示模拟输出变压器磁通。功率输出读数在 Push-Pull Power 和 SE Triode 中都有意义。
- 图表下方的状态会显示处理正在加载、已启用或处于安全旁路，并始终以 dB 显示当前的输出保护衰减量，即使为 0.0 dB 也会显示。

### 处理要求与延迟
- Tube Simulator 使用 WebAssembly 处理 44.1、48、88.2、96、176.4 和 192 kHz 音频
- 44.1 kHz 系列在内部以 352.8 kHz 处理，48 kHz 系列在内部以 384 kHz 处理
- 在 44.1 或 48 kHz 下，由于输入源不包含更高采样率可提供的高频信息，应用的低采样率常规警告仍会显示
- 支持 Stereo 和声道对模式；不支持的采样率或声道模式使用旁路路径
- 在所有支持的采样率下，过采样滤波器都会产生固定 64 samples 的延迟（44.1 kHz 下约 1.45ms，192 kHz 下约 0.33ms）
