# Pipeline Analyzer

Pipeline Analyzer 可在不改变实际听到的音频的情况下，测量当前 Effect Pipeline 的响应。窗口较宽时，它位于 pipeline 旁边；窗口较窄时，它移到标题下方，便于一边调整效果器，一边查看结果更新。

可通过 Effect Pipeline 标题中的图表按钮，或桌面应用的 **View > Pipeline Analyzer** 打开。选择 **Auto** 后，pipeline 发生变化时会自动开始新的测量。取消选择 **Auto** 后，只有选择 **Refresh measurements** 才会测量 pipeline 的变化。更改测量设置时始终会开始新的测量。

## 选择通道和扬声器响应

选择一个输入通道。初始显示一个输出；使用 **+ Add Output** 可从当前音频设备中添加最多四个不同的通道。删除输出时，其扬声器响应设置也会删除。最后一个输出不能删除。

每个输出都可选择 **No speaker IR**，或选择已连接高音、低音等扬声器单元的已保存测量点。如果选择了测量但未选择其中的测量点，则视为 **No speaker IR**。所有输出均未使用扬声器 IR 时，**Before** 是理想单位脉冲：0 ms 处为 1.0，其余位置为 0。使用扬声器 IR 时，**Before** 是对齐后响应的带符号总和。**After** 是各输出经过所选 pipeline 后的带符号总和，因此可以同时检查 FIR Crossover 及各扬声器单元。若已保存的响应缺失，在替换或清除之前会一直明确标为缺失。

已保存的扬声器响应会按检测到的起点对齐。分开测量不会保留驱动单元之间的实际声学到达时间差，因此请先在 pipeline 中设置相对延迟和极性，再判断合计响应。

## 测量设置

打开 **Measurement settings** 可调整以下项目：

- **Signal** 默认使用 **MLS**。**TSP** 是另一种周期性测试信号，**Unit Impulse** 则直接捕获时域响应。对于非线性或随时间变化的效果器，不同信号测得的 pipeline 结果可能不同。
- **Level** 设置测试信号峰值，默认值为 `-12 dBFS`。线性效果器通常在不同电平下得到相同的归一化响应；非线性或与电平相关的效果器则可能不同。
- **Sequence Length** 决定 MLS 或 TSP 能在不发生重叠的情况下测量多长的响应。数值越大，所需时间和内存越多。对于 delay、reverb 或其他尾音较长的效果器，尤其是 Analyzer 建议使用更长数值时，请增大该值。
- **Stabilization Periods** 默认值为 12，用于在捕获前让 pipeline 稳定下来。如果变化缓慢的效果器尚未达到稳定状态，请增大该值。
- **Averages** 默认值为 2。图表不稳定时，增大该值可减小每次测量之间的差异，但测量时间也会变长。

详细信息会显示当前长度是否足够、建议长度和稳定时间，以及测量总时长。建议值仅供参考，请在适合所测效果器时采用。

仅在选择 Unit Impulse 时，Sequence Length、Stabilization Periods 和 Averages 会被禁用。切换 Frequency、Phase、Min Group Delay、Excess Group Delay 或 Impulse 只会改变图表显示，不会重新测量。

## 图表的读法

- 使用图表外的 **Graph** 单选按钮选择要显示的响应。
- **Frequency** 显示电平随频率的变化。
- **Phase** 显示相位随频率的变化。
- **Min Group Delay** 显示幅度响应的最小相位部分所对应的延迟。
- **Excess Group Delay** 显示去除最小相位部分后剩余的延迟，便于区分纯延迟和其他非最小相位时序。
- **Impulse** 显示随时间变化的响应。

图表始终显示 **Before** 和 **After**。移动指针可读取同一频率或时刻的两个数值；指向 **Before** 时会暂时隐藏 **After**，以便清楚比较。为避免布局移动，**Smoothing (oct)** 和 **Impulse Range (ms)** 会一直显示在所有图表中。Smoothing 在 Frequency 和两个 Group Delay 图表中可用；Impulse Range 在 Impulse 中可用。与当前图表无关的控件会被禁用。每条频率曲线分别以 0 dB 为基准；每条脉冲按自身完整响应的峰值缩放，并从 -2 ms 显示到所选的 Impulse Range。

## 测量方法

每次测量都会捕获当前 pipeline、其设置和路由，以及所选的扬声器响应。图表显示由此得到的频率、相位、最小群延迟、超额群延迟和脉冲响应；**After** 会补偿 pipeline 报告的延迟。

MLS 和 TSP 适合一般的响应测量。如果 delay、reverb 或振铃超出所选测量窗口，结果可能发生重叠；请增大 **Sequence Length**。**Unit Impulse** 会在有限时间内直接记录响应，因此特别长的尾音可能被截断。

非线性、时变、随机、含噪声或会自行产生声音的效果器，在不同电平下或不同测量之间可能得到不同结果。请将图表视为所选设置的快照，而不是固定不变的特性。
