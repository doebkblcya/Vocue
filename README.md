# Vocue

<p align="center">
  <img src="build/icon.png" width="128" alt="Vocue 图标" />
</p>

<p align="center">
  面向 Apple Silicon Mac 的 AI 面试助手：实时语音转写、回答建议、面试复盘与记录。
</p>

Vocue 把实时语音转写、AI 回答建议、面试资料和复盘集中在一个轻量桌面应用中。它不要求注册 Vocue 账号，也没有独立云端后台；你使用自己的 DeepSeek 和豆包 API Key，档案与面试记录默认保存在本机。

> 请只在合法且获得允许的场景中使用，并遵守面试方、会议平台和所在地的隐私及录音规定。

## 功能

- **实时回答建议**：识别问题后流式生成要点和补充说明。
- **两种输入方式**：支持系统音频持续识别，也支持按住按钮或空格录制。
- **面试档案**：按岗位整理 JD、简历和补充资料，支持 PDF、Markdown 和纯文本。
- **上下文追问**：保留最近问答，让连续追问保持上下文。
- **截图提问**：截取鼠标所在显示器，并在发送前确认。
- **面试记录与复盘**：保存本地转写，支持回声清理、导出 Markdown 和 AI 复盘。
- **只读手机伴侣**：手动开启后，可在同一局域网的手机上查看问题和回答。
- **录屏隐藏**：可让 Vocue 窗口尽量不出现在系统截图和会议录屏中，并提供可见性自检。
- **浅色与深色主题**：支持跟随 macOS 或固定主题。

## 系统要求

- Apple Silicon Mac（M 系列芯片）
- macOS 15 或更高版本
- DeepSeek API Key
- 豆包语音识别 2.0 新版 API Key
- 可访问上述服务的网络连接

目前不支持 Intel Mac、Windows 或 Linux。

## 安装

从项目的 [Releases](https://github.com/doebkblcya/Vocue/releases) 页面下载最新的 `Vocue-<version>-arm64.dmg`，打开后将 Vocue 拖入“应用程序”文件夹。

当前公开构建使用免费的 ad-hoc 签名，没有经过 Apple 公证。首次打开时，如果 macOS 阻止启动：

1. 在 Finder 的“应用程序”中右键 Vocue，选择“打开”；或
2. 前往“系统设置 → 隐私与安全性”，选择“仍要打开”。

这属于当前分发方式的限制，不代表安装包包含恶意内容。

## 首次使用

1. 打开设置，填写 DeepSeek 和豆包 API Key。
2. 分别执行连接测试。
3. 根据需要创建面试档案；也可以不使用档案，直接开始通用面试。
4. 选择“系统音频”或“按住说话”，开始面试。
5. 面试结束后，可在面试记录中查看转写、清理回声并生成复盘。

首次保存或读取 API Key 时，macOS 可能要求输入登录钥匙串密码。这是系统在授权 Vocue 使用钥匙串加密能力。

### macOS 权限

| 权限 | 用途 | 何时需要 |
| --- | --- | --- |
| 麦克风 | 录制并识别你的声音 | 使用“按住说话”时 |
| 屏幕与系统音频录制 | 获取会议系统音频、截图提问和可见性自检 | 使用对应功能时 |
| 本地网络 | 让手机访问只读伴侣页面 | 手动开启手机伴侣时 |

权限位置：`系统设置 → 隐私与安全性`。

使用新的 ad-hoc 构建覆盖安装后，macOS 偶尔会保留旧权限记录。如果设置里显示已开启但 Vocue 仍提示无权限，请完全退出 Vocue，在权限列表中删除旧条目，再重新添加 `/Applications/Vocue.app` 并开启权限。

## 数据与隐私

- 面试档案、资料和面试记录保存在 `~/Library/Application Support/Vocue/`。
- API Key 使用 Electron `safeStorage` 通过 macOS 钥匙串加密后保存在本机；应用界面只读取“是否已配置”，不会回显密钥。
- 语音会发送到豆包进行实时识别；问题、必要的档案上下文、截图和复盘内容会按功能需要发送到 DeepSeek。
- Vocue 当前没有账号系统、遥测或独立业务服务器。
- 手机伴侣仅在你手动开启时监听局域网，使用随机临时令牌并保持只读。它使用局域网 HTTP/WebSocket，请不要在不可信的公共网络中开启。
- “录屏隐藏”依赖 macOS 的内容保护能力，不应视为对外部摄像设备或所有第三方采集方式的绝对保证。

卸载应用不会自动删除本地资料。如需彻底清除数据，请先退出 Vocue，再删除上述目录。

## 从源码运行

```bash
git clone https://github.com/doebkblcya/Vocue.git
cd Vocue
npm ci
npm run dev
```

常用命令：

```bash
npm run type-check  # TypeScript 类型检查
npm test            # 运行测试
npm run build       # 构建应用
npm run dist:mac    # 生成 Apple Silicon DMG
```

DMG 输出到 `release/Vocue-<version>-arm64.dmg`。打包不会包含本机的 API Key、数据库或面试资料。

## 技术栈

- Electron、React、TypeScript、Vite
- 本地 SQLite
- DeepSeek Chat Completions API
- 豆包流式语音识别 2.0
- `SystemAudioDump` / ScreenCaptureKit 系统音频采集

## 第三方组件

`assets/SystemAudioDump` 是 [sohzm/systemAudioDump](https://github.com/sohzm/systemAudioDump) 提供的预编译 macOS 可执行文件，用于采集系统音频。它以 MIT 许可证发布，对应声明保存在 [`assets/SystemAudioDump.LICENSE`](assets/SystemAudioDump.LICENSE)。

## 许可证

本项目以 [MIT 许可证](LICENSE) 发布，版权所有 (c) 2026 doebkblcya。
