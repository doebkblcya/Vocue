import type { VocueApi } from '../../shared/types'

declare global {
  interface Window {
    vocue: VocueApi
  }
}

export {}
