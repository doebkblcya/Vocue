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
SystemAudioDump(独立二进制, 48k 立体声 PCM)
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

### D4 · `systemPrompt` 是分析时生成的数据库快照

`register.ts:44` 生成 → `database.ts:178` 存入 `preparations.system_prompt` → `interview-session.ts:73` 优先读库。

→ **改了 `prompt-builder.ts` 的模板,已存在的档案永远不会生效。** 这是 prompt 迭代的头号陷阱,详见风险 A1。

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

#### A1 · `systemPrompt` 快照导致 prompt 改动不生效

**位置**:`register.ts:44` → `database.ts:178` → `interview-session.ts:73`

**问题**:回答用的 system prompt 在「档案分析」时生成一次并永久存库。之后无论怎么改 `prompt-builder.ts`,已有档案都继续用旧 prompt。

**什么时候咬人**:R8(要点先行)、R6(上下文策略)等所有 prompt 层迭代。你会改完代码、重启、测试,然后发现「没有任何变化」,并开始怀疑自己的改动。

**可能方案**:模板版本号存库,版本不匹配时自动重新生成;或放弃快照,每次 `start()` 现算(牺牲一点启动速度换可迭代性)。

#### A2 · 保存档案清空分析 + 开始面试时阻塞式重分析

**位置**:`database.ts:154-155`、`register.ts:126-128`

**问题**:两层叠加。①改档案名就会丢掉分析结果;②下次开始面试时自动补做分析,而这是一个**非流式的大请求**(JD 30k + 简历 40k + 单文档 20k),会阻塞「开始面试」。

**什么时候咬人**:每次微调档案后开始面试,都会感觉「卡一下」,且每次都重新花钱。

#### A3 · 答案队列无上限、无过期机制

**位置**:`interview-session.ts:327`

**问题**:`answerQueue` 是**严格串行**的。系统音频连续判停出 3 个问题,就会**排队生成 3 个完整回答**,一个都不丢。而 `answerQuestion` 开头的 `patchState({ answer: '' })` 会先清空界面。

**实际后果**:面试官快速连问时,「面试官」栏已经显示第二句,「建议回答」栏还是第一句的答案(或空白),后台还在为过时的问题烧钱。

**缺失的能力**:队列积压时丢弃旧问题、或标记「已过期不再回答」。

#### A4 · `hideFromScreenCapture` 默认关闭

**位置**:`settings.ts:9`(`DEFAULTS.hideFromScreenCapture: false`)

**问题**:对一个定位如此的产品,新用户第一次使用就是暴露状态,需要主动去设置里打开。

#### A5 · 最危险的两个模块没有测试

**位置**:`tests/` 只有 3 份共 12 个用例(`prompt-builder` / `audio-processor` / `error-message`)。

**缺口**:
- `doubao-asr.ts` 的帧编解码 —— `buildFrame` / `parseFrame` **都是纯函数,极易测**,却完全没有覆盖。
- `interview-session.ts` 的状态机 —— 最容易在微调中改坏,同样没有覆盖。

#### A6 · 没有数据库迁移机制

**位置**:`database.ts:41-68`

**问题**:只有 `CREATE TABLE IF NOT EXISTS`,没有 `user_version` 或任何版本判断。

**影响**:新建表没问题(R5 复盘表);**给现有表加字段则对已存在的数据库完全不生效**,且不会有任何报错。以后要改表结构必须手写兼容逻辑。

### P2

#### B1 · 关掉主窗口后,主窗口回不来

**位置**:`index.ts:37-39`、`windows.ts:98`

**问题**:`activate`(点 Dock 图标)只在 `getAllWindows().length === 0` 时重建主窗口。但关掉主窗口时置顶窗口通常还开着 → 窗口数不为 0 → **点 Dock 图标没有任何反应**。

同时 `closeFloatingWindow` 里 `mainWindow` 已是 `null`,那条「恢复主窗口」的分支也是空转。

