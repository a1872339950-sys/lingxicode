// 聊天历史轮次范围工具
// ChatVirtualScroller 负责真实挂载/卸载 DOM；本模块只负责按 messagesHistory
// 计算“最近 N 轮”“跳转目标附近 N 轮”和 turnId/historyIndex 映射。

(function () {
  const DEFAULT_PAGE_ROUNDS = 30        // 切项目/启动时默认渲染轮数
  const JUMP_BEFORE_ROUNDS = 5          // 精准跳转时目标前保留 5 轮
  const JUMP_CONTEXT_ROUNDS = 10        // 精准跳转一次渲染 10 轮（包含目标轮）

  function buildRoundRanges(messagesHistory = []) {
    const history = Array.isArray(messagesHistory) ? messagesHistory : []
    const userStarts = []
    for (let i = 0; i < history.length; i++) {
      const msg = history[i]
      if (msg && msg.role === 'user' && !msg.hidden) userStarts.push(i)
    }
    return userStarts.map((start, index) => ({
      start,
      end: index + 1 < userStarts.length ? userStarts[index + 1] : history.length
    })).filter(item => item.end > item.start)
  }

  function calcRangeFromRoundBounds(messagesHistory, startRound, endRound) {
    const history = Array.isArray(messagesHistory) ? messagesHistory : []
    const total = history.length
    const rounds = buildRoundRanges(history)
    const roundCount = rounds.length
    if (!roundCount) {
      return { start: 0, end: total, total, startRound: 0, endRound: 0, roundCount: 0 }
    }
    const sr = Math.max(0, Math.min(roundCount - 1, Number(startRound) || 0))
    const er = Math.max(sr + 1, Math.min(roundCount, Number(endRound) || roundCount))
    return {
      start: rounds[sr].start,
      end: rounds[er - 1].end,
      total,
      startRound: sr,
      endRound: er,
      roundCount
    }
  }

  function findRoundIndexByHistoryIndex(messagesHistory, historyIndex) {
    const rounds = buildRoundRanges(messagesHistory)
    const target = Math.max(0, Number(historyIndex) || 0)
    for (let i = 0; i < rounds.length; i++) {
      if (target >= rounds[i].start && target < rounds[i].end) return i
    }
    return -1
  }


  // 计算 jump 模式的 [start, end)，单位是轮：目标前 5 轮，总计 10 轮。
  function calcJumpRange(messagesHistory, targetIndex) {
    if (!Array.isArray(messagesHistory)) {
      const t = Math.max(0, Number(messagesHistory) || 0)
      const idx = Math.max(0, Math.min(t - 1, Number(targetIndex) || 0))
      return { start: Math.max(0, idx - JUMP_BEFORE_ROUNDS), end: Math.min(t, idx + JUMP_BEFORE_ROUNDS), total: t, startRound: 0, endRound: 0, roundCount: 0 }
    }
    const rounds = buildRoundRanges(messagesHistory)
    if (!rounds.length) return { start: 0, end: messagesHistory.length, total: messagesHistory.length, startRound: 0, endRound: 0, roundCount: 0 }
    const targetRound = findRoundIndexByHistoryIndex(messagesHistory, targetIndex)
    const safeTargetRound = targetRound >= 0 ? targetRound : 0
    let startRound = Math.max(0, safeTargetRound - JUMP_BEFORE_ROUNDS)
    let endRound = Math.min(rounds.length, startRound + JUMP_CONTEXT_ROUNDS)
    if (endRound - startRound < JUMP_CONTEXT_ROUNDS) {
      startRound = Math.max(0, endRound - JUMP_CONTEXT_ROUNDS)
    }
    return calcRangeFromRoundBounds(messagesHistory, startRound, endRound)
  }

  // 计算 switch/startup 模式的 [start, end)，单位是轮。
  function calcSwitchRange(messagesHistory, pageRounds = DEFAULT_PAGE_ROUNDS) {
    if (!Array.isArray(messagesHistory)) {
      const t = Math.max(0, Number(messagesHistory) || 0)
      const ps = Math.max(1, Number(pageRounds) || DEFAULT_PAGE_ROUNDS)
      return { start: Math.max(0, t - ps), end: t, total: t, startRound: 0, endRound: 0, roundCount: 0 }
    }
    const rounds = buildRoundRanges(messagesHistory)
    if (!rounds.length) return { start: 0, end: messagesHistory.length, total: messagesHistory.length, startRound: 0, endRound: 0, roundCount: 0 }
    const ps = Math.max(1, Number(pageRounds) || DEFAULT_PAGE_ROUNDS)
    return calcRangeFromRoundBounds(messagesHistory, Math.max(0, rounds.length - ps), rounds.length)
  }

  // 根据 turnId 找到 messagesHistory 里的索引（user 消息的 _historyIndex）
  // turnId 是 1-based 的用户消息序号
  function findHistoryIndexByTurnId(messagesHistory, turnId) {
    if (!Array.isArray(messagesHistory) || !turnId) return -1
    let userCount = 0
    for (let i = 0; i < messagesHistory.length; i++) {
      const m = messagesHistory[i]
      if (m && m.role === 'user' && !m.hidden) {
        userCount++
        if (userCount === turnId) {
          // 找到该 user 消息，返回该 user 消息的 historyIndex
          // 我们要的是"包含该 user 消息的 round" 的起始 historyIndex
          // round 由 user + 后续 assistant/tool 组成，round 的起始就是 user 消息的 historyIndex
          return i
        }
      }
    }
    return -1
  }

  window.ChatHistoryRanges = {
    calcJumpRange,
    calcSwitchRange,
    findHistoryIndexByTurnId,
    findRoundIndexByHistoryIndex,
    buildRoundRanges,
    DEFAULT_PAGE_ROUNDS,
    JUMP_BEFORE_ROUNDS,
    JUMP_CONTEXT_ROUNDS
  }
})()
