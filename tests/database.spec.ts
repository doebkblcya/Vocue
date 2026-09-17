import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../src/main/storage/database'
import type { PreparationAnalysis } from '../src/shared/types'

const databases: Array<{ database: LocalDatabase; directory: string }> = []

afterEach(() => {
  for (const { database, directory } of databases.splice(0)) {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

function createDatabase(): LocalDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'vocue-database-test-'))
  const database = new LocalDatabase(join(directory, 'vocue.sqlite3'))
  databases.push({ database, directory })
  return database
}

const analysis: PreparationAnalysis = {
  overview: '匹配',
  keyRequirements: ['TypeScript'],
  candidateStrengths: ['Electron'],
  risks: [],
  answerStrategy: ['先给结论'],
}

describe('LocalDatabase.savePreparation', () => {
  it('只修改档案名称时保留已有分析', () => {
    const database = createDatabase()
    const created = database.savePreparation({
      name: '旧名称',
      jobDescription: 'JD',
      resume: '简历',
      documents: [{ filename: 'notes.md', kind: 'markdown', content: '补充资料' }],
    })
    database.saveAnalysis(created.id, analysis, '旧提示词快照')

    const renamed = database.savePreparation({
      id: created.id,
      name: '新名称',
      jobDescription: 'JD',
      resume: '简历',
      documents: [{ filename: 'notes.md', kind: 'markdown', content: '补充资料' }],
    })

    expect(renamed.name).toBe('新名称')
    expect(renamed.analysis).toEqual(analysis)
    expect(renamed.systemPrompt).toBe('旧提示词快照')
  })

  it('修改面试资料时使旧分析失效', () => {
    const database = createDatabase()
    const created = database.savePreparation({
      name: '档案',
      jobDescription: '旧 JD',
      resume: '简历',
      documents: [],
    })
    database.saveAnalysis(created.id, analysis, '旧提示词快照')

    const updated = database.savePreparation({
      id: created.id,
      name: '档案',
      jobDescription: '新 JD',
      resume: '简历',
      documents: [],
    })

    expect(updated.analysis).toBeNull()
    expect(updated.systemPrompt).toBe('')
  })
})
