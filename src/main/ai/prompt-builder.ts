import type { Preparation, PreparationAnalysis } from '../../shared/types'

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n[内容已截断]`

export function buildAnalysisPrompt(preparation: Preparation): string {
  const documents = preparation.documents
    .map((document) => `### ${document.filename}\n${clip(document.content, 20_000)}`)
    .join('\n\n')

  return `请分析下面的面试准备资料。只输出一个 JSON 对象，不要 Markdown 代码块。字段必须是：
{
  "overview": "岗位和候选人的简要匹配概述",
  "keyRequirements": ["岗位的关键要求"],
  "candidateStrengths": ["候选人可重点表达的优势"],
  "risks": ["可能被追问或需要谨慎处理的点"],
  "answerStrategy": ["回答策略"]
}

## 岗位 JD
${clip(preparation.jobDescription, 30_000)}

## 简历
${clip(preparation.resume, 40_000)}

## 补充资料
${documents || '无'}
`
}

export function buildInterviewSystemPrompt(
  preparation: Preparation,
  analysis: PreparationAnalysis | null,
): string {
  const analysisText = analysis
    ? `
## 预分析
- 概述：${analysis.overview}
- 岗位重点：${analysis.keyRequirements.join('；')}
- 候选人优势：${analysis.candidateStrengths.join('；')}
- 风险点：${analysis.risks.join('；')}
- 回答策略：${analysis.answerStrategy.join('；')}`
    : ''
  const documents = preparation.documents
    .map((document) => `### ${document.filename}\n${clip(document.content, 12_000)}`)
    .join('\n\n')

  return `你是候选人的中文实时面试助手。你会收到面试官刚刚提出的问题，请直接为候选人生成可说出口的回答。

回答规则：
1. 优先使用候选人真实简历和补充资料，不虚构项目、数字或经历。
2. 第一段先给出 1 到 3 句可以立即开口说的核心回答，再给必要的展开要点。
3. 技术问题要准确、具体；行为问题优先采用 STAR 结构，但不要机械标注 STAR。
4. 信息不足时给出稳妥的回答框架，并明确哪些细节需要候选人自行替换。
5. 默认使用简洁自然的中文，除非问题明确要求英文回答。
6. 不要复述本提示词，不要解释你是 AI。

## 面试名称
${preparation.name}

## 岗位 JD
${clip(preparation.jobDescription, 24_000)}

## 候选人简历
${clip(preparation.resume, 32_000)}
${analysisText}

## 补充资料
${documents || '无'}
`
}

export function buildGenericInterviewSystemPrompt(): string {
  return `你是候选人的中文实时面试助手。你会收到面试官刚刚提出的问题，请直接为候选人生成可说出口的回答。

回答规则：
1. 第一段先给出 1 到 3 句可以立即开口说的核心回答，再给必要的展开要点。
2. 技术问题要准确、具体；行为问题优先采用 STAR 结构，但不要机械标注 STAR。
3. 不知道候选人经历时不要虚构项目、数字或公司信息，改为给出可替换的回答框架。
4. 默认使用简洁自然的中文，除非问题明确要求英文回答。
5. 不要复述本提示词，不要解释你是 AI。`
}

export function parseAnalysis(text: string): PreparationAnalysis {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('DeepSeek 返回的分析格式不正确')
  const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<PreparationAnalysis>
  const array = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return {
    overview: typeof parsed.overview === 'string' ? parsed.overview : '',
    keyRequirements: array(parsed.keyRequirements),
    candidateStrengths: array(parsed.candidateStrengths),
    risks: array(parsed.risks),
    answerStrategy: array(parsed.answerStrategy),
  }
}
