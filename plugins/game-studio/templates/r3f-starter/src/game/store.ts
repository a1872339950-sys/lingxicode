import { useSyncExternalStore } from 'react'
import { createStore } from './createStore'

export type GameState = {
  score: number
  spin: number
  paused: boolean
  bump: () => void
  togglePause: () => void
  tick: (dt: number) => void
  reset: () => void
}

const api = createStore<Omit<GameState, 'bump' | 'togglePause' | 'tick' | 'reset'>>({
  score: 0,
  spin: 0,
  paused: false
})

function bump() {
  api.set((s) => ({ score: s.score + 1 }))
}
function togglePause() {
  api.set((s) => ({ paused: !s.paused }))
}
function tick(dt: number) {
  const s = api.get()
  if (s.paused) return
  api.set({ spin: s.spin + dt * 1.2 })
}
function reset() {
  api.set({ score: 0, spin: 0, paused: false })
}

export function getGameState(): GameState {
  return { ...api.get(), bump, togglePause, tick, reset }
}

export function useGameStore<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(
    api.subscribe,
    () => selector(getGameState()),
    () => selector(getGameState())
  )
}
