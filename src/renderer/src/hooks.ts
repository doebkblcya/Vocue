import { useEffect, useState } from 'react'
import {
  createInitialInterviewSessionState,
  type InterviewSessionState,
} from '../../shared/types'

export function useSessionState(): InterviewSessionState {
  const [state, setState] = useState(createInitialInterviewSessionState)
  useEffect(() => {
    let receivedLiveState = false
    const unsubscribe = window.vocue.session.onState((nextState) => {
      receivedLiveState = true
      setState(nextState)
    })
    // 必须先订阅再取快照；若等待快照期间收到实时事件，旧快照不能反向覆盖它。
    void window.vocue.session.getState().then((snapshot) => {
      if (!receivedLiveState) setState(snapshot)
    })
    return unsubscribe
  }, [])
  return state
}
