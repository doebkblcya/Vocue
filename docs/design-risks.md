# Vocue 设计与风险笔记

> **状态**:基于一次全仓库通读(2026-09-16)
> **扫描范围**:`src/` 全部文件、`tests/`、`electron.vite.config.ts`、`tsconfig.json`、`package.json`、`.gitignore`
> **性质**:记录「不看代码猜不到的设计决定」与「已识别的风险」,供后续微调时对照
> **关联文档**:[requirements.md](./requirements.md)(需求清单)

## 目录

- [1. 架构全景](#1-架构全景)
- [2. 非显然的设计决定](#2-非显然的设计决定)
- [3. 风险与缺陷](#3-风险与缺陷)
- [4. 与需求清单的交叉引用](#4-与需求清单的交叉引用)
- [5. 延迟预算](#5-延迟预算)
- [6. 测试与工程空白](#6-测试与工程空白)
- [7. 上游 Bready 对照](#7-上游-bready-对照)
- [8. 维护建议](#8-维护建议)

---

## 1. 架构全景

### 1.1 进程与窗口

```
主进程 (src/main)
├── index.ts            组装:数据库 / 设置 / 会话 / IPC / 窗口
├── windows.ts          主窗口 + 置顶回答窗口
├── ipc/register.ts     全部 IPC 通道 + 可信来源校验
├── storage/            LocalDatabase(node:sqlite) + SettingsStore(safeStorage)
├── session/            InterviewSession —— 唯一的会话状态机
├── asr/doubao-asr.ts   豆包双向流式 WebSocket 客户端
├── ai/                 DeepSeek 客户端 + prompt 模板
├── audio/              SystemAudioCapture(子进程) + PcmAudioProcessor(降采样)
└── documents/          PDF / MD / TXT 文本提取

preload/index.ts        通过 contextBridge 暴露 window.vocue

渲染进程 (src/renderer)
├── App.tsx             靠 URL hash 分流出两个「窗口」
├── components/
│   ├── Workspace.tsx           主窗口:开始面试 + 档案列表
│   ├── FloatingWindow.tsx      置顶窗口:状态 + 转写 + 回答 + 按住录音
│   ├── SetupView.tsx           设置 / 首次配置
│   ├── ArchiveEditorDialog.tsx 档案编辑
│   └── StartInterviewDialog.tsx 开始面试
└── audio/microphone.ts 麦克风采集与重采样(渲染进程内完成)
```

**关键点:两个窗口是同一个 React app。** `App.tsx:8` 读 `window.location.hash === '#/floating'`,`windows.ts:92` 用 `load(floatingWindow, '#/floating')` 打开同一个 `index.html`。两个窗口共用同一个 bundle 和同一份 `index.css`。

→ **副作用:任何全局样式(包括 `:root` 变量)改动都会同时作用于两个窗口。**

### 1.2 两条音频数据流

```
【系统音频模式】
SystemAudioDump(独立二进制, 24k 立体声 PCM)
  → stdout → SystemAudioCapture
  → PcmAudioProcessor(降采样 16k 单声道, 切 200ms 包)
  → DoubaoAsr.sendAudio(WebSocket 二进制帧)
  → 服务端 VAD 判停 → definite → 等 1000ms 落定 → onFinal
  → InterviewSession.handleFinalTranscript → DeepSeek 流式
  → broadcast('session:state') → 两个窗口同时更新

【按住说话模式】
回答窗口按住 → AudioWorklet 取 Float32(原始采样率, 通常 48k)
  → 渲染进程内重采样到 16k 单声道, 切 100ms 包
  → ipcRenderer.send(单向, 不 await) → 主进程直接透传给 DoubaoAsr
  → 松手发负包 → 服务端 is_last_package → onSegmentEnd
  → 之后同上
```

**两条链路的关键不对称:**

| | 按住说话 | 系统音频 |
| --- | --- | --- |
| 采集位置 | 渲染进程 | 主进程 |
| 重采样位置 | 渲染进程(`microphone.ts:71-88`) | 主进程(`audio-processor.ts`) |
| 分包长度 | 100 ms | 200 ms |
| 判停来源 | 客户端「最后一包」 | 服务端 VAD |
| `enable_nonstream` | false | true |
| VAD 参数 | 不配置 | `end_window_size: 1200` + `force_to_speech_time: 1000` |
| 结束信号 | `is_last_package` | `definite` + 1000ms 落定 |

**同一件降采样/切包的事写了两遍,而且包长不同。** 功能上没问题,但改参数时必须先确认改的是哪一条。

### 1.3 状态与事件

`InterviewSession` 是唯一的状态源,通过 `EventEmitter` 广播 `state`,主进程 `broadcast('session:state', state)` 同时推给两个窗口,渲染进程用 `useSessionState()` 订阅。

`SessionStatus`(`types.ts:72-81`)只描述**语音链路**:`idle` / `connecting` / `verifying` / `ready` / `listening` / `recording` / `finalizing` / `reconnecting` / `error`。

**「AI 是否正在生成回答」是独立字段 `generating`,不属于 `SessionStatus`。** 这个划分是有意为之的,设计注释里写明了。

---

## 2. 非显然的设计决定

以下都是**有意为之、但看表面猜不到**的行为。改代码前请先读这一节。

### D1 · ASR 取「最后一个分句」,不取累计文本

`doubao-asr.ts:339`:

```ts
const text = (lastUtterance?.text || response.body.result?.text || response.body.text || '').trim()
```

注释写得很清楚:`result.text` 是**整条连接的累计文本**。系统音频是十几分钟的长连接,用它会「把这十几分钟说过的话全部当成一个问题送进模型」。按住说话是一段一条连接,两者才等价。

→ **这是全项目最关键的一行。** 若为了「简化」改回 `result.text`,系统音频模式会彻底崩掉,而且是那种「看起来还在工作」的崩法。

### D2 · ASR 有三道防串扰机制

| 机制 | 位置 | 作用 |
| --- | --- | --- |
| `generation` 代际 | `:115`、`:316` | 每次开新连接 +1,旧连接迟到的帧直接丢弃。防快速连按时上一段文本串进当前段 |
| `lastFinal` + 5 秒窗口 | `:390` | 同一句话 5 秒内重复 definite 直接丢掉。防服务端重复判停导致同一个问题被问两遍 |
| `SEGMENT_SETTLE_MS = 1000` | `:87` | definite 之后再等 1 秒才取文本。宁可慢,不要半句话 |

三者都容易被误判为「多余的防御」而删掉。

### D3 · 麦克风模式「用完就断」,并为服务端踢人写了专门分支

`doubao-asr.ts:136 markIdle()` 在一段结束后主动断开连接,因为空闲连接会被服务端以 `45000081`(等包超时)掐掉。

`interview-session.ts:254` 对这个错误码有**专门分支**:不报错、不算故障、静默切回 ready。

→ 用户看到「没按按钮连接也断了」是**设计好的**,不是 bug。

### D4 · `systemPrompt` 数据库快照仅作为兼容字段保留

`register.ts` 仍会在分析时生成并保存 `preparations.system_prompt`,以兼容现有数据库结构。

运行时不再读取这份快照:`interview-session.ts` 会通过
`buildCurrentInterviewSystemPrompt()` 使用当前模板和已保存的结构化分析重新组装提示词。

→ 修改 `prompt-builder.ts` 后,新旧档案都会在下次开始面试时生效,且不会额外调用模型。

### D5 · 保存档案会清空分析结果

`database.ts:154-155` 的 `ON CONFLICT` 显式设置 `analysis_json = NULL, system_prompt = ''`。

→ 改个档案名字就会丢掉预分析。同时 `register.ts:126-128` 会在点「开始面试」时**自动补做一次阻塞式分析**。

### D6 · 麦克风采集参数的刻意组合

`microphone.ts:50-55`:

```ts
audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true }
```

**回声消除是关掉的** —— 因为 EC 处理会损伤人声、拉低识别率。代价:外放时麦克风会把面试官的声音也收进去。

### D7 · 麦克风音频走单向 IPC

`preload/index.ts:46` 用 `ipcRenderer.send`(单向),不是 `invoke`。每 100ms 一个包,刻意避开了请求/响应往返的开销。

`ipcMain.on('session:microphone-audio')`(`register.ts:146`)对应接收,同为单向。

### D8 · 错误提示的「中英混合」启发式

`shared/error-message.ts:52-54`:

```ts
function isFriendly(message: string): boolean {
  return /[\u4e00-\u9fa5]/.test(message) && !/[A-Za-z]{2,}\s*\(|error|Error|failed|Failed/.test(message)
}
```

含义:含中文、且不含英文技术痕迹的消息原样透出,否则回退通用文案。

翻译顺序也有讲究(`:23-47`):`/401|403/` **排在** `/50\d{2}/` **前面**,所以 `HTTP 401` 判为凭证问题而非服务端问题。这类顺序是有意为之。

### D9 · 用 Node 内置 SQLite,而非 better-sqlite3

`database.ts:4`:`import { DatabaseSync } from 'node:sqlite'`。

好处:没有原生模块编译 / electron-rebuild 问题。代价:生态薄,且**没有迁移框架**。

### D10 · 密钥与普通设置分两套存储

| 数据 | 存放 | 加密 |
| --- | --- | --- |
| `deepseekApiKey` / `doubaoApiKey` | `userData/secrets.json`(mode 0600) | `safeStorage` 加密 |
| `theme` / `hideFromScreenCapture` | SQLite `settings` 表 | 明文 |

`settings.ts:47` 的逻辑:**空字符串不覆盖已有值**。所以设置页留空 = 不修改,这是有意的。

### D11 · 「防录屏」功能反过来要求录屏权限

`windows.ts:143` 的 `desktopCapturer.getSources()` 需要 macOS **屏幕录制**权限。自检本身是为了验证 `setContentProtection` 是否生效,而验证手段就要求有录屏权限。

代码已妥善处理(`:123` 检查 `getMediaAccessStatus('screen')` 并给出友好提示)。

### D12 · 置顶窗口的浮层配置

`windows.ts:86-87`:

```ts
floatingWindow.setAlwaysOnTop(true, 'floating')
floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
```

这是它能浮在全屏会议软件之上的原因。窗口 `frame: false` + `transparent: true`,圆角与阴影由 CSS 的 `.floating-shell::before` 提供。

`minimizeFloatingWindow()` 实际是 `hide()`,不是最小化 —— **组件不会卸载,所以麦克风采集会继续工作**。

---

## 3. 风险与缺陷

**分级口径:**
- **P1** — 会明显影响使用,或直接阻塞后续开发
- **P2** — 边界情况、体验问题,或只在特定条件下触发
- **P3** — 整洁性 / 可维护性

### P1

#### A1 · `systemPrompt` 快照导致 prompt 改动不生效（已解决）

**解决日期**:2026-09-17

**原问题**:回答用的 system prompt 在「档案分析」时生成一次并永久存库。之后无论怎么改 `prompt-builder.ts`,已有档案都继续用旧 prompt。

**当前方案**:数据库字段保留兼容,但 `InterviewSession.start()` 每次都用当前模板、本地档案和已保存分析重新组装提示词。`session:start` 也只在缺少结构化分析时调用模型,不会因为快照为空而重复分析。

#### A2 · 保存档案清空分析 + 开始面试时阻塞式重分析（已解决）

**解决日期**:2026-09-17

**当前方案**:保存前比较 JD、简历和补充资料。只改档案名称时保留分析;实际资料变化时才清空旧分析。开始面试也只在结构化分析缺失时重新调用模型。

#### A3 · 答案队列无上限、无过期机制（已解决）

**解决日期**:2026-09-17

**当前方案**:改为“最新问题优先”。新问题会中止旧请求,并通过 `answerGeneration` 丢弃旧流的迟到片段和旧请求的 `finally`,避免回答、转写与 `generating` 状态错位。

#### A4 · `hideFromScreenCapture` 默认关闭（已解决）

**解决日期**:2026-09-17

**当前方案**:新用户默认开启录屏隐藏;已经明确保存过开关的用户继续沿用原选择。

#### A5 · 最危险的两个模块没有测试（第一批已补）

**解决日期**:2026-09-17

**当前覆盖**:已新增豆包帧编解码、回答抢占/迟到流隔离、停止清理以及数据库分析失效策略测试。更完整的 ASR 重连和状态迁移仍可继续补充。

#### A6 · 没有数据库迁移机制

**位置**:`database.ts:41-68`

**问题**:只有 `CREATE TABLE IF NOT EXISTS`,没有 `user_version` 或任何版本判断。

**影响**:新建表没问题(R5 复盘表);**给现有表加字段则对已存在的数据库完全不生效**,且不会有任何报错。以后要改表结构必须手写兼容逻辑。

### P2

#### B1 · 关掉主窗口后,主窗口回不来（已解决）

点击 Dock 图标现在始终调用 `showMainWindow()`:不存在就重建,存在则恢复、显示并聚焦。

#### B2 · 麦克风首次初始化存在竞态（已解决）

按下、松开与停止操作现在通过同一条 Promise 链串行执行。首次授权期间的重复按键不会再创建多个 `getUserMedia` / `AudioContext`,松开也不会越过尚未完成的按下。

#### B3 · 录屏可见性自检有 250ms 的「裸奔窗口」

**位置**:`windows.ts:129-135`

**问题**:自检会先 `setCaptureProtection(false)`,等 250ms 再截图。**这 250ms 内 Vocue 对任何正在录屏的软件都是可见的。**

当前只在设置页触发,且 IPC 已禁止在面试进行中运行自检。测试本身仍需短暂关闭保护来生成对照图,因此非面试期间也应由用户主动触发。

#### B4 · `before-quit` 不等待异步清理（已解决）

`before-quit` 现在首次触发时阻止退出,等待 `session.stop()` 完成后关闭数据库,再执行最终退出。

#### B5 · 打包链路从未被验证

**位置**:`package.json`(无 `electron-builder`、无 `build` 配置段)、`system-audio-capture.ts:40`

**问题**:`npm run build` 只是 `electron-vite build`(产出 `out/`),**没有任何 DMG / 签名 / 公证流程**。

因此 `app.isPackaged ? process.resourcesPath : ...` 这条**打包分支从来没被执行过**;`assets/SystemAudioDump` 如何进入 `resources/` 也还没有答案。README 也承认了这一点。

#### B6 · IPC 可信来源校验依赖开发服务器地址（已解决）

开发模式现在与 `ELECTRON_RENDERER_URL` 的实际 origin 精确匹配;生产模式只接受 `file:` 页面。

#### B7 · 麦克风采样缓冲是 `number[]` 且 `splice` 为 O(n)

**位置**:`microphone.ts:9`、`:92`

**问题**:`samples` 是普通 JS 数组,`sendCompletePackets()` 里 `this.samples.splice(0, 1600)` 每次都是 O(n) 搬移。

**当前无害**(只在按住期间累积,缓冲很小)。**但 R3 要把麦克风改成全程常开,这个结构会退化成 O(n²)。** R3 必须先换环形缓冲。

#### B8 · 渲染进程 `sandbox: false`（已解决）

两个窗口均已启用 `sandbox: true`,同时保留 `contextIsolation: true` 和 `nodeIntegration: false`。

### P3

#### C1 · 状态初始化写了两遍（已解决）

主进程与渲染进程现在共同使用 `createInitialInterviewSessionState()`。

#### C2 · 降采样逻辑重复实现

`microphone.ts:71-88`(渲染进程)与 `audio-processor.ts:34-43`(主进程)是同一套线性插值重采样,两份代码,两个采样率上下文。

#### C3 · `stop()` 不清 `finalTranscript` 与 `answer`（已解决）

`stop()` 现在同时清理 `partialTranscript`、`finalTranscript` 和 `answer`。

#### C4 · `@` 别名声明了两处

`electron.vite.config.ts:15` 与 `tsconfig.json` 的 `paths`。改一处容易漏另一处。(实际代码里目前也没用到这个别名。)

#### C5 · `useSessionState` 存在极小竞态（已解决）

现在先订阅实时状态再读取快照;读取期间若已经收到实时事件,旧快照会被丢弃。

#### C6 · `answerQuestion` 开头的 `abort()` 是死代码（已解决）

串行队列已移除;新问题到达时的 `abort()` 现在确实会中止正在生成的旧回答。

---

## 4. 与需求清单的交叉引用

做对应需求时,以下问题会先撞上来。

| 需求 | 会撞上的东西 |
| --- | --- |
| **R1** 文档容量 | 分析用的 prompt(JD 30k / 简历 40k / 单文档 20k)比面试用的**更大**,冷启动最慢的是它而不是回答 |
| **R2** 思考模式 | **已实现**—— 开启后发送强度并移除无效 `temperature`;产品只展示最终回答,不展示思维链 |
| **R3** 全场录音 | **B7**(`number[]` + `splice` 的 O(n²));24k 立体声无编码器,1 小时约 346MB;麦克风需从「按住才跑」改为常开 |
| **R4** 文件识别 | 流式用 `volc.seedasr.sauc.duration`,文件识别是另一套端点 + 另一个 resource id,**同 Key 是否可用必须实测** |
| **R5** 复盘 | 新建表可行;但 **A6** 意味着以后改表结构只能手写兼容逻辑 |
| **R6** 追问上下文 | **暂用旧策略**—— 最近 4 轮问题 + AI 建议回答;回答不是候选人真实口述,后续仍需替换 |
| **R7** 截屏提问 | **已实现**—— 捕获鼠标所在显示器,临时隐藏 Vocue,图片只放 `user` message,发送前确认隐私影响 |
| **R8** 要点先行 | **已实现**—— 单次流式回答拆成独立要点区与详细区;要点约 60 字,详细默认约 120～180 字 |
| **R9** 仿真面试 | `SessionStatus` 目前只描述「听/说」一种角色,角色反转要动这套枚举 |

---

## 5. 延迟预算

系统音频模式从**面试官闭嘴**到**答案开头出现**:

| 环节 | 耗时 | 位置 |
| --- | --- | --- |
| 服务端 VAD 静音判停 | ~1200 ms | `SYSTEM_AUDIO_PARAMS.endWindowSize` |
| definite 后等文本落定 | 1000 ms | `SEGMENT_SETTLE_MS`(`doubao-asr.ts:87`) |
| **固定小计** | **≈ 2200 ms** | |
| DeepSeek 首字延迟 | 变量 | 取决于 system prompt 规模与历史长度 |

**R2(思考模式)、R6(长上下文)、R7(图片)三个需求都在抢这之后仅剩的一两秒。** 它们互相挤占,必须一起定策略。

另外注意:VAD 的 1200ms 和落定的 1000ms 都是**为了准确率而刻意调保守的**(注释里写明「宁可多等一点,也不要一句话被切两半」)。缩短它们会直接提高误切句的概率。

---

## 6. 测试与工程空白

| 项目 | 现状 |
| --- | --- |
| 单元测试 | 7 份文件、25 个用例 |
| 类型检查 | `npm run type-check`(`tsc --noEmit`),通过 |
| Lint / Formatter | **无** |
| CI | **无** |
| 端到端测试 | **无** |
| 打包 / 分发 | **无**(见 B5) |
| Git 历史 | 已有基线提交 `ac15771` |

**测试覆盖的优先级建议**:

1. `interview-session` 其余状态迁移 —— 尤其是 `microphoneActive` 与 `status` 的组合,以及 `45000081` 分支。
2. `SettingsStore.save` 的「空字符串不覆盖」语义。
3. 窗口生命周期与权限流程的端到端测试。

---

## 7. 上游 Bready 对照

Vocue 基于 [Suge8/Bready](https://github.com/Suge8/Bready) 二次开发。

**⚠️ 局限说明**:以下对照基于 **Bready 的 README 描述**与**当前 Vocue 源码**的比对,**并未阅读 Bready 的源代码**。因此只能说明「原版宣称有的东西现在没有了」,不能断定具体实现差异。若需要精确对照,应直接 diff 上游仓库。

Bready README 宣称存在、而当前 Vocue 仓库中**完全不存在**的功能:

| Bready 宣称 | Vocue 现状 |
| --- | --- |
| Google 登录 / 邮箱注册 / 密码重置 | 无任何账号体系 |
| Gemini(`DEBUG_GEMINI`) | 只用 DeepSeek |
| 多语言(中 / 英 / 中英混合 / 日 / 法) | 只有中文 |
| `.env` + `DEBUG_*` 调试开关体系 | 无;`log.ts` 只有 14 行的 stdout/stderr 封装 |
| `npm run dist` / `dist:all` 打包发布 | 无 `electron-builder`,无打包脚本 |
| `DEBUG_DB` / `DEBUG_AUTH` | 存储已改为 `node:sqlite`,无认证 |
| `docs/UI_DESIGN.md` | 不存在 |
| CI / Coverage 徽章 | 无 CI |

**结论**:Vocue 不是轻量 fork,而是**大幅收窄功能面**的重写 —— 砍掉账号体系与多语言、把 AI 供应商从 Gemini 换成 DeepSeek、把存储换成 Node 内置 SQLite、把语音链路重做成「按住说话 + 系统音频」两条。

**这解释了一些看起来「残留」的现象**:例如 `audio-processor.ts` 只服务系统音频、`microphone.ts` 里另写了一套重采样(C2),很可能是两条链路在不同时期接入的结果。

---

## 8. 维护建议

按「投入产出比」排序:

1. **为数据库引入最小迁移版本机制(A6)。** 后续只要给现有表加字段就会需要。
2. **验证打包链路(B5)。** 确认 `SystemAudioDump` 进入 resources 并完成签名、公证。
3. **继续补会话状态机测试。** 覆盖重连、服务端踢连接与录音中断。
