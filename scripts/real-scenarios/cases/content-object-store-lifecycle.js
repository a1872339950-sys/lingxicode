const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'content-object-store.lifecycle',
  title: 'Content object store deduplicates content and reclaims only unreferenced objects',
  tags: ['content-object-store', 'recovery-point', 'quota'],
  changedFilePatterns: [
    /^electron\/modules\/content-object-store\.js$/i,
    /^electron\/modules\/change-session-snapshots\.js$/i,
    /^electron\/modules\/recovery-point-manifests\.js$/i,
    /^electron\/modules\/recovery-point-retention\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const objectStore = require(path.join(ctx.root, 'electron/modules/content-object-store'))
    const retention = require(path.join(ctx.root, 'electron/modules/recovery-point-retention'))
    const projectId = `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`
    config.setProjectInstance(projectId, { storagePath: workspace.storagePath })

    try {
      const content = Buffer.from('same-content-for-two-references')
      const first = await objectStore.putBuffer(projectId, content, {
        reference: { kind: 'test', ownerId: 'owner-a', phase: 'before', filePath: 'a.txt' }
      })
      const second = await objectStore.putBuffer(projectId, content, {
        reference: { kind: 'test', ownerId: 'owner-b', phase: 'before', filePath: 'b.txt' }
      })
      ctx.assert.equal(first.hash, second.hash, 'identical content should have one hash')

      let status = await objectStore.getStatus(projectId)
      ctx.assert.equal(status.objectCount, 1, 'identical content should be stored once')
      ctx.assert.equal(status.referenceCount, 2, 'both owners should retain references')

      await objectStore.releaseOwner(projectId, 'test', 'owner-a')
      let gc = await objectStore.garbageCollect(projectId)
      ctx.assert.equal(gc.deleted.length, 0, 'referenced object must not be collected')

      await objectStore.releaseOwner(projectId, 'test', 'owner-b')
      gc = await objectStore.garbageCollect(projectId)
      ctx.assert.equal(gc.deleted.length, 1, 'last reference removal should reclaim the object')
      status = await objectStore.getStatus(projectId)
      ctx.assert.equal(status.totalBytes, 0, 'reclaimed store should report zero bytes')

      await objectStore.putBuffer(projectId, Buffer.from('intermediate-version'), {
        reference: { kind: 'change-session', ownerId: 'task-1', phase: 'after', filePath: 'same.txt' }
      })
      await objectStore.putBuffer(projectId, Buffer.from('final-version'), {
        reference: { kind: 'change-session', ownerId: 'task-1', phase: 'after', filePath: 'same.txt' }
      })
      status = await objectStore.getStatus(projectId)
      ctx.assert.equal(status.objectCount, 1, 'replacing one task/file phase should immediately reclaim its unreferenced intermediate content')
      await objectStore.releaseOwner(projectId, 'change-session', 'task-1')
      await objectStore.garbageCollect(projectId)

      const protectedReference = { kind: 'atomic-test', ownerId: 'owner', phase: 'before', filePath: 'atomic.txt' }
      const protectedOld = await objectStore.putBuffer(projectId, Buffer.from('protected-old-content'), { reference: protectedReference })
      const originalRename = fs.promises.rename
      let atomicFailure = null
      try {
        fs.promises.rename = async function failObjectIndexRename(source, target) {
          if (String(target).endsWith(path.join('indexes', 'content-objects.json'))) {
            const error = new Error('intentional object index failure')
            error.code = 'EIO'
            throw error
          }
          return originalRename.call(this, source, target)
        }
        await objectStore.putBuffer(projectId, Buffer.from('uncommitted-new-content'), { reference: protectedReference })
      } catch (error) {
        atomicFailure = error
      } finally {
        fs.promises.rename = originalRename
      }
      ctx.assert.ok(atomicFailure, 'injected object index failure should reach the caller')
      ctx.assert.equal((await objectStore.readBuffer(projectId, protectedOld.hash)).toString(), 'protected-old-content', 'failed reference replacement must not delete the object referenced by the committed index')
      const protectedNew = await objectStore.putBuffer(projectId, Buffer.from('committed-new-content'), { reference: protectedReference })
      ctx.assert.equal((await objectStore.readBuffer(projectId, protectedNew.hash)).toString(), 'committed-new-content', 'reference replacement should succeed after the index fault clears')
      ctx.assert.ok(!fs.existsSync(objectStore.getObjectPath(projectId, protectedOld.hash)), 'the old object should be reclaimed only after the new reference commits')
      await objectStore.releaseOwner(projectId, 'atomic-test', 'owner')
      await objectStore.garbageCollect(projectId)

      await objectStore.putBuffer(projectId, Buffer.from('abc'), {
        maxOwnerBytes: 5,
        reference: { kind: 'owner-quota', ownerId: 'bounded-task', phase: 'before', filePath: 'one.txt' }
      })
      let ownerQuotaError = null
      try {
        await objectStore.putBuffer(projectId, Buffer.from('def'), {
          maxOwnerBytes: 5,
          reference: { kind: 'owner-quota', ownerId: 'bounded-task', phase: 'before', filePath: 'two.txt' }
        })
      } catch (error) {
        ownerQuotaError = error
      }
      ctx.assert.equal(ownerQuotaError?.code, 'CONTENT_OBJECT_OWNER_QUOTA', 'one task or recovery point should have an independent content quota')
      await objectStore.releaseOwner(projectId, 'owner-quota', 'bounded-task')
      await objectStore.garbageCollect(projectId)

      let quotaError = null
      try {
        await objectStore.putBuffer(projectId, Buffer.from('1234'), {
          maxObjectBytes: 10,
          maxProjectBytes: 3
        })
      } catch (error) {
        quotaError = error
      }
      ctx.assert.equal(quotaError?.code, 'CONTENT_OBJECT_PROJECT_QUOTA', 'project quota should reject new unique content')

      const quotaPoints = [
        ...Array.from({ length: 100 }, (_, index) => ({ id: `ai-${index}`, source: 'ai_auto', createdAt: new Date(index + 1).toISOString() })),
        ...Array.from({ length: 50 }, (_, index) => ({ id: `manual-${index}`, source: 'manual', createdAt: new Date(index + 1).toISOString() }))
      ]
      const expired = new Set(retention.selectExpiredPoints(quotaPoints))
      ctx.assert.equal(quotaPoints.filter(point => point.source === 'ai_auto' && !expired.has(point.id)).length, 30, 'one hundred AI tasks should retain exactly thirty recovery points')
      ctx.assert.equal(quotaPoints.filter(point => point.source === 'manual' && !expired.has(point.id)).length, 30, 'fifty manual snapshots should retain exactly thirty recovery points independently')
    } finally {
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}
