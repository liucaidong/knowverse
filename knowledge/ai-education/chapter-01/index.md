# Mac × iPhone 多模态学习台需求

> 来源：按可检索历史会话线索整理，部分表达为知识性归纳，非逐字原话。

核心目标（2026-10-24）：Mac 大屏阅读，iPhone 支架作为实时摄像头，AI 能保持持续视频/语音沟通，讲解书本并审阅作业、试卷。

```mermaid
flowchart LR
 Phone[iPhone 摄像头] --> Stream[实时音视频通道]
 Mac[Mac 阅读与标注] --> UI[学习台工作区]
 Stream --> RT[实时多模态模型]
 UI --> RT
 RT --> Teacher[讲解 / 追问]
 UI --> Scan[高清静态抓拍]
 Scan --> Vision[视觉审阅 / OCR]
 Vision --> Feedback[批改建议 / 学习档案]
 Teacher --> Feedback
```

核心工程拆分：实时会话强调延迟和持续互动；高清作业批改强调细节、证据定位和可复查。两者可以共享学习档案，但不应为追求“全由单一模型承担”而牺牲输入质量。
