import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

describe('LocalDatabase 文档库与档案引用', () => {
  it('档案只按 id 引用库文档，同内容在库里只有一份', () => {
    const database = createDatabase()
    const resume = database.addLibraryDocument({
      filename: '简历.md', kind: 'markdown', content: '一份简历',
    }, 'resume')
    const notes = database.addLibraryDocument({
      filename: 'notes.md', kind: 'markdown', content: '补充资料',
    }, 'document')

    const first = database.savePreparation({
      name: '岗位 A',
      jobDescription: 'JD A',
      resumeDocumentId: resume.id,
      documentIds: [notes.id],
    })
    const second = database.savePreparation({
      name: '岗位 B',
      jobDescription: 'JD B',
      resumeDocumentId: resume.id,
      documentIds: [],
    })

    expect(first.resume?.id).toBe(resume.id)
    expect(first.resume?.content).toBe('一份简历')
    expect(first.documents.map((item) => item.libraryDocumentId)).toEqual([notes.id])
    // 两份档案共用同一份简历，库里仍然只有两条文档
    expect(second.resume?.id).toBe(resume.id)
    expect(database.listLibraryDocuments()).toHaveLength(2)
  })

  it('按 id 更新档案并整份替换补充资料', () => {
    const database = createDatabase()
    const notes = database.addLibraryDocument({
      filename: 'notes.md', kind: 'markdown', content: '补充资料',
    }, 'document')
    const created = database.savePreparation({
      name: '旧名称',
      jobDescription: '旧 JD',
      resumeDocumentId: null,
      documentIds: [notes.id],
    })

    const updated = database.savePreparation({
      id: created.id,
      name: '新名称',
      jobDescription: '新 JD',
      resumeDocumentId: null,
      documentIds: [],
    })

    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('新名称')
    expect(updated.jobDescription).toBe('新 JD')
    expect(updated.documents).toEqual([])
    expect(updated.createdAt).toBe(created.createdAt)
    // 解除引用不应该把库文档本身删掉
    expect(database.listLibraryDocuments()).toHaveLength(1)
  })

  it('删掉库文档时档案里的引用自动摘掉', () => {
    const database = createDatabase()
    const resume = database.addLibraryDocument({
      filename: '简历.md', kind: 'markdown', content: '一份简历',
    }, 'resume')
    const notes = database.addLibraryDocument({
      filename: 'notes.md', kind: 'markdown', content: '补充资料',
    }, 'document')
    const created = database.savePreparation({
      name: '岗位',
      jobDescription: '',
      resumeDocumentId: resume.id,
      documentIds: [notes.id],
    })

    database.removeLibraryDocument(notes.id)
    database.removeLibraryDocument(resume.id)

    const after = database.getPreparation(created.id)!
    expect(after.resume).toBeNull()
    expect(after.documents).toEqual([])
  })

  it('列表返回补充资料数量与是否选了简历', () => {
    const database = createDatabase()
    const resume = database.addLibraryDocument({
      filename: '简历.md', kind: 'markdown', content: '简历',
    }, 'resume')
    database.savePreparation({
      name: '档案',
      jobDescription: '',
      resumeDocumentId: resume.id,
      documentIds: [
        database.addLibraryDocument({ filename: 'a.md', kind: 'markdown', content: 'A' }, 'document').id,
        database.addLibraryDocument({ filename: 'b.md', kind: 'markdown', content: 'B' }, 'document').id,
      ],
    })

    expect(database.listPreparations()[0]).toMatchObject({
      name: '档案',
      documentCount: 2,
      hasResume: true,
    })
  })

  it('库文档保存全文，不做任何截断', () => {
    const database = createDatabase()
    const saved = database.addLibraryDocument({
      filename: 'long.txt', kind: 'text', content: 'x'.repeat(200_000),
    }, 'document')

    expect(saved.content).toHaveLength(200_000)
    expect(database.listLibraryDocuments()[0].totalChars).toBe(200_000)
  })

  it('简历与文档分开归类，同内容的简历不会被并进补充资料', () => {
    const database = createDatabase()
    const content = '同一段正文'
    const resume = database.addLibraryDocument({ filename: '简历', kind: 'text', content }, 'resume')
    const material = database.addLibraryDocument(
      { filename: '笔记.md', kind: 'markdown', content },
      'document',
    )

    expect(resume.category).toBe('resume')
    expect(material.category).toBe('document')
    expect(database.getLibraryDocument(resume.id)?.category).toBe('resume')
    expect(
      database.listLibraryDocuments().map((item) => item.category).sort(),
    ).toEqual(['document', 'resume'])
  })
})

