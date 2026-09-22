import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const stamp = (): string => new Date().toISOString()
let logFile = ''

export function configureLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  logFile = path
}

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : ''
  const line = `[${stamp()}] [${level}] ${message}${detail}\n`
  if (level === 'INFO') process.stdout.write(line)
  else process.stderr.write(line)
  if (!logFile) return
  try {
    appendFileSync(logFile, line, 'utf8')
  } catch {
    // 日志永远不能反过来阻断启动或退出。
  }
}

export const log = {
  info(message: string): void {
    write('INFO', message)
  },
  warn(message: string, error?: unknown): void {
    write('WARN', message, error)
  },
  error(message: string, error?: unknown): void {
    write('ERROR', message, error)
  },
}
