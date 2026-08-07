(function () {
  'use strict'

  function create(options = {}) {
    let revision = 0
    let savedRevision = 0
    let timer = 0
    let running = null
    let rerun = false

    function reset() {
      if (timer) clearTimeout(timer)
      timer = 0
      revision = 0
      savedRevision = 0
      rerun = false
    }

    function markChanged() {
      revision += 1
      return revision
    }

    async function persist(force = false) {
      if (running) {
        rerun = true
        return running
      }
      if (!force && revision === savedRevision) return null
      const targetRevision = revision
      const snapshot = options.getSnapshot?.()
      running = Promise.resolve(options.persist?.(snapshot))
        .then(async result => {
          savedRevision = Math.max(savedRevision, targetRevision)
          await options.onPersisted?.(result, {
            revision: targetRevision,
            isCurrent: targetRevision === revision
          })
          return result
        })
        .finally(() => {
          running = null
          if (rerun || revision > savedRevision) {
            rerun = false
            persist().catch(error => options.onError?.(error))
          }
        })
      return running
    }

    function schedule(delayMs = 650) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = 0
        persist().catch(error => options.onError?.(error))
      }, Math.max(100, Number(delayMs) || 650))
    }

    function flush(options = {}) {
      if (timer) clearTimeout(timer)
      timer = 0
      return persist(options.force === true)
    }

    return { reset, markChanged, schedule, flush, getRevision: () => revision }
  }

  window.CanvasWorkflowSaveQueue = { create }
})()
