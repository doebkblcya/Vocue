import { useEffect, useState } from 'react'
import type { InterviewSessionState } from '../../shared/types'

const INITIAL_STATE: InterviewSessionState = {
  status: 'idle',
  mode: null,
  preparationId: null,
  preparationName: '',
  partialTranscript: '',
  finalTranscript: '',
  answer: '',
  error: '',
  microphoneActive: false,
  generating: false,
}

export function useSessionState(): InterviewSessionState {
  const [state, setState] = useState(INITIAL_STATE)
  useEffect(() => {
    void window.vocue.session.getState().then(setState)
    return window.vocue.session.onState(setState)
  }, [])
  return state
}
