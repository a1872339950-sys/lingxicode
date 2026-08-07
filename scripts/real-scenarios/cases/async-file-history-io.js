const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'performance.async-file-history-io',
  title: 'File tools and chat history serialization stay off synchronous main-process I/O',
  tags: ['performance', 'tools', 'history', 'filesystem'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/(?:file-ops|text-edit|search)\.js$/,
    /^electron\/modules\/(?:projects|chat-history-serializer(?:-worker)?)\.js$/
  ],
  async run(ctx) {
    const workspace = ctx.createWorkspace('async-file-history-io')
    await fs.promises.mkdir(workspace.projectPath, { recursive: true })
    const resolvePath = value => path.resolve(workspace.projectPath, value || '')
    const toolContext = { resolvePath, projectPath: workspace.projectPath, projectId: '' }

    try {
      const fileOps = require(path.join(ctx.root, 'electron/modules/tool-handlers/file-ops')).handlers
      const textEdit = require(path.join(ctx.root, 'electron/modules/tool-handlers/text-edit')).handlers
      const serializer = require(path.join(ctx.root, 'electron/modules/chat-history-serializer'))
      const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))
      const config = require(path.join(ctx.root, 'electron/modules/config'))

      let result = await fileOps.write_file({ path: 'src/a.txt', content: 'alpha\nbeta\n' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'write_file should write asynchronously')

      result = await fileOps.read_file({ path: 'src/a.txt' }, toolContext)
      ctx.assert.equal(result.content, 'alpha\nbeta\n', 'read_file should preserve content')

      result = await fileOps.read_many_files({ files: ['src/a.txt', 'missing.txt'] }, toolContext)
      ctx.assert.equal(result.ok_count, 1, 'read_many_files should keep partial success semantics')
      ctx.assert.equal(result.failed_count, 1, 'read_many_files should report missing files')

      result = await fileOps.find_in_file({ path: 'src/a.txt', pattern: 'beta' }, toolContext)
      ctx.assert.equal(result.count, 1, 'find_in_file should read asynchronously and preserve matches')

      result = await fileOps.edit_file({ path: 'src/a.txt', old_content: 'beta', new_content: 'gamma' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'edit_file should edit asynchronously')

      result = await textEdit.text_edit({
        path: 'src/a.txt',
        edits: [{ op: 'insert_after', anchor: 'gamma', content: '\ndelta' }]
      }, toolContext)
      ctx.assert.ok(result.success, result.error || 'text_edit should edit asynchronously')

      result = await textEdit.apply_patch({
        patch: '*** Begin Patch\n*** Add File: src/config.json\n+{"enabled":false}\n*** End Patch'
      }, toolContext)
      ctx.assert.ok(result.success, result.error || 'apply_patch should add asynchronously')

      result = await textEdit.json_edit({
        path: 'src/config.json',
        operations: [{ op: 'set', path: 'enabled', value: true }]
      }, toolContext)
      ctx.assert.ok(result.success, result.error || 'json_edit should write asynchronously')

      result = await fileOps.copy_file({ source: 'src/a.txt', destination: 'src/a-copy.txt' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'copy_file should copy asynchronously')
      result = await fileOps.move_file({ source: 'src/a-copy.txt', destination: 'src/a-moved.txt' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'move_file should move asynchronously')
      result = await fileOps.delete_file({ path: 'src/a-moved.txt' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'delete_file should delete asynchronously')

      const chunkSession = await fileOps.create_file_session({ path: 'src/chunked.txt' }, toolContext)
      ctx.assert.ok(chunkSession.success, chunkSession.error || 'chunk session should be created asynchronously')
      result = await fileOps.append_file_chunk({ session_id: chunkSession.session_id, content_chunk: 'first\n' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'first chunk should append asynchronously')
      result = await fileOps.append_file_chunk({ session_id: chunkSession.session_id, content_chunk: 'second\n' }, toolContext)
      ctx.assert.ok(result.success, result.error || 'second chunk should append asynchronously')
      result = await fileOps.finish_file_session({ session_id: chunkSession.session_id, expected_bytes: 13 }, toolContext)
      ctx.assert.ok(result.success, result.error || 'chunk session should finish asynchronously')
      ctx.assert.equal(await fs.promises.readFile(resolvePath('src/chunked.txt'), 'utf8'), 'first\nsecond\n', 'chunked content should persist')

      result = await fileOps.list_files({ path: 'src', recursive: true }, toolContext)
      ctx.assert.ok(result.success && result.files.length >= 3, 'list_files should preserve directory results')

      const messages = Array.from({ length: 900 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message-${index}-${'x'.repeat(512)}`
      }))
      messages.splice(300, 0, { type: 'compression-divider', content: 'transient' })
      const serialized = await serializer.serializeChatHistory(messages, { archiveThreshold: 500, recentCount: 200 })
      const main = JSON.parse(serialized.mainJson)
      const archive = JSON.parse(serialized.archiveJson)
      ctx.assert.equal(main.messages.length, 200, 'main history should keep the recent segment')
      ctx.assert.equal(archive.messages.length, 700, 'archive history should keep the older segment')
      ctx.assert.ok(!archive.messages.concat(main.messages).some(item => item.type === 'compression-divider'), 'transient dividers should not persist')

      const projectId = 'async-io-project'
      config.setLinguaBasePath(workspace.storagePath)
      config.setProjectInstance(projectId, { projectPath: workspace.projectPath, storagePath: workspace.storagePath })
      const trackedPath = resolvePath('src/tracked.txt')
      await fs.promises.writeFile(trackedPath, 'before', 'utf8')
      const session = changeSessions.startChangeSession(projectId, workspace.projectPath)
      await changeSessions.recordFileBeforeAsync(projectId, trackedPath, 'modify')
      await fs.promises.writeFile(trackedPath, 'after', 'utf8')
      await changeSessions.recordFileAfterAsync(projectId, trackedPath, 'modify')
      changeSessions.finalizeChangeSession(projectId, session.id)
      await changeSessions.flushPendingSessionWrites()
      const recorded = changeSessions.getChangeSession(projectId, session.id, { includeContent: true })
      ctx.assert.equal(recorded.files[0].beforeText, 'before', 'change session should capture the async before snapshot')
      ctx.assert.equal(recorded.files[0].afterText, 'after', 'change session should capture the async after snapshot')
      config.deleteProjectInstance(projectId)

      for (const relativePath of [
        'electron/modules/tool-handlers/file-ops.js',
        'electron/modules/tool-handlers/text-edit.js'
      ]) {
        const source = await fs.promises.readFile(path.join(ctx.root, relativePath), 'utf8')
        ctx.assert.ok(!/\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|renameSync|unlinkSync|rmSync|mkdirSync|mkdtempSync)\b/.test(source), `${relativePath} should not use synchronous file I/O`)
      }
    } finally {
      workspace.cleanup()
    }
  }
}