**结果**:只能通过置顶窗口的「停止并关闭」退出,期间处于「有界面但没主窗口」的状态。

#### B2 · 麦克风首次初始化存在竞态

**位置**:`microphone.ts:8-25`

```ts
if (this.sending) return
if (!this.context) await this.initialize()   // ← await 期间 sending 仍是 false
this.sending = true
```

**问题**:两次极快的按下会**同时通过 `sending` 检查**,`initialize()` 被调用两次 → 两个 `getUserMedia`、两个 `AudioContext`,其中一个泄漏且不会被 `stop()` 回收。

`event.repeat` 挡住了键盘长按自动重复,但挡不住真正的手速。**修复不难:用一个 `initializing` promise 做互斥。**

#### B3 · 录屏可见性自检有 250ms 的「裸奔窗口」

**位置**:`windows.ts:129-135`

**问题**:自检会先 `setCaptureProtection(false)`,等 250ms 再截图。**这 250ms 内 Vocue 对任何正在录屏的软件都是可见的。**

当前只在设置页触发,风险很低。但**如果以后想在面试进行中加「自检」按钮,这就是一个真实的暴露窗口。**

#### B4 · `before-quit` 不等待异步清理

**位置**:`index.ts:44-48`

```ts
app.on('before-quit', () => {
  void session?.stop()      // ← 没有 await
  database?.close()
  database = null
})
```

**问题**:快速退出时可能留下没发出去的 ASR 负包;数据库也可能在会话清理完成前关闭。

#### B5 · 打包链路从未被验证

**位置**:`package.json`(无 `electron-builder`、无 `build` 配置段)、`system-audio-capture.ts:40`

**问题**:`npm run build` 只是 `electron-vite build`(产出 `out/`),**没有任何 DMG / 签名 / 公证流程**。

因此 `app.isPackaged ? process.resourcesPath : ...` 这条**打包分支从来没被执行过**;`assets/SystemAudioDump` 如何进入 `resources/` 也还没有答案。README 也承认了这一点。

#### B6 · IPC 可信来源校验依赖开发服务器地址

**位置**:`register.ts:21-26`

```ts
if (!url.startsWith('file://') && !url.startsWith('http://localhost:') && !url.startsWith('http://127.0.0.1:'))
```

**问题**:开发模式下 electron-vite 的 dev server 恰好是 `localhost`,所以能通过。**若 vite 改用 `[::1]` 或局域网 IP,所有 IPC 会被静默拒绝**(报「拒绝未知页面的 IPC 请求」)。

#### B7 · 麦克风采样缓冲是 `number[]` 且 `splice` 为 O(n)

**位置**:`microphone.ts:9`、`:92`

**问题**:`samples` 是普通 JS 数组,`sendCompletePackets()` 里 `this.samples.splice(0, 1600)` 每次都是 O(n) 搬移。

**当前无害**(只在按住期间累积,缓冲很小)。**但 R3 要把麦克风改成全程常开,这个结构会退化成 O(n²)。** R3 必须先换环形缓冲。

#### B8 · 渲染进程 `sandbox: false`

**位置**:`windows.ts:45`、`:83`

**问题**:`sandbox: false` 但 `contextIsolation: true`。当前 preload 只用了 `ipcRenderer`,并不需要关沙箱。属于可以收紧的权限面。

### P3

#### C1 · 状态初始化写了两遍

`hooks.ts:4-15` 的 `INITIAL_STATE` 与 `interview-session.ts:28-39` 是同一份数据的两个副本。加字段要改两处,`noUnusedLocals` 帮不上忙。

#### C2 · 降采样逻辑重复实现

`microphone.ts:71-88`(渲染进程)与 `audio-processor.ts:34-43`(主进程)是同一套线性插值重采样,两份代码,两个采样率上下文。

#### C3 · `stop()` 不清 `finalTranscript` 与 `answer`

`interview-session.ts:159-171` 清理了 `partialTranscript`,但保留了 `finalTranscript` 和 `answer`。`start()` 会清,所以正常流程无影响;但如果以后出现「不经过 start 就重新打开置顶窗口」的路径,会看到上一场的残留内容。

