import { Minus, Plus } from 'lucide-react'
import { formatStage, nextStage, previousStage, type InterviewStage } from '../../../shared/stage'

interface Props {
  stage: InterviewStage
  onChange: (stage: InterviewStage) => void
}

/**
 * 面试阶段只做加减，不铺选项列表。
 * 轮次没有上限，下拉或单选这类「把选项列出来」的控件迟早要列几十项，
 * 而且原生弹出菜单也带不进应用的设计体系。
 */
export function StageStepper({ stage, onChange }: Props): React.JSX.Element {
  return (
    <div className="stage-stepper">
      <button
        className="stage-step"
        disabled={stage === null}
        title="退回上一轮"
        onClick={() => onChange(previousStage(stage))}
      >
        <Minus size={15} />
      </button>
      <span className={stage === null ? 'stage-value unset' : 'stage-value'}>
        {formatStage(stage)}
      </span>
      <button
        className="stage-step"
        title={`进入${formatStage(nextStage(stage))}`}
        onClick={() => onChange(nextStage(stage))}
      >
        <Plus size={15} />
      </button>
      {stage !== null && (
        <button className="stage-reset" title="清除阶段" onClick={() => onChange(null)}>
          清除
        </button>
      )}
    </div>
  )
}
