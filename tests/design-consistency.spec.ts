import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : [path]
  }).filter((path) => /\.tsx?$/.test(path))
}

const sources = sourceFiles(SRC).map((path) => ({
  name: path.slice(SRC.length + 1),
  text: readFileSync(path, 'utf8'),
}))

/**
 * 设计一致性靠机制守，不靠记性。
 * 这里的规则都是「同一件事只能有一种做法」，写错就直接挂测试。
 */
describe('设计一致性', () => {
  it('不出现原生弹窗：确认一律走 ConfirmDialog', () => {
    const offenders = sources
      // 注释里提到 window.confirm 不算违规，只查真实调用
      .filter((source) => /window\.(confirm|alert|prompt)\s*\(/.test(source.text))
      .map((source) => source.name)

    expect(offenders).toEqual([])
  })

  it('应用内确认框只有 ConfirmDialog 一处实现，别处不许自己拼一套', () => {
    const implementors = sources
      .filter((source) => source.text.includes('confirm-backdrop') || source.text.includes('confirm-card'))
      .map((source) => basename(source.name))

    expect(implementors).toEqual(['ConfirmDialog.tsx'])
  })
})
