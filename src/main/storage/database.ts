import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  DocumentKind,
  ExtractedDocument,
  LibraryCategory,
  LibraryDocument,
  LibraryDocumentSummary,
  Preparation,
  PreparationSummary,
  InterviewRecord,
  InterviewRecordStatus,
  InterviewRecordSummary,
  InterviewRole,
  InterviewStage,
} from '../../shared/types'
import type { EchoCleanupPlan } from '../session/echo-cleanup'
import type { RecordingIssue } from '../../shared/recording-issue'

interface PreparationRow {
  id: string
  name: string
  job_description: string
  stage: number | null
  resume_document_id: string | null
  created_at: string
  updated_at: string
}

interface LibraryRow {
  id: string
  filename: string
  kind: DocumentKind
  category: LibraryCategory
  content: string
  created_at: string
  updated_at: string
}

/** 档案引用的库文档：filename / kind / content 由库解析后带出 */
interface PreparationDocumentRow {
  link_id: string
  preparation_id: string
  library_document_id: string
  position: number
  created_at: string
  filename: string
  kind: DocumentKind
  content: string
}

export class LocalDatabase {
  private readonly db: DatabaseSync

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'document',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preparations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        job_description TEXT NOT NULL DEFAULT '',
        stage INTEGER,
        resume_document_id TEXT REFERENCES library_documents(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preparation_documents (
        id TEXT PRIMARY KEY,
        preparation_id TEXT NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
        library_document_id TEXT NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_preparation
        ON preparation_documents(preparation_id, position);
      CREATE TABLE IF NOT EXISTS interview_sessions (
        id TEXT PRIMARY KEY,
        preparation_id TEXT,
        preparation_name TEXT NOT NULL,
        stage INTEGER,
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
      CREATE TABLE IF NOT EXISTS interview_utterances (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_interview_utterances_session
        ON interview_utterances(session_id, sequence);
      CREATE TABLE IF NOT EXISTS interview_transcript_cleanups (
        session_id TEXT PRIMARY KEY REFERENCES interview_sessions(id) ON DELETE CASCADE,
        removed_count INTEGER NOT NULL DEFAULT 0,
        changed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interview_utterance_edits (
        utterance_id TEXT PRIMARY KEY REFERENCES interview_utterances(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        cleaned_text TEXT,
        excluded_as_echo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_interview_utterance_edits_session
        ON interview_utterance_edits(session_id);
    `)
    this.migrateToDocumentLibrary()
    this.migrateLibraryCategories()
    this.migratePreparationStage()
    this.migrateIncompleteReason()
    this.migrateInterviewStage()
    const recoveredAt = new Date().toISOString()
    this.db.prepare(`
      UPDATE interview_sessions
      SET status = 'incomplete',
          incomplete_reason = COALESCE(incomplete_reason, 'app_terminated'),
          ended_at = COALESCE(ended_at, ?),
          duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
          updated_at = ?
      WHERE status = 'recording'
    `).run(recoveredAt, recoveredAt, recoveredAt)
  }

  close(): void {
    this.db.close()
  }

  private columnNames(table: string): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  /**
   * 把「简历挂在档案上、文档正文复制在每个档案下」的旧结构，
   * 迁移成「文档库存一份、档案按 id 引用」。
   *
   * 旧结构下海投 N 个岗位，同一份简历就在库里存了 N 份。
   * 迁移时按正文去重，所以迁移完成的那一刻重复就消掉了。
   * interview_* 那几张表不受影响。
   */
  private migrateToDocumentLibrary(): void {
    const needsPreparationRebuild = this.columnNames('preparations').includes('resume')
    const needsDocumentRebuild = this.columnNames('preparation_documents').includes('content')
    if (!needsPreparationRebuild && !needsDocumentRebuild) return

    // 重建会先 DROP 原表，所以数据要先整份读进内存
    const legacyPreparations = needsPreparationRebuild
      ? this.db
          .prepare('SELECT id, name, job_description, resume, created_at, updated_at FROM preparations')
          .all() as Array<{
          id: string
          name: string
          job_description: string
          resume: string
          created_at: string
          updated_at: string
        }>
      : []
    const legacyDocuments = needsDocumentRebuild
      ? this.db
          .prepare(`
            SELECT preparation_id, filename, kind, content, position, created_at
            FROM preparation_documents
            ORDER BY preparation_id, position
          `)
          .all() as Array<{
          preparation_id: string
          filename: string
          kind: DocumentKind
          content: string
          position: number
          created_at: string
        }>
      : []

    const now = new Date().toISOString()
    const libraryIdByContent = new Map<string, string>()
    const pendingLibrary: Array<{
      id: string
      filename: string
      kind: DocumentKind
      category: LibraryCategory
      content: string
    }> = []
    const ensureLibraryDocument = (
      filename: string,
      kind: DocumentKind,
      content: string,
      category: LibraryCategory,
    ): string => {
      // 同一份正文在不同分类下是两份文档，别把简历并进补充资料里
      const key = `${category}\u0000${content}`
      const existing = libraryIdByContent.get(key)
      if (existing) return existing
      const id = randomUUID()
      libraryIdByContent.set(key, id)
      pendingLibrary.push({ id, filename, kind, category, content })
      return id
    }

    const resumeIdByPreparation = new Map<string, string>()
    for (const row of legacyPreparations) {
      const content = row.resume.trim()
      if (!content) continue
      resumeIdByPreparation.set(row.id, ensureLibraryDocument('简历', 'text', content, 'resume'))
    }
    const links = legacyDocuments.map((row) => ({
      preparationId: row.preparation_id,
      libraryDocumentId: ensureLibraryDocument(row.filename, row.kind, row.content, 'document'),
      position: row.position,
      createdAt: row.created_at,
    }))

    // 重建父子表时必须关掉外键，否则 DROP preparations 会级联删掉子表数据
    this.db.exec('PRAGMA foreign_keys = OFF;')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const insertLibrary = this.db.prepare(`
        INSERT INTO library_documents(id, filename, kind, category, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const document of pendingLibrary) {
        insertLibrary.run(
          document.id,
          document.filename,
          document.kind,
          document.category,
          document.content,
          now,
          now,
        )
      }

      if (needsPreparationRebuild) {
        this.db.exec(`
          DROP TABLE preparations;
          CREATE TABLE preparations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            job_description TEXT NOT NULL DEFAULT '',
            stage INTEGER,
            resume_document_id TEXT REFERENCES library_documents(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `)
        const insertPreparation = this.db.prepare(`
          INSERT INTO preparations(id, name, job_description, stage, resume_document_id, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?)
        `)
        for (const row of legacyPreparations) {
          insertPreparation.run(
            row.id,
            row.name,
            row.job_description,
            resumeIdByPreparation.get(row.id) ?? null,
            row.created_at,
            row.updated_at,
          )
        }
      }

      if (needsDocumentRebuild) {
        this.db.exec(`
          DROP TABLE preparation_documents;
          CREATE TABLE preparation_documents (
            id TEXT PRIMARY KEY,
            preparation_id TEXT NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
            library_document_id TEXT NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_documents_preparation
            ON preparation_documents(preparation_id, position);
        `)
        const insertLink = this.db.prepare(`
          INSERT INTO preparation_documents(
            id, preparation_id, library_document_id, position, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `)
        for (const link of links) {
          insertLink.run(randomUUID(), link.preparationId, link.libraryDocumentId, link.position, link.createdAt)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;')
    }
  }

  /**
   * 文档库分「简历 / 文档」两类。
   *
   * 旧版本的库是一个大列表，简历只能靠「被档案当简历引用」来认。
   * 建列时按这个引用关系回填；引用已经断掉的（用户在档案里取消过选择）
   * 用迁移时统一起的文件名兜底。
   */
  private migrateLibraryCategories(): void {
    if (this.columnNames('library_documents').includes('category')) return
    this.db.exec(
      `ALTER TABLE library_documents ADD COLUMN category TEXT NOT NULL DEFAULT 'document'`,
    )
    this.db.exec(`
      UPDATE library_documents SET category = 'resume'
      WHERE id IN (SELECT resume_document_id FROM preparations WHERE resume_document_id IS NOT NULL)
         OR (filename = '简历' AND kind = 'text')
    `)
  }

  /** 面试阶段是后加的列：老档案一律先按「未设置」处理，不猜轮次 */
  private migratePreparationStage(): void {
    if (this.columnNames('preparations').includes('stage')) return
    this.db.exec('ALTER TABLE preparations ADD COLUMN stage INTEGER')
  }

  /**
   * 「不完整」的原因是后加的列。老记录保持 NULL——
   * 当时到底为什么断的已经无从考证，界面上给笼统说法，不编一个具体的。
   */
  private migrateIncompleteReason(): void {
    if (this.columnNames('interview_sessions').includes('incomplete_reason')) return
    this.db.exec('ALTER TABLE interview_sessions ADD COLUMN incomplete_reason TEXT')
  }

  /**
   * 面试记录的轮次也是后加的列，老记录一律保持 NULL。
   *
   * 不能拿档案当前的 stage 回填：档案上的 stage 表示「下一场是第几面」，
   * 面完一场就会推进一轮。照着它填，上周那一面会被写成今天这一轮，
   * 而且越往后越离谱。当时是第几面，只有用户自己知道。
   */
  private migrateInterviewStage(): void {
    if (this.columnNames('interview_sessions').includes('stage')) return
    this.db.exec('ALTER TABLE interview_sessions ADD COLUMN stage INTEGER')
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(key, value, new Date().toISOString())
  }

  listPreparations(): PreparationSummary[] {
    const rows = this.db
      .prepare(`
        SELECT p.id, p.name, p.stage, p.updated_at,
          CASE WHEN p.resume_document_id IS NULL THEN 0 ELSE 1 END AS has_resume,
          COUNT(d.id) AS document_count
        FROM preparations p
        LEFT JOIN preparation_documents d ON d.preparation_id = p.id
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `)
      .all() as Array<{
      id: string
      name: string
      stage: number | null
      updated_at: string
      has_resume: number
      document_count: number
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      stage: row.stage,
      updatedAt: row.updated_at,
      documentCount: Number(row.document_count),
      hasResume: Boolean(row.has_resume),
    }))
  }

  getPreparation(id: string): Preparation | null {
    const row = this.db.prepare('SELECT * FROM preparations WHERE id = ?').get(id) as
      | PreparationRow
      | undefined
    if (!row) return null

    const documents = this.db
      .prepare(`
        SELECT l.id AS link_id, l.preparation_id, l.library_document_id, l.position, l.created_at,
          d.filename, d.kind, d.content
        FROM preparation_documents l
        JOIN library_documents d ON d.id = l.library_document_id
        WHERE l.preparation_id = ?
        ORDER BY l.position
      `)
      .all(id) as unknown as PreparationDocumentRow[]

    return {
      id: row.id,
      name: row.name,
      jobDescription: row.job_description,
      stage: row.stage,
      resume: row.resume_document_id ? this.getLibraryDocument(row.resume_document_id) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      documents: documents.map((document) => ({
        id: document.link_id,
        preparationId: document.preparation_id,
        libraryDocumentId: document.library_document_id,
        filename: document.filename,
        kind: document.kind,
        content: document.content,
        position: document.position,
        createdAt: document.created_at,
      })),
    }
  }

  savePreparation(input: {
    id?: string
    name: string
    jobDescription: string
    stage: number | null
    resumeDocumentId: string | null
    documentIds: string[]
  }): Preparation {
    const existing = input.id ? this.getPreparation(input.id) : null
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(`
          INSERT INTO preparations(
            id, name, job_description, stage, resume_document_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            job_description = excluded.job_description,
            stage = excluded.stage,
            resume_document_id = excluded.resume_document_id,
            updated_at = excluded.updated_at
        `)
        .run(
          id,
          input.name.trim(),
          input.jobDescription,
          input.stage,
          input.resumeDocumentId,
          existing?.createdAt ?? now,
          now,
        )

      this.db.prepare('DELETE FROM preparation_documents WHERE preparation_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO preparation_documents(
          id, preparation_id, library_document_id, position, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      input.documentIds.forEach((libraryDocumentId, position) => {
        insert.run(randomUUID(), id, libraryDocumentId, position, now)
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return this.getPreparation(id) as Preparation
  }

  /**
   * 只动面试阶段。档案卡上「进入下一面」走的就是这条路，
   * 不必先把整份档案读出来再整份写回去。
   */
  setPreparationStage(id: string, stage: number | null): PreparationSummary {
    if (stage !== null && (!Number.isInteger(stage) || stage < 0)) {
      throw new Error('面试阶段不合法')
    }
    this.db
      .prepare('UPDATE preparations SET stage = ?, updated_at = ? WHERE id = ?')
      .run(stage, new Date().toISOString(), id)
    const summary = this.listPreparations().find((item) => item.id === id)
    if (!summary) throw new Error('档案不存在')
    return summary
  }

  removePreparation(id: string): void {
    this.db.prepare('DELETE FROM preparations WHERE id = ?').run(id)
  }

  listLibraryDocuments(): LibraryDocumentSummary[] {
    const rows = this.db
      .prepare(`
        SELECT id, filename, kind, category, updated_at, LENGTH(content) AS total_chars
        FROM library_documents
        ORDER BY updated_at DESC
      `)
      .all() as Array<{
      id: string
      filename: string
      kind: DocumentKind
      category: LibraryCategory
      updated_at: string
      total_chars: number
    }>

    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      category: row.category,
      updatedAt: row.updated_at,
      totalChars: Number(row.total_chars),
    }))
  }

  getLibraryDocument(id: string): LibraryDocument | null {
    const row = this.db.prepare('SELECT * FROM library_documents WHERE id = ?').get(id) as
      | LibraryRow
      | undefined
    if (!row) return null
    return {
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      category: row.category,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** 库里存全文，不做任何截断：超上限只是不进入提示词，由界面告知用户 */
  addLibraryDocument(input: ExtractedDocument, category: LibraryCategory): LibraryDocument {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(`
        INSERT INTO library_documents(id, filename, kind, category, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.filename, input.kind, category, input.content, now, now)
    return this.getLibraryDocument(id) as LibraryDocument
  }

  renameLibraryDocument(id: string, filename: string): LibraryDocument {
    const name = filename.trim()
    if (!name) throw new Error('文档名称不能为空')
    this.db
      .prepare('UPDATE library_documents SET filename = ?, updated_at = ? WHERE id = ?')
      .run(name, new Date().toISOString(), id)
    const result = this.getLibraryDocument(id)
    if (!result) throw new Error('文档不存在')
    return result
  }

  /** 删除库文档：档案里的引用会被外键自动摘掉或清空 */
  removeLibraryDocument(id: string): void {
    this.db.prepare('DELETE FROM library_documents WHERE id = ?').run(id)
  }

  /**
   * 建记录时把档案「那一刻」的轮次抄一份存进来，和 preparation_name 同理。
   *
   * 必须是抄，不能以后去档案里现查：档案会被推进到下一面，现查出来的值
   * 会把历史记录追溯改写成新一轮。
   */
  createInterviewSession(input: {
    preparationId: string | null
    preparationName: string
    stage: InterviewStage
  }): InterviewRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO interview_sessions(
        id, preparation_id, preparation_name, stage, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'recording', ?, ?, ?)
    `).run(id, input.preparationId, input.preparationName, input.stage, now, now, now)
    return this.getInterviewSession(id) as InterviewRecord
  }

  appendInterviewUtterance(input: {
    sessionId: string
    role: InterviewRole
    text: string
    startMs: number
    endMs: number
  }): void {
    const sequenceRow = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM interview_utterances WHERE session_id = ?
    `).get(input.sessionId) as { next_sequence: number }
    this.db.prepare(`
      INSERT INTO interview_utterances(
        id, session_id, sequence, role, text, start_ms, end_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.sessionId,
      Number(sequenceRow.next_sequence),
      input.role,
      input.text,
      Math.max(0, Math.round(input.startMs)),
      Math.max(0, Math.round(input.endMs)),
      new Date().toISOString(),
    )
  }

  finishInterviewSession(
    id: string,
    status: 'ready' | 'incomplete' = 'ready',
    issue: RecordingIssue | null = null,
  ): void {
    const row = this.db.prepare('SELECT started_at FROM interview_sessions WHERE id = ?').get(id) as
      | { started_at: string }
      | undefined
    if (!row) return
    const endedAt = new Date()
    const durationMs = Math.max(0, endedAt.getTime() - new Date(row.started_at).getTime())
    this.db.prepare(`
      UPDATE interview_sessions
      SET status = ?, incomplete_reason = ?, ended_at = ?, duration_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(status, status === 'incomplete' ? issue : null, endedAt.toISOString(), durationMs, endedAt.toISOString(), id)
  }

  /** 删除一场面试记录：utterance、清理结果、清理记录都由外键级联带走 */
  removeInterviewSession(id: string): void {
    this.db.prepare('DELETE FROM interview_sessions WHERE id = ?').run(id)
  }

  listInterviewSessions(): InterviewRecordSummary[] {
    const rows = this.db.prepare(`
      SELECT s.*, COUNT(u.id) AS utterance_count,
        CASE WHEN c.session_id IS NULL THEN 0 ELSE 1 END AS echo_cleanup_applied,
        COALESCE(c.removed_count, 0) AS echo_removed_count,
        COALESCE(c.changed_count, 0) AS echo_changed_count
      FROM interview_sessions s
      LEFT JOIN interview_utterances u ON u.session_id = s.id
      LEFT JOIN interview_transcript_cleanups c ON c.session_id = s.id
      GROUP BY s.id
      ORDER BY s.started_at DESC
    `).all() as unknown as Array<Record<string, unknown>>
    return rows.map((row) => this.mapInterviewSummary(row))
  }

  getInterviewSession(id: string): InterviewRecord | null {
    const row = this.db.prepare(`
      SELECT s.*, COUNT(u.id) AS utterance_count,
        CASE WHEN c.session_id IS NULL THEN 0 ELSE 1 END AS echo_cleanup_applied,
        COALESCE(c.removed_count, 0) AS echo_removed_count,
        COALESCE(c.changed_count, 0) AS echo_changed_count
      FROM interview_sessions s
      LEFT JOIN interview_utterances u ON u.session_id = s.id
      LEFT JOIN interview_transcript_cleanups c ON c.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const utterances = this.db.prepare(`
      SELECT u.*, e.cleaned_text, COALESCE(e.excluded_as_echo, 0) AS excluded_as_echo
      FROM interview_utterances u
      LEFT JOIN interview_utterance_edits e ON e.utterance_id = u.id
      WHERE u.session_id = ?
      ORDER BY u.start_ms, u.sequence
    `).all(id) as unknown as Array<Record<string, unknown>>
    return {
      ...this.mapInterviewSummary(row),
      reviewMarkdown: String(row.review_markdown ?? ''),
      reviewError: String(row.review_error ?? ''),
      utterances: utterances.map((utterance) => ({
        id: String(utterance.id),
        sessionId: String(utterance.session_id),
        sequence: Number(utterance.sequence),
        role: utterance.role as InterviewRole,
        text: String(utterance.text),
        cleanedText: utterance.cleaned_text === null || utterance.cleaned_text === undefined
          ? null
          : String(utterance.cleaned_text),
        excludedAsEcho: Boolean(utterance.excluded_as_echo),
        startMs: Number(utterance.start_ms),
        endMs: Number(utterance.end_ms),
        createdAt: String(utterance.created_at),
      })),
    }
  }

  applyEchoCleanup(id: string, plan: EchoCleanupPlan): InterviewRecord {
    if (!this.getInterviewSession(id)) throw new Error('面试记录不存在')
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM interview_utterance_edits WHERE session_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO interview_utterance_edits(
          utterance_id, session_id, cleaned_text, excluded_as_echo, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      for (const edit of plan.edits) {
        insert.run(
          edit.utteranceId,
          id,
          edit.cleanedText,
          edit.excludedAsEcho ? 1 : 0,
          now,
        )
      }
      this.db.prepare(`
        INSERT INTO interview_transcript_cleanups(
          session_id, removed_count, changed_count, created_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          removed_count = excluded.removed_count,
          changed_count = excluded.changed_count,
          created_at = excluded.created_at
      `).run(id, plan.removedCount, plan.changedCount, now)
      this.db.prepare(`
        UPDATE interview_sessions
        SET review_error = CASE
          WHEN review_markdown <> '' THEN '文字记录已调整，建议重新生成复盘'
          ELSE review_error
        END,
        updated_at = ?
        WHERE id = ?
      `).run(now, id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getInterviewSession(id) as InterviewRecord
  }

  undoEchoCleanup(id: string): InterviewRecord {
    if (!this.getInterviewSession(id)) throw new Error('面试记录不存在')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM interview_utterance_edits WHERE session_id = ?').run(id)
      this.db.prepare('DELETE FROM interview_transcript_cleanups WHERE session_id = ?').run(id)
      this.db.prepare(`
        UPDATE interview_sessions
        SET review_error = CASE
          WHEN review_markdown <> '' THEN '文字记录已恢复为原稿，建议重新生成复盘'
          ELSE review_error
        END,
        updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getInterviewSession(id) as InterviewRecord
  }

  setInterviewReviewState(
    id: string,
    status: 'reviewing' | 'completed' | 'ready' | 'incomplete',
    reviewMarkdown = '',
    reviewError = '',
  ): void {
    this.db.prepare(`
      UPDATE interview_sessions
      SET status = ?, review_markdown = ?, review_error = ?, updated_at = ?
      WHERE id = ?
    `).run(status, reviewMarkdown, reviewError, new Date().toISOString(), id)
  }

  private mapInterviewSummary(row: Record<string, unknown>): InterviewRecordSummary {
    return {
      id: String(row.id),
      preparationId: row.preparation_id ? String(row.preparation_id) : null,
      preparationName: String(row.preparation_name),
      // 老记录在这一列出现之前建的：保持 null，不去档案里现查当前轮次
      stage: row.stage === null || row.stage === undefined ? null : Number(row.stage),
      status: row.status as InterviewRecordStatus,
      incompleteReason: (row.incomplete_reason as RecordingIssue | null) ?? null,
      startedAt: String(row.started_at),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      durationMs: Number(row.duration_ms),
      utteranceCount: Number(row.utterance_count),
      hasReview: Boolean(row.review_markdown),
      echoCleanupApplied: Boolean(row.echo_cleanup_applied),
      echoRemovedCount: Number(row.echo_removed_count ?? 0),
      echoChangedCount: Number(row.echo_changed_count ?? 0),
    }
  }
}
