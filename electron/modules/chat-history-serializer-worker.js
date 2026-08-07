const { parentPort } = require('worker_threads')

function serializeHistory(messages = [], archiveThreshold = 500, recentCount = 200) {
  const serializeStartedAt = performance.now()
  const data = Array.isArray(messages)
    ? messages.filter(item => item?.type !== 'compression-divider')
    : []

  if (data.length > archiveThreshold) {
    const result = {
      mainJson: JSON.stringify({ messages: data.slice(-recentCount), hasArchive: true }),
      archiveJson: JSON.stringify({ messages: data.slice(0, -recentCount) }),
      hasArchive: true
    }
    result.metrics = { serializeMs: performance.now() - serializeStartedAt }
    return result
  }

  const result = {
    mainJson: JSON.stringify(data),
    archiveJson: null,
    hasArchive: false
  }
  result.metrics = { serializeMs: performance.now() - serializeStartedAt }
  return result
}

parentPort.on('message', message => {
  const id = message?.id
  const workerReceivedAt = performance.now()
  try {
    if (message?.kind === 'json') {
      parentPort.postMessage({
        id,
        success: true,
        result: JSON.stringify(message.value, null, Math.max(0, Math.min(8, Number(message.space) || 0)))
      })
      return
    }
    parentPort.postMessage({
      id,
      success: true,
      workerReceivedAt,
      result: serializeHistory(message?.messages, message?.archiveThreshold, message?.recentCount)
    })
  } catch (error) {
    parentPort.postMessage({ id, success: false, error: error.message })
  }
})
