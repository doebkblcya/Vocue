# Vocue

只面向 Apple Silicon macOS 的个人 AI 面试助手。它只保留实时面试所需的核心链路，不包含账号、会员、支付、管理后台、多语言、PostgreSQL 和独立服务器。

## 当前能力

- 两个窗口：开始面试与管理档案的主窗口 + 始终置顶的实时回答窗口
- 两种录音模式，判停方式不同（见下方说明）
- 豆包流式语音识别 2.0（双向流式优化版端点 + Seed ASR 2.0 小时版）
- DeepSeek 官方 API，使用 `deepseek-flash`（V4.1 Flash）非思考模式流式回答
- 可选关闭 / 低 / 高 / 最大思考强度；默认关闭以保证实时性
- 临时沿用最近 4 轮问题与 AI 建议回答作为追问上下文，后续接入真实口述后再替换
- 回答先流式展示 2～3 条短要点，再展示控制篇幅的必要补充
- 回答窗可截取鼠标所在显示器提问，发送前会明确确认隐私影响
- 本地 SQLite 保存面试准备，不永久保存完整会话
- JD、简历及最多 5 份补充资料；支持有文字层的 PDF、Markdown、TXT
- 开始面试时选择系统音频或按住录制，也可以不选择档案直接使用通用模式
- API Key 通过 macOS `safeStorage` 加密保存在本机
- 新用户默认隐藏 Vocue 窗口，不让它出现在系统截图和会议录屏中
- 设置页提供内存级“未保护 / 已保护”录屏可见性对比自检，不会保存预览图片
- 外观支持跟随 macOS、固定浅色和固定深色，两个窗口会实时同步

## 两种录音模式

两条链路的判停来源是相反的，改参数前请先确认改的是哪一条。

| | 按住说话 | 系统音频 |
| --- | --- | --- |
| 采集 | 回答窗口中按住按钮或空格 | `SystemAudioDump` 持续采集系统声音 |
| 判停来源 | 松手时客户端发「最后一包」 | 服务端 VAD 按静音判停（1200ms） |
| VAD 参数 | **不配置**（否则中途停顿会被切句） | `end_window_size: 1200` + `force_to_speech_time: 1000` |
| 二遍识别 | 关闭 | 开启 |
| 结束信号 | 服务端 `is_last_package` | 服务端 `definite` + 1000ms 文本落定 |

按住说话只在松手时才结算，所以面试官中途停顿不会被误判为结束。

## 本地运行

```bash
npm install
npm run dev
```

首次进入后填写 DeepSeek API Key 和豆包新版控制台 API Key。系统音频模式需要在：

`系统设置 → 隐私与安全性 → 屏幕与系统音频录制`

为 `SystemAudioDump` 打开权限。麦克风模式需要给 Electron 打开麦克风权限。

## 验证

```bash
npm run type-check
npm test
npm run build
```

本项目目前不包含 DMG、签名、公证、自动更新或线上服务部署流程。

## 第三方组件

`assets/SystemAudioDump` 是预编译的 macOS 可执行文件，用于捕获系统音频并以 24kHz、16-bit、立体声 raw PCM 输出到 stdout。

- 来源：[sohzm/systemAudioDump](https://github.com/sohzm/systemAudioDump)
- 许可：MIT

原项目提供的可执行文件在此处原样使用，未做修改。按 MIT 许可要求，分发时需保留其版权与许可声明，因此该文件对应的许可文本放在 `assets/SystemAudioDump.LICENSE`。
