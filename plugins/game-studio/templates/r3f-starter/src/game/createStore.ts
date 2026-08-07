/** 无第三方依赖的迷你 store */
export function createStore<T extends object>(init: T | (() => T)) {
  let state = typeof init === 'function' ? (init as () => T)() : init
  const listeners = new Set<(s: T) => void>()
  const get = () => state
  const set = (partial: Partial<T> | ((s: T) => Partial<T>)) => {
    const next = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...next }
    listeners.forEach((l) => l(state))
  }
  const subscribe = (listener: (s: T) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return { get, set, subscribe }
}
