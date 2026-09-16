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
    let startupError = ''

    child.stdout.on('data', (chunk: Buffer) => this.emit('data', chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) log.warn(`SystemAudioDump: ${line}`)
      startupError += line
      if (/permission|not authorized|SCStreamErrorDomain/i.test(line)) {
        this.emit('error', new Error('系统音频捕获失败，请在系统设置中授予录屏与系统录音权限'))
      }
    })
    child.on('error', (error) => this.handleExit(error))
    child.on('close', (code) => {
      if (this.process === child) this.process = null
      if (!this.desiredRunning) return
      const detail = startupError ? `：${startupError.slice(-200)}` : ''
      this.handleExit(new Error(`系统音频进程退出 (${code ?? 'unknown'})${detail}`))
    })

    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) resolvePromise()
        else reject(new Error(startupError || '系统音频工具启动失败'))
      }, 700)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
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
