import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { app } from 'electron'
import { log } from '../log'

export interface SystemAudioCaptureEvents {
  data: [Buffer]
  reconnecting: [number]
  error: [Error]
}

export class SystemAudioCapture extends EventEmitter<SystemAudioCaptureEvents> {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null
  private desiredRunning = false
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      throw new Error('系统音频模式仅支持 Apple Silicon macOS')
    }
    this.desiredRunning = true
    this.restartAttempts = 0
    await this.spawnHelper()
  }

  stop(): void {
    this.desiredRunning = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const child = this.process
    this.process = null
    if (child && !child.killed) child.kill('SIGTERM')
  }

  private getExecutablePath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'SystemAudioDump')
      : resolve(__dirname, '../../assets/SystemAudioDump')
  }

  private async spawnHelper(): Promise<void> {
    const executable = this.getExecutablePath()
    if (!existsSync(executable)) throw new Error(`找不到系统音频工具：${executable}`)

    const child = spawn(executable, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.process = child
    let startupOutput = ''
    let startupError = ''
    let started = false

    child.stdout.on('data', (chunk: Buffer) => {
      if (started) {
        this.emit('data', chunk)
        return
      }
      // 上游工具把启动诊断误写到了 stdout，而 stdout 后续又承载裸 PCM。
      // 启动窗口内统一丢弃，既能读到权限错误，也不会把文本当音频发给 ASR。
      if (startupOutput.length < 16_384) startupOutput += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) log.warn(`SystemAudioDump: ${line}`)
      startupError += `${line}\n`
      if (/permission|not authorized|SCStreamErrorDomain/i.test(line)) {
        this.emit('error', new Error('系统音频捕获失败，请在系统设置中授予录屏与系统录音权限'))
      }
    })

    await new Promise<void>((resolvePromise, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        if (child.exitCode === null) {
          // 丢弃启动阶段的文字和最前面的极短音频，从这里开始 stdout 才只按 PCM 处理。
          started = true
          startupOutput = ''
          resolvePromise()
        } else {
          reject(describeStartupFailure(startupOutput, startupError))
        }
      }, 700)
      child.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        if (this.process === child) this.process = null
        const failure = describeStartupFailure(startupOutput, startupError, code)
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(failure)
        }
        if (this.desiredRunning) this.handleExit(failure)
      })
    })
  }

  private handleExit(error: Error): void {
    if (!this.desiredRunning || this.restartTimer) return
    if (this.restartAttempts >= 5) {
      this.emit('error', error)
      return
    }
    this.restartAttempts += 1
    this.emit('reconnecting', this.restartAttempts)
    const delay = Math.min(1000 * 2 ** (this.restartAttempts - 1), 10_000)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.spawnHelper().catch((spawnError: unknown) => {
        this.handleExit(spawnError instanceof Error ? spawnError : new Error(String(spawnError)))
      })
    }, delay)
  }
}

export function describeStartupFailure(
  stdout: string,
  stderr: string,
  code?: number | null,
): Error {
  const detail = `${stdout}\n${stderr}`.trim()
  if (/screen recording permission|required|permission denied|not authorized/i.test(detail)) {
    return new Error(
      '系统音频捕获没有权限，请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 SystemAudioDump',
    )
  }
  const suffix = detail ? `：${detail.slice(-200)}` : ''
  return new Error(`系统音频工具启动失败 (${code ?? 'unknown'})${suffix}`)
}
