import type { InterviewUtterance } from '../../shared/types'

export interface EchoCleanupEdit {
  utteranceId: string
  cleanedText: string | null
  excludedAsEcho: boolean
}

export interface EchoCleanupPlan {
  edits: EchoCleanupEdit[]
  removedCount: number
  changedCount: number
}

const TIME_TOLERANCE_MS = 8000

/**
 * 麦克风轨在外放时是「我 + 扬声器」的混合轨。系统音频轨则是可信的面试官轨。
 * 这里仅移除时间接近且文字高度相似的片段；不确定时保留，避免误删真实回答。
 */
export function planEchoCleanup(utterances: InterviewUtterance[]): EchoCleanupPlan {
  const interviewers = utterances.filter((item) => item.role === 'interviewer')
  const edits: EchoCleanupEdit[] = []
  let removedCount = 0
  let changedCount = 0

  for (const candidate of utterances.filter((item) => item.role === 'candidate')) {
    const nearby = interviewers.filter((interviewer) =>
      intervalDistance(candidate, interviewer) <= TIME_TOLERANCE_MS,
    )
    if (!nearby.length) continue

    const clauses = splitClauses(candidate.text)
    const kept = clauses.filter((clause) => !isEchoClause(clause, nearby))
    if (kept.length === clauses.length) continue

    const cleanedText = kept.join('').trim()
    if (!cleanedText) {
      edits.push({ utteranceId: candidate.id, cleanedText: null, excludedAsEcho: true })
      removedCount += 1
      continue
    }

    edits.push({ utteranceId: candidate.id, cleanedText, excludedAsEcho: false })
    changedCount += 1
  }

  return { edits, removedCount, changedCount }
}

function isEchoClause(clause: string, interviewers: InterviewUtterance[]): boolean {
  const candidateText = normalize(clause)
  if (candidateText.length < 4) return false
  return interviewers.some((interviewer) => {
    const interviewerText = normalize(interviewer.text)
    if (interviewerText.length < 4) return false
    if (candidateText === interviewerText) return true
    const common = longestCommonSubsequenceLength(candidateText, interviewerText)
    const candidateCoverage = common / candidateText.length
    const interviewerCoverage = common / interviewerText.length
    return candidateCoverage >= 0.86 && interviewerCoverage >= 0.58
  })
}

function splitClauses(text: string): string[] {
  return text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g)?.map((part) => part.trim()).filter(Boolean)
    ?? [text]
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

function intervalDistance(left: InterviewUtterance, right: InterviewUtterance): number {
  if (left.endMs >= right.startMs && right.endMs >= left.startMs) return 0
  return left.startMs > right.endMs
    ? left.startMs - right.endMs
    : right.startMs - left.endMs
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const previous = new Uint16Array(right.length + 1)
  const current = new Uint16Array(right.length + 1)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1] + 1
        : Math.max(previous[rightIndex], current[rightIndex - 1])
    }
    previous.set(current)
    current.fill(0)
  }
  return previous[right.length]
}
