export type Pick = { model: string | null; effort: string | null; isOpen: boolean; isProgressOff?: boolean; isClean?: boolean }

export type Step = { id: string; label: string; status: 'pending' | 'running' | 'done' }

export type Run = {
  title: string
  startedAt: number
  now: number
  endedAt: number | null
  steps: Step[]
  isPlanned: boolean
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'model-picker': { pick: Pick; run: Run | null }
  }
}
