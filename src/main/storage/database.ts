import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ExtractedDocument,
  Preparation,
  PreparationAnalysis,
  PreparationDocument,
  PreparationSummary,
} from '../../shared/types'

interface PreparationRow {
  id: string
  name: string
  job_description: string
  resume: string
  analysis_json: string | null
  system_prompt: string
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
        analysis_json TEXT,
        system_prompt TEXT NOT NULL DEFAULT '',
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
    `)
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
        SELECT p.id, p.name, p.updated_at,
          COUNT(d.id) AS document_count,
          CASE WHEN p.analysis_json IS NULL THEN 0 ELSE 1 END AS analyzed
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
      analyzed: number
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: row.updated_at,
      documentCount: Number(row.document_count),
      analyzed: Boolean(row.analyzed),
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
    const sourceChanged = !existing || preparationSourceChanged(existing, input)
    const analysisJson = sourceChanged || !existing.analysis
      ? null
      : JSON.stringify(existing.analysis)
    const systemPrompt = sourceChanged ? '' : existing.systemPrompt

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(`
          INSERT INTO preparations(
            id, name, job_description, resume, analysis_json, system_prompt, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            job_description = excluded.job_description,
            resume = excluded.resume,
            analysis_json = excluded.analysis_json,
            system_prompt = excluded.system_prompt,
            updated_at = excluded.updated_at
        `)
        .run(
          id,
          input.name.trim(),
          input.jobDescription,
          input.resume,
          analysisJson,
          systemPrompt,
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

  saveAnalysis(id: string, analysis: PreparationAnalysis, systemPrompt: string): Preparation {
    this.db
      .prepare(`
        UPDATE preparations
        SET analysis_json = ?, system_prompt = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify(analysis), systemPrompt, new Date().toISOString(), id)
    const result = this.getPreparation(id)
    if (!result) throw new Error('准备资料不存在')
    return result
  }

  removePreparation(id: string): void {
    this.db.prepare('DELETE FROM preparations WHERE id = ?').run(id)
  }

  private mapPreparation(row: PreparationRow, documents: DocumentRow[]): Preparation {
    let analysis: PreparationAnalysis | null = null
    if (row.analysis_json) {
      try {
        analysis = JSON.parse(row.analysis_json) as PreparationAnalysis
      } catch {
        analysis = null
      }
    }
    return {
      id: row.id,
      name: row.name,
      jobDescription: row.job_description,
      resume: row.resume,
      analysis,
      systemPrompt: row.system_prompt,
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

function preparationSourceChanged(
  existing: Preparation,
  input: {
    jobDescription: string
    resume: string
    documents: ExtractedDocument[]
  },
): boolean {
  if (existing.jobDescription !== input.jobDescription || existing.resume !== input.resume) return true
  if (existing.documents.length !== input.documents.length) return true
  return existing.documents.some((document, index) => {
    const next = input.documents[index]
    return !next ||
      document.filename !== next.filename ||
      document.kind !== next.kind ||
      document.content !== next.content
  })
}
