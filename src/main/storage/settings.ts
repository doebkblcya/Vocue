import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'
import type {
  AppSettings,
  PublicSettings,
  ThemeMode,
  ThinkingEffort,
} from '../../shared/types'
import { LocalDatabase } from './database'

const DEFAULTS: AppSettings = {
  deepseekApiKey: '',
  doubaoApiKey: '',
  hideFromScreenCapture: true,
  theme: 'system',
  thinkingEffort: 'disabled',
}

const SECRET_KEYS = ['deepseekApiKey', 'doubaoApiKey'] as const

type SecretKey = (typeof SECRET_KEYS)[number]

export class SettingsStore {
  private secrets: Partial<Record<SecretKey, string>> = {}
  private initialized = false
  private initialization: Promise<void> | null = null

  constructor(
    private readonly database: LocalDatabase,
    private readonly secretsPath: string,
  ) {}

  /**
   * 钥匙串可能弹出系统授权框。使用异步 safeStorage，避免把 Electron 主线程
   * 连同窗口和退出事件一起冻住；失败后清掉 Promise，让界面的「重试」真能重试。
   */
  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    if (!this.initialization) {
      this.initialization = this.readSecrets()
        .then((secrets) => {
          this.secrets = secrets
          this.initialized = true
        })
        .catch((error: unknown) => {
          this.initialization = null
          throw error
        })
    }
    return this.initialization
  }

  get(): AppSettings {
    this.assertInitialized()
    const storedTheme = this.database.getSetting('theme')
    const storedCaptureProtection = this.database.getSetting('hideFromScreenCapture')
    const storedThinkingEffort = this.database.getSetting('thinkingEffort')
    return {
      ...DEFAULTS,
      ...this.secrets,
      hideFromScreenCapture: storedCaptureProtection === null
        ? DEFAULTS.hideFromScreenCapture
        : storedCaptureProtection === 'true',
      theme: isThemeMode(storedTheme) ? storedTheme : 'system',
      thinkingEffort: isThinkingEffort(storedThinkingEffort)
        ? storedThinkingEffort
        : DEFAULTS.thinkingEffort,
    }
  }

  getPublic(): PublicSettings {
    const settings = this.get()
    return {
      hasDeepseekApiKey: Boolean(settings.deepseekApiKey),
      hasDoubaoApiKey: Boolean(settings.doubaoApiKey),
      hideFromScreenCapture: settings.hideFromScreenCapture,
      theme: settings.theme,
      thinkingEffort: settings.thinkingEffort,
    }
  }

  async save(input: Partial<AppSettings>): Promise<PublicSettings> {
    await this.initialize()
    const secrets = { ...this.secrets }
    let secretsChanged = false
    for (const key of SECRET_KEYS) {
      if (input[key] !== undefined && input[key] !== '') {
        secrets[key] = input[key] as string
        secretsChanged = true
      }
    }
    if (input.hideFromScreenCapture !== undefined) {
      this.database.setSetting('hideFromScreenCapture', String(input.hideFromScreenCapture))
    }
    if (input.theme !== undefined && isThemeMode(input.theme)) {
      this.database.setSetting('theme', input.theme)
    }
    if (input.thinkingEffort !== undefined && isThinkingEffort(input.thinkingEffort)) {
      this.database.setSetting('thinkingEffort', input.thinkingEffort)
    }
    if (secretsChanged) {
      await this.writeSecrets(secrets)
      this.secrets = secrets
    }
    return this.getPublic()
  }

  isReady(): boolean {
    const settings = this.get()
    return Boolean(settings.deepseekApiKey && settings.doubaoApiKey)
  }

  private async readSecrets(): Promise<Partial<Record<SecretKey, string>>> {
    if (!existsSync(this.secretsPath)) return {}
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) throw new Error('macOS 登录钥匙串当前不可用，请解锁后重试')

    const envelope = JSON.parse(readFileSync(this.secretsPath, 'utf8')) as { encrypted?: unknown }
    if (typeof envelope.encrypted !== 'string') throw new Error('本机密钥文件格式无效')
    const encrypted = Buffer.from(envelope.encrypted, 'base64')
    const decrypted = await safeStorage.decryptStringAsync(encrypted)
    const parsed = JSON.parse(decrypted.result) as Record<string, unknown>
    if (decrypted.shouldReEncrypt) {
      await this.writeSecrets({
        deepseekApiKey: typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '',
        doubaoApiKey: typeof parsed.doubaoApiKey === 'string' ? parsed.doubaoApiKey : '',
      })
    }
    return {
      deepseekApiKey: typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '',
      doubaoApiKey: typeof parsed.doubaoApiKey === 'string' ? parsed.doubaoApiKey : '',
    }
  }

  private async writeSecrets(secrets: Partial<Record<SecretKey, string>>): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('macOS 钥匙串当前不可用，无法安全保存 API Key')
    }
    const encrypted = (await safeStorage.encryptStringAsync(JSON.stringify(secrets))).toString('base64')
    await writeFile(this.secretsPath, JSON.stringify({ version: 1, encrypted }), { mode: 0o600 })
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('本机设置尚未加载，请稍后重试')
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return value === 'disabled' || value === 'low' || value === 'high' || value === 'max'
}
