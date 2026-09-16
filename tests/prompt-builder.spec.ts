import { describe, expect, it } from 'vitest'
import {
  buildGenericInterviewSystemPrompt,
  buildInterviewSystemPrompt,
  parseAnalysis,
} from '../src/main/ai/prompt-builder'
import type { Preparation } from '../src/shared/types'

describe('prompt builder', () => {
  it('从带说明的模型输出中提取结构化分析', () => {
    const result = parseAnalysis(`结果如下：\n{\n  "overview": "匹配",\n  "keyRequirements": ["TypeScript"],\n  "candidateStrengths": ["Electron"],\n  "risks": [],\n  "answerStrategy": ["先结论"]\n}`)
    expect(result.overview).toBe('匹配')
    expect(result.keyRequirements).toEqual(['TypeScript'])
  })

  it('系统提示词包含 JD、简历与补充资料', () => {
    const preparation: Preparation = {
      id: '1',
      name: '测试岗位',
      jobDescription: '需要 TypeScript',
      resume: '做过 Electron',
      analysis: null,
      systemPrompt: '',
      createdAt: '',
      updatedAt: '',
      documents: [{
        id: 'd1', preparationId: '1', filename: 'notes.md', kind: 'markdown',
        content: '补充项目背景', position: 0, createdAt: '',
      }],
    }
    const prompt = buildInterviewSystemPrompt(preparation, null)
    expect(prompt).toContain('需要 TypeScript')
    expect(prompt).toContain('做过 Electron')
    expect(prompt).toContain('补充项目背景')
  })

  it('无档案时使用不虚构经历的通用提示词', () => {
    const prompt = buildGenericInterviewSystemPrompt()
    expect(prompt).toContain('不要虚构项目')
    expect(prompt).toContain('中文实时面试助手')
  })
})
