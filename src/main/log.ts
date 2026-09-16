const stamp = (): string => new Date().toISOString()

export const log = {
  info(message: string): void {
    process.stdout.write(`[${stamp()}] [INFO] ${message}\n`)
  },
  warn(message: string): void {
    process.stderr.write(`[${stamp()}] [WARN] ${message}\n`)
  },
  error(message: string, error?: unknown): void {
    const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : ''
    process.stderr.write(`[${stamp()}] [ERROR] ${message}${detail}\n`)
  },
}