describe('旧数据库迁移到文档库', () => {
  it('把简历和文档提成库文档，并按正文去重', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-migration-test-'))
    const path = join(directory, 'vocue.sqlite3')

    // 手工造一个旧结构：简历挂在档案上，文档正文复制在每份档案下
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE preparations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        job_description TEXT NOT NULL DEFAULT '',
        resume TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE preparation_documents (
        id TEXT PRIMARY KEY,
        preparation_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO preparations VALUES
        ('p1', '岗位 A', 'JD A', '同一份简历', '2026-01-01', '2026-01-01');
      INSERT INTO preparations VALUES
        ('p2', '岗位 B', 'JD B', '同一份简历', '2026-01-01', '2026-01-01');
      INSERT INTO preparation_documents VALUES
        ('d1', 'p1', 'notes.md', 'markdown', '同一份笔记', 0, '2026-01-01');
      INSERT INTO preparation_documents VALUES
        ('d2', 'p2', 'notes.md', 'markdown', '同一份笔记', 0, '2026-01-01');
    `)
    legacy.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    // 两份档案共用同一份简历和同一份笔记：库里只应该出现两条
    expect(database.listLibraryDocuments()).toHaveLength(2)

    const first = database.getPreparation('p1')!
    const second = database.getPreparation('p2')!
    expect(first.name).toBe('岗位 A')
    expect(first.jobDescription).toBe('JD A')
    expect(first.resume?.content).toBe('同一份简历')
    expect(first.resume?.id).toBe(second.resume?.id)
    expect(first.documents[0].libraryDocumentId).toBe(second.documents[0].libraryDocumentId)

    // 简历和笔记在库里各一条，分类也跟着分开了
    expect(first.resume?.category).toBe('resume')
    expect(
      database.listLibraryDocuments().map((item) => item.category).sort(),
    ).toEqual(['document', 'resume'])
  })
})

describe('文档库补上分类', () => {
  it('给旧库里的简历按引用关系回填分类', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-category-test-'))
    const path = join(directory, 'vocue.sqlite3')

    // 上一版的库：文档表还没有 category 列
    const older = new DatabaseSync(path)
    older.exec(`
      CREATE TABLE library_documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE preparations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        job_description TEXT NOT NULL DEFAULT '',
        resume_document_id TEXT REFERENCES library_documents(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE preparation_documents (
        id TEXT PRIMARY KEY,
        preparation_id TEXT NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
        library_document_id TEXT NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO library_documents VALUES
        ('r1', '简历', 'text', '简历正文', '2026-01-01', '2026-01-01');
      INSERT INTO library_documents VALUES
        ('d1', 'notes.md', 'markdown', '笔记正文', '2026-01-01', '2026-01-01');
      INSERT INTO preparations VALUES
        ('p1', '岗位', 'JD', 'r1', '2026-01-01', '2026-01-01');
      INSERT INTO preparation_documents VALUES
        ('l1', 'p1', 'd1', 0, '2026-01-01');
    `)
    older.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    const categories = new Map(
      database.listLibraryDocuments().map((item) => [item.id, item.category]),
    )
    expect(categories.get('r1')).toBe('resume')
    expect(categories.get('d1')).toBe('document')
    // 回填只动分类，原有引用照旧
    expect(database.getPreparation('p1')?.resume?.id).toBe('r1')
    expect(database.getPreparation('p1')?.documents[0].libraryDocumentId).toBe('d1')
  })

  it('引用已断的旧简历靠迁移时的文件名兜底', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-category-orphan-test-'))
    const path = join(directory, 'vocue.sqlite3')

    const older = new DatabaseSync(path)
    older.exec(`
      CREATE TABLE library_documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO library_documents VALUES
        ('r1', '简历', 'text', '没人引用的简历', '2026-01-01', '2026-01-01');
      INSERT INTO library_documents VALUES
        ('d1', '简历.pdf', 'pdf', '名字像简历但类型不符', '2026-01-01', '2026-01-01');
    `)
    older.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    const categories = new Map(
      database.listLibraryDocuments().map((item) => [item.id, item.category]),
    )
    expect(categories.get('r1')).toBe('resume')
    // 兜底只认迁移时那个确切的「简历 / text」组合
    expect(categories.get('d1')).toBe('document')
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
