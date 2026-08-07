const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'temporary-agent.handoff-cleanup',
  title: 'Temporary agent report handoff clears dock and keeps report file clickable',
  tags: ['ui', 'agent-collaboration'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/agent-collaboration-ui\.js$/i,
    /^frontend\/styles\/agent-collaboration\.css$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/agent-collaboration-ui.js'), 'utf8')

    ctx.assert.ok(
      /function dismissTemporarySessionIcons\(session\s*=\s*\{\}\)[\s\S]*?clearTempAgentIcons\s*\(/.test(source),
      'temporary handoff cleanup helper should clear the temporary agent dock'
    )

    const cleanHandoffStart = source.indexOf('function showCleanHandoffPrompt')
    const hideStart = source.indexOf('function hideHandoffPrompt')
    ctx.assert.ok(cleanHandoffStart >= 0 && hideStart > cleanHandoffStart, 'clean handoff helpers should exist')
    const cleanHandoffBlock = source.slice(cleanHandoffStart, hideStart)
    // 当前产品：协作汇报自动转交主 AI，成功后 dismissTemporarySessionIcons；失败则 return
    ctx.assert.ok(
      /dismissTemporarySessionIcons\s*\(\s*session\s*\)/.test(cleanHandoffBlock) &&
      (
        /if\s*\(\s*sent\s*===\s*false\s*\)/.test(cleanHandoffBlock) ||
        /data-handoff-skip/.test(cleanHandoffBlock)
      ),
      'successful handoff (or explicit skip) should clear temporary icons'
    )

    const detailBlock = source.slice(source.indexOf('function showTempAgentDetail'), source.indexOf('function handleChatEvent'))
    ctx.assert.ok(
      /const reportFilePath = agent\.reportFilePath \|\| state\?\.reportFilePath \|\| ''/.test(detailBlock),
      'temporary agent detail should read report file metadata from agent or runtime state'
    )
    ctx.assert.ok(
      /reportFilePath[\s\S]*data-collab-report-file[\s\S]*reportContent/.test(detailBlock),
      'temporary agent detail should prefer a clickable report file button over final path-only text'
    )
  }
}
