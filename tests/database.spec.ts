import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../src/main/storage/database'
import { planEchoCleanup } from '../src/main/session/echo-cleanup'

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

describe('LocalDatabase.savePreparation', () => {
  it('按 id 更新档案并整份替换补充资料', () => {
    const database = createDatabase()
    const created = database.savePreparation({
      name: '旧名称',
      jobDescription: '旧 JD',
      resume: '简历',
      documents: [{ filename: 'notes.md', kind: 'markdown', content: '补充资料' }],
    })

    const updated = database.savePreparation({
      id: created.id,
      name: '新名称',
      jobDescription: '新 JD',
      resume: '简历',
      documents: [],
    })

    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('新名称')
    expect(updated.jobDescription).toBe('新 JD')
    expect(updated.documents).toEqual([])
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('列表返回每份档案的补充资料数量', () => {
    const database = createDatabase()
    database.savePreparation({
      name: '档案',
      jobDescription: '',
      resume: '',
      documents: [
        { filename: 'a.md', kind: 'markdown', content: 'A' },
        { filename: 'b.md', kind: 'markdown', content: 'B' },
      ],
    })

    expect(database.listPreparations()[0]).toMatchObject({ name: '档案', documentCount: 2 })
  })
})

describe('LocalDatabase 面试记录', () => {
  it('保存双方终稿、时间点和复盘结果', () => {
    const database = createDatabase()
    const record = database.createInterviewSession({
      preparationId: null,
      preparationName: '通用面试',
    })

    database.appendInterviewUtterance({
      sessionId: record.id,
      role: 'interviewer',
      text: '请介绍一下自己。',
      startMs: 1200,
      endMs: 2600,
    })
    database.appendInterviewUtterance({
      sessionId: record.id,
      role: 'candidate',
      text: '我是一名前端工程师。',
      startMs: 3000,
      endMs: 5200,
    })
    database.finishInterviewSession(record.id)
    database.setInterviewReviewState(record.id, 'completed', '# 面试复盘\n表现稳定')

    expect(database.listInterviewSessions()[0]).toMatchObject({
      id: record.id,
      status: 'completed',
      utteranceCount: 2,
      hasReview: true,
    })
    expect(database.getInterviewSession(record.id)).toMatchObject({
      reviewMarkdown: '# 面试复盘\n表现稳定',
      utterances: [
        { role: 'interviewer', startMs: 1200, endMs: 2600 },
        { role: 'candidate', startMs: 3000, endMs: 5200 },
      ],
    })
  })

  it('重新打开数据库时把未正常结束的记录标为不完整', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-database-recovery-test-'))
    const path = join(directory, 'vocue.sqlite3')
    const first = new LocalDatabase(path)
    const record = first.createInterviewSession({ preparationId: null, preparationName: '异常退出' })
    first.close()

    const recovered = new LocalDatabase(path)
    databases.push({ database: recovered, directory })

    expect(recovered.getInterviewSession(record.id)?.status).toBe('incomplete')
    expect(recovered.getInterviewSession(record.id)?.endedAt).not.toBeNull()
  })

  it('清理结果独立保存并且可以撤销，不修改原始转写', () => {
    const database = createDatabase()
    const record = database.createInterviewSession({ preparationId: null, preparationName: '外放测试' })
    database.appendInterviewUtterance({
      sessionId: record.id,
      role: 'interviewer',
      text: '请介绍一下自己。',
      startMs: 1000,
      endMs: 2500,
    })
    database.appendInterviewUtterance({
      sessionId: record.id,
      role: 'candidate',
      text: '请介绍一下自己。',
      startMs: 1200,
      endMs: 2700,
    })
    database.finishInterviewSession(record.id)

    const raw = database.getInterviewSession(record.id)!
    const cleaned = database.applyEchoCleanup(record.id, planEchoCleanup(raw.utterances))
    expect(cleaned.echoCleanupApplied).toBe(true)
    expect(cleaned.echoRemovedCount).toBe(1)
    expect(cleaned.utterances[1]).toMatchObject({
      text: '请介绍一下自己。',
      excludedAsEcho: true,
    })

    const restored = database.undoEchoCleanup(record.id)
    expect(restored.echoCleanupApplied).toBe(false)
    expect(restored.utterances[1]).toMatchObject({
      text: '请介绍一下自己。',
      excludedAsEcho: false,
    })
  })
})