#### C4 · `@` 别名声明了两处

`electron.vite.config.ts:15` 与 `tsconfig.json` 的 `paths`。改一处容易漏另一处。(实际代码里目前也没用到这个别名。)

#### C5 · `useSessionState` 存在极小竞态

`hooks.ts:19-22`:先发起 `getState()`(异步),再注册 `onState` 订阅。若在这两步之间恰好有状态推送,`getState()` 的**旧快照可能覆盖订阅收到的更新状态**。窗口极小,但严格来说存在。

#### C6 · `answerQuestion` 开头的 `abort()` 是死代码

`interview-session.ts:340` 的 `this.answerAbort?.abort()` 在队列串行的保证下不会真的打断任何东西(上一个任务必然已结束)。真正用到 `answerAbort` 的是 `stop()`。无害,但会误导读者以为「新问题会中断旧回答」。

---

## 4. 与需求清单的交叉引用

做对应需求时,以下问题会先撞上来。

| 需求 | 会撞上的东西 |
| --- | --- |
| **R1** 文档容量 | 分析用的 prompt(JD 30k / 简历 40k / 单文档 20k)比面试用的**更大**,冷启动最慢的是它而不是回答 |
| **R2** 思考模式 | `temperature: 0.45` 会被静默忽略;`reasoning_content` 被 `deepseek-client.ts:64` 静默丢弃(只读 `delta.content`),要显示思考过程必须新增解析 |
| **R3** 全场录音 | **B7**(`number[]` + `splice` 的 O(n²));48k 立体声无编码器,1 小时约 690MB;麦克风需从「按住才跑」改为常开 |
| **R4** 文件识别 | 流式用 `volc.seedasr.sauc.duration`,文件识别是另一套端点 + 另一个 resource id,**同 Key 是否可用必须实测** |
| **R5** 复盘 | 新建表可行;但 **A6** 意味着以后改表结构只能手写兼容逻辑 |
| **R6** 追问上下文 | `history` 里的 `assistant` 内容是 **AI 建议**,不是你说过的话;模型会把它当成「候选人真的这么说过」 |
| **R7** 截屏提问 | 置顶窗口会挡住题目;图片只能放 `user` message(放 system/assistant 返回 400);`deepseek-v4-pro` 不支持视觉;`recognizeImage` 的 prompt 写死了 JD 提取,需泛化 |
| **R8** 要点先行 | **A1**(prompt 快照)—— 不先解决它,测不出任何 prompt 改动 |
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
| 单元测试 | 3 份文件、12 个用例 |
| 类型检查 | `npm run type-check`(`tsc --noEmit`),通过 |
| Lint / Formatter | **无** |
| CI | **无** |
| 端到端测试 | **无** |
| 打包 / 分发 | **无**(见 B5) |
| Git 历史 | **无任何 commit**,全部文件未跟踪 |

**测试覆盖的优先级建议**:

1. `buildFrame` / `parseFrame` —— 纯函数,输入输出明确,收益最高、成本最低。
2. `interview-session` 的状态迁移 —— 尤其是 `microphoneActive` 与 `status` 的组合,以及 `45000081` 分支。
3. `SettingsStore.save` 的「空字符串不覆盖」语义。

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

1. **先做一次 git 基线提交。** 目前零 commit,连续微调没有回退点。
2. **补 `buildFrame` / `parseFrame` 的单测。** 成本极低,保护的是最不能坏的一行代码(D1)。
3. **解决 A1(prompt 快照)。** 否则后续所有 prompt 迭代都测不出效果。
4. **加一个队列积压策略(A3)。** 直接改善「问得快就乱」的核心体验。
5. **修 B2(初始化竞态)。** 一个小互斥就能解决。
6. **修 B1(主窗口回不来)。** 用户容易撞上,且困惑度高。
7. **重新评估 A4 的默认值。** 隐私默认值应该偏保守。
