import { describe, expect, it } from 'vitest'
import {
  buildCurrentInterviewSystemPrompt,
  buildGenericInterviewSystemPrompt,
  buildInterviewSystemPrompt,
  parseAnalysis,
  parseInterviewAnswer,
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

  it('开始面试时忽略数据库里的旧提示词快照', () => {
    const preparation: Preparation = {
      id: '1',
      name: '更新后的档案',
      jobDescription: '最新 JD 内容',
      resume: '最新简历内容',
      analysis: null,
      systemPrompt: '数据库中的旧提示词',
      createdAt: '',
      updatedAt: '',
      documents: [],
    }

    const prompt = buildCurrentInterviewSystemPrompt(preparation)

    expect(prompt).toContain('最新 JD 内容')
    expect(prompt).toContain('最新简历内容')
    expect(prompt).not.toContain('数据库中的旧提示词')
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
