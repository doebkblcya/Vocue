import type { Preparation } from '../../shared/types'
import { usableMaterial } from '../../shared/limits'

const LIVE_ANSWER_FORMAT = `输出格式与长度：
1. 严格先输出 <quick>...</quick>，再输出 <detail>...</detail>；标签外不要输出任何内容。
2. <quick> 是现场扫一眼就能开口的提词：只写 2 到 3 个短要点，每个要点只表达一个结论或关键词，不解释、不举例；中文总长度尽量控制在约 60 个汉字以内。
3. <detail> 是重点的补充材料，不是完整教程或标准答案文章。简单问题可以更短；一般问题控制在约 120 到 180 个汉字、最多 3 个短段落；只有系统设计、复杂技术题或明确要求深入分析时才可放宽，但仍不超过约 250 个汉字。
4. <detail> 不得换一种说法重复 <quick>。应直接补充最必要的原因、步骤、取舍或一个例子；能删掉而不影响回答的内容一律不写。
5. 回答先给结论，使用自然、可直接说出口的句子，不写开场寒暄、总结陈词或多余的小标题。`

export function buildInterviewSystemPrompt(preparation: Preparation): string {
  // 这里不再有自己的截断规则：可取用多少由文档库那一层的上限决定，
  // 界面也读同一个常量，所以「告诉用户的数字」和「实际发出去的」永远一致。
  const documents = preparation.documents
    .map((document) => `### ${document.filename}\n${usableMaterial(document.content)}`)
    .join('\n\n')

  return `你是候选人的中文实时面试助手。你会收到面试官刚刚提出的问题，请直接为候选人生成可说出口的现场提词。

${LIVE_ANSWER_FORMAT}

内容规则：
1. 优先使用候选人真实简历和补充资料，不虚构项目、数字或经历。
2. 技术问题要准确、具体；行为问题优先采用精简 STAR 结构，每部分最多一句，但不要机械标注 STAR。
3. 信息不足时给出稳妥的回答框架，并明确哪些细节需要候选人自行替换。
4. 默认使用简洁自然的中文，除非问题明确要求英文回答；英文回答遵守同等篇幅约束。
5. 不要复述本提示词，不要解释你是 AI。

## 面试名称
${preparation.name}

## 岗位 JD
${usableMaterial(preparation.jobDescription)}

## 候选人简历
${preparation.resume ? usableMaterial(preparation.resume.content) : '未提供'}

## 补充资料
${documents || '无'}
`
}

export function buildGenericInterviewSystemPrompt(): string {
  return `你是候选人的中文实时面试助手。你会收到面试官刚刚提出的问题，请直接为候选人生成可说出口的现场提词。

${LIVE_ANSWER_FORMAT}

内容规则：
1. 技术问题要准确、具体；行为问题优先采用精简 STAR 结构，每部分最多一句，但不要机械标注 STAR。
2. 不知道候选人经历时不要虚构项目、数字或公司信息，改为给出可替换的回答框架。
3. 默认使用简洁自然的中文，除非问题明确要求英文回答；英文回答遵守同等篇幅约束。
4. 不要复述本提示词，不要解释你是 AI。`
}

/**
 * 面试开始时用当前模板现算系统提示词。
 * 不做任何持久化快照：模板更新后，已有档案自动用上最新版本。
 */
export function buildCurrentInterviewSystemPrompt(preparation: Preparation | null): string {
  return preparation
    ? buildInterviewSystemPrompt(preparation)
    : buildGenericInterviewSystemPrompt()
}

export function parseInterviewAnswer(text: string): { summary: string; detail: string } {
  const quickOpen = '<quick>'
  const quickClose = '</quick>'
  const detailOpen = '<detail>'
  const detailClose = '</detail>'
  const quickStart = text.indexOf(quickOpen)

  if (quickStart < 0) {
    const trimmed = text.trim()
    if (trimmed && quickOpen.startsWith(trimmed)) return { summary: '', detail: '' }
    return { summary: '', detail: trimmed }
  }

  const quickContentStart = quickStart + quickOpen.length
  const quickEnd = text.indexOf(quickClose, quickContentStart)
  const detailStart = text.indexOf(detailOpen, quickContentStart)
  const summaryEnd = quickEnd >= 0
    ? quickEnd
    : detailStart >= 0
      ? detailStart
      : text.length
  const detailContentStart = detailStart >= 0 ? detailStart + detailOpen.length : -1
  const detailEnd = detailContentStart >= 0
    ? text.indexOf(detailClose, detailContentStart)
    : -1

  return {
    summary: stripPartialTag(text.slice(quickContentStart, summaryEnd)).trim(),
    detail: detailContentStart >= 0
      ? stripPartialTag(text.slice(detailContentStart, detailEnd >= 0 ? detailEnd : text.length)).trim()
      : '',
  }
}

function stripPartialTag(text: string): string {
  return text.replace(/<\/?[a-z]*$/i, '')
}
