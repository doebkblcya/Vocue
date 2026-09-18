import { describe, expect, it } from 'vitest'
import {
  buildCurrentInterviewSystemPrompt,
  buildGenericInterviewSystemPrompt,
  buildInterviewSystemPrompt,
  parseInterviewAnswer,
} from '../src/main/ai/prompt-builder'
import type { LibraryDocument, Preparation } from '../src/shared/types'

const resume: LibraryDocument = {
  id: 'r1',
  filename: '简历.md',
  kind: 'markdown',
  content: '做过 Electron',
  createdAt: '',
  updatedAt: '',
}

const preparation: Preparation = {
  id: '1',
  name: '测试岗位',
  jobDescription: '需要 TypeScript',
  resume,
  createdAt: '',
  updatedAt: '',
  documents: [{
    id: 'd1', preparationId: '1', libraryDocumentId: 'lib-notes',
    filename: 'notes.md', kind: 'markdown',
    content: '补充项目背景', position: 0, createdAt: '',
  }],
}

describe('prompt builder', () => {
  it('系统提示词包含 JD、简历与补充资料', () => {
    const prompt = buildInterviewSystemPrompt(preparation)
    expect(prompt).toContain('需要 TypeScript')
    expect(prompt).toContain('做过 Electron')
    expect(prompt).toContain('补充项目背景')
  })

  it('无档案时使用不虚构经历的通用提示词', () => {
    const prompt = buildGenericInterviewSystemPrompt()
    expect(prompt).toContain('不要虚构项目')
    expect(prompt).toContain('中文实时面试助手')
  })

  it('把回答限制为适合现场阅读的短提词', () => {
    for (const prompt of [
      buildGenericInterviewSystemPrompt(),
      buildInterviewSystemPrompt({ ...preparation, jobDescription: '', resume: null, documents: [] }),
    ]) {
      expect(prompt).toContain('2 到 3 个短要点')
      expect(prompt).toContain('约 60 个汉字以内')
      expect(prompt).toContain('约 120 到 180 个汉字')
      expect(prompt).toContain('不超过约 250 个汉字')
      expect(prompt).toContain('不得换一种说法重复')
    }
  })

  it('没有档案时退回通用提示词', () => {
    expect(buildCurrentInterviewSystemPrompt(null)).toContain('不要虚构项目')
    expect(buildCurrentInterviewSystemPrompt(preparation)).toContain('需要 TypeScript')
  })

  it('流式拆分要点与详细回答', () => {
    expect(parseInterviewAnswer('<quick>\n- 先讲结论\n</quick>\n<detail>\n详细内容'))
      .toEqual({ summary: '- 先讲结论', detail: '详细内容' })
    expect(parseInterviewAnswer('<quick>\n- 还在流式输出<'))
      .toEqual({ summary: '- 还在流式输出', detail: '' })
    expect(parseInterviewAnswer('<qui'))
      .toEqual({ summary: '', detail: '' })
  })
})
