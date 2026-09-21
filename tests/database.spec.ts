import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../src/main/storage/database'

const databases: Array<{ database: LocalDatabase; directory: string }> = []

afterEach(() => {
  for (const { database, directory } of databases.splice(0)) {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * 只留迁移测试。迁移会重建用户的表，写错了就是真丢数据，
 * 而且「老结构长什么样」在代码里只看得到一半（另一半是历史版本），
 * 属于读代码验证不了的逻辑。普通增删改查不在这里重复覆盖。
 *
 * 下面「轮次快照」那组算例外：它的保证只存在于表结构里（记录表不引用档案表），
 * 没有哪一行代码写着这件事，不钉住就可能被顺手改成 join。
 */
describe('旧结构迁移', () => {
  it('把档案上的简历提成库文档，并按正文去重', () => {
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
    expect(first.resume?.content).toBe('同一份简历')
    expect(first.resume?.id).toBe(second.resume?.id)
    expect(first.documents[0].libraryDocumentId).toBe(second.documents[0].libraryDocumentId)
    // 简历和笔记在库里各一条，分类也跟着分开了
    expect(first.resume?.category).toBe('resume')
    expect(database.listLibraryDocuments().map((item) => item.category).sort())
      .toEqual(['document', 'resume'])
  })

  it('给旧库的文档补 category：按简历引用回填，引用已断的靠文件名兜底', () => {
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
        ('r1', '简历', 'text', '被引用的简历', '2026-01-01', '2026-01-01');
      INSERT INTO library_documents VALUES
        ('r2', '简历', 'text', '没人引用的简历', '2026-01-01', '2026-01-01');
      INSERT INTO library_documents VALUES
        ('d1', 'notes.md', 'markdown', '笔记正文', '2026-01-01', '2026-01-01');
      INSERT INTO library_documents VALUES
        ('d2', '简历.pdf', 'pdf', '名字像简历但类型不符', '2026-01-01', '2026-01-01');
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
    // 被引用的算简历
    expect(categories.get('r1')).toBe('resume')
    // 引用断了，靠迁移时那个确切的「简历 / text」组合兜底
    expect(categories.get('r2')).toBe('resume')
    // 名字像但类型不符的不认
    expect(categories.get('d2')).toBe('document')
    expect(categories.get('d1')).toBe('document')
    // 回填只动分类，原有引用照旧
    expect(database.getPreparation('p1')?.resume?.id).toBe('r1')
    expect(database.getPreparation('p1')?.documents[0].libraryDocumentId).toBe('d1')
  })

  it('给老档案补 stage 列，一律按未设置处理', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-stage-test-'))
    const path = join(directory, 'vocue.sqlite3')

    const older = new DatabaseSync(path)
    older.exec(`
      CREATE TABLE preparations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        job_description TEXT NOT NULL DEFAULT '',
        resume_document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO preparations VALUES
        ('p1', '老档案', 'JD', NULL, '2026-01-01', '2026-01-01');
    `)
    older.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    // 不猜轮次：老档案一律未设置，推进与否由用户决定
    expect(database.listPreparations()[0]).toMatchObject({ name: '老档案', stage: null })
  })

  it('给老记录补 incomplete_reason 列，历史值保持为空', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-reason-test-'))
    const path = join(directory, 'vocue.sqlite3')

    const older = new DatabaseSync(path)
    older.exec(`
      CREATE TABLE interview_sessions (
        id TEXT PRIMARY KEY,
        preparation_id TEXT,
        preparation_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        review_markdown TEXT NOT NULL DEFAULT '',
        review_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO interview_sessions VALUES
        ('s1', NULL, '老记录', 'incomplete', '2026-01-01', '2026-01-01', 1000, '', '', '2026-01-01', '2026-01-01');
    `)
    older.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    // 当时为什么断的已无从考证：保持 null，界面给笼统说法，不编一个具体的
    expect(database.getInterviewSession('s1')).toMatchObject({
      status: 'incomplete',
      incompleteReason: null,
    })
  })

  it('给老记录补 stage 列，历史值保持为空', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-record-stage-test-'))
    const path = join(directory, 'vocue.sqlite3')

    const older = new DatabaseSync(path)
    older.exec(`
      CREATE TABLE interview_sessions (
        id TEXT PRIMARY KEY,
        preparation_id TEXT,
        preparation_name TEXT NOT NULL,
        status TEXT NOT NULL,
        incomplete_reason TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        review_markdown TEXT NOT NULL DEFAULT '',
        review_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO interview_sessions VALUES
        ('s1', 'p1', '老记录', 'ready', NULL, '2026-01-01', '2026-01-01', 1000, '', '', '2026-01-01', '2026-01-01');
    `)
    older.close()

    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    // 建记录时没抄轮次。档案上的 stage 表示「下一场是第几面」，面完一场就会推进一轮，
    // 照它回填只会把历史记录填成今天这一轮
    expect(database.getInterviewSession('s1')).toMatchObject({ stage: null })
  })
})

/**
 * 轮次快照的保证不在任何一行代码里：它靠的是记录表不引用档案表
 * （没有外键，也不做 join）。一旦有人改成「显示时去档案查当前轮次」，
 * 历史记录会被追溯改写成新一轮，而读代码看不出差别，所以在这里钉住。
 */
describe('面试记录的轮次快照', () => {
  it('档案推进到下一面，已有记录的轮次不变', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vocue-record-stage-snapshot-'))
    const path = join(directory, 'vocue.sqlite3')
    const database = new LocalDatabase(path)
    databases.push({ database, directory })

    const preparation = database.savePreparation({
      name: '字节后端',
      jobDescription: 'JD',
      stage: 1,
      resumeDocumentId: null,
      documentIds: [],
    })
    const record = database.createInterviewSession({
      preparationId: preparation.id,
      preparationName: preparation.name,
      stage: preparation.stage,
    })
    expect(record.stage).toBe(1)

    // 面完点了「进入下一面」：档案变了，这场记录仍然是一面
    database.setPreparationStage(preparation.id, 2)
    expect(database.getInterviewSession(record.id)?.stage).toBe(1)
    expect(database.listInterviewSessions()[0].stage).toBe(1)
  })
})
