import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'
import type { AppSettings, PublicSettings, ThemeMode } from '../../shared/types'
import { LocalDatabase } from './database'

const DEFAULTS: AppSettings = {
  deepseekApiKey: '',
  doubaoApiKey: '',
  hideFromScreenCapture: false,
  theme: 'system',
}

const SECRET_KEYS = ['deepseekApiKey', 'doubaoApiKey'] as const

type SecretKey = (typeof SECRET_KEYS)[number]

export class SettingsStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly secretsPath: string,
  ) {}

  get(): AppSettings {
    const secrets = this.readSecrets()
    const storedTheme = this.database.getSetting('theme')
    return {
      ...DEFAULTS,
      ...secrets,
      hideFromScreenCapture: this.database.getSetting('hideFromScreenCapture') === 'true',
      theme: isThemeMode(storedTheme) ? storedTheme : 'system',
    }
  }

  getPublic(): PublicSettings {
    const settings = this.get()
    return {
      hasDeepseekApiKey: Boolean(settings.deepseekApiKey),
      hasDoubaoApiKey: Boolean(settings.doubaoApiKey),
      hideFromScreenCapture: settings.hideFromScreenCapture,
      theme: settings.theme,
    }
  }

  save(input: Partial<AppSettings>): PublicSettings {
    const secrets = this.readSecrets()
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
    if (secretsChanged) this.writeSecrets(secrets)
    return this.getPublic()
  }

  isReady(): boolean {
    const settings = this.get()
    return Boolean(settings.deepseekApiKey && settings.doubaoApiKey)
  }

  private readSecrets(): Partial<Record<SecretKey, string>> {
    if (!existsSync(this.secretsPath)) return {}
    try {
      const envelope = JSON.parse(readFileSync(this.secretsPath, 'utf8')) as { encrypted: string }
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))
      const parsed = JSON.parse(decrypted) as Record<string, unknown>
      return {
        deepseekApiKey: typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '',
        doubaoApiKey: typeof parsed.doubaoApiKey === 'string' ? parsed.doubaoApiKey : '',
      }
    } catch {
      return {}
    }
  }

  private writeSecrets(secrets: Partial<Record<SecretKey, string>>): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS 钥匙串当前不可用，无法安全保存 API Key')
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    writeFileSync(this.secretsPath, JSON.stringify({ version: 1, encrypted }), { mode: 0o600 })
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}
