import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ExtractedDocument,
  Preparation,
  PreparationDocument,
  PreparationSummary,
  InterviewRecord,
  InterviewRecordStatus,
  InterviewRecordSummary,
  InterviewRole,
} from '../../shared/types'
import type { EchoCleanupPlan } from '../session/echo-cleanup'

interface PreparationRow {
  id: string
  name: string
  job_description: string
  resume: string
  created_at: string
  updated_at: string
}

interface DocumentRow {
  id: string
  preparation_id: string
  filename: string
  kind: PreparationDocument['kind']
  content: string
  position: number
  created_at: string
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
      CREATE TABLE IF NOT EXISTS preparations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        job_description TEXT NOT NULL DEFAULT '',
        resume TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preparation_documents (
        id TEXT PRIMARY KEY,
        preparation_id TEXT NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_preparation
        ON preparation_documents(preparation_id, position);
      CREATE TABLE IF NOT EXISTS interview_sessions (
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
    const recoveredAt = new Date().toISOString()
    this.db.prepare(`
      UPDATE interview_sessions
      SET status = 'incomplete',
          ended_at = COALESCE(ended_at, ?),
          duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
          updated_at = ?
      WHERE status = 'recording'
    `).run(recoveredAt, recoveredAt, recoveredAt)
  }

  close(): void {
    this.db.close()
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
        SELECT p.id, p.name, p.updated_at, COUNT(d.id) AS document_count
        FROM preparations p
        LEFT JOIN preparation_documents d ON d.preparation_id = p.id
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `)
      .all() as Array<{
      id: string
      name: string
      updated_at: string
      document_count: number
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      documentCount: Number(row.document_count),
    }))
  }

  getPreparation(id: string): Preparation | null {
    const row = this.db.prepare('SELECT * FROM preparations WHERE id = ?').get(id) as
      | PreparationRow
      | undefined
    if (!row) return null

    const documents = this.db
      .prepare('SELECT * FROM preparation_documents WHERE preparation_id = ? ORDER BY position')
      .all(id) as unknown as DocumentRow[]

    return this.mapPreparation(row, documents)
  }

  savePreparation(input: {
    id?: string
    name: string
    jobDescription: string
    resume: string
    documents: ExtractedDocument[]
  }): Preparation {
    const existing = input.id ? this.getPreparation(input.id) : null
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(`
          INSERT INTO preparations(
            id, name, job_description, resume, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            job_description = excluded.job_description,
            resume = excluded.resume,
            updated_at = excluded.updated_at
        `)
        .run(
          id,
          input.name.trim(),
          input.jobDescription,
          input.resume,
          existing?.createdAt ?? now,
          now,
        )

      this.db.prepare('DELETE FROM preparation_documents WHERE preparation_id = ?').run(id)
      const insert = this.db.prepare(`
        INSERT INTO preparation_documents(
          id, preparation_id, filename, kind, content, position, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      input.documents.forEach((document, position) => {
        insert.run(randomUUID(), id, document.filename, document.kind, document.content, position, now)
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return this.getPreparation(id) as Preparation
  }

  removePreparation(id: string): void {
    this.db.prepare('DELETE FROM preparations WHERE id = ?').run(id)
  }

  createInterviewSession(input: {
    preparationId: string | null
    preparationName: string
  }): InterviewRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO interview_sessions(
        id, preparation_id, preparation_name, status, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'recording', ?, ?, ?)
    `).run(id, input.preparationId, input.preparationName, now, now, now)
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

  finishInterviewSession(id: string, status: 'ready' | 'incomplete' = 'ready'): void {
    const row = this.db.prepare('SELECT started_at FROM interview_sessions WHERE id = ?').get(id) as
      | { started_at: string }
      | undefined
    if (!row) return
    const endedAt = new Date()
    const durationMs = Math.max(0, endedAt.getTime() - new Date(row.started_at).getTime())
    this.db.prepare(`
      UPDATE interview_sessions
      SET status = ?, ended_at = ?, duration_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(status, endedAt.toISOString(), durationMs, endedAt.toISOString(), id)
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
      status: row.status as InterviewRecordStatus,
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

  private mapPreparation(row: PreparationRow, documents: DocumentRow[]): Preparation {
    return {
      id: row.id,
      name: row.name,
      jobDescription: row.job_description,
      resume: row.resume,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      documents: documents.map((document) => ({
        id: document.id,
        preparationId: document.preparation_id,
        filename: document.filename,
        kind: document.kind,
        content: document.content,
        position: document.position,
        createdAt: document.created_at,
      })),
    }
  }
}
