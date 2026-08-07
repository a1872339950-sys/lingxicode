const path = require('path')

module.exports = {
  id: 'visual-interaction-evidence',
  title: 'Interaction verification detects meaningful pixel changes',
  tags: ['browser', 'visual', 'interaction', 'verification'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/website-research\.js$/i,
    /^electron\/modules\/schemas\/screenshot-image\.js$/i
  ],

  async run(ctx) {
    const { compareInteractionEvidence } = require(path.join(
      ctx.root,
      'electron/modules/tool-handlers/website-research'
    ))
    const unchanged = Buffer.alloc(90 * 3, 20)
    const changed = Buffer.from(unchanged)
    for (let index = 0; index < 20 * 3; index += 1) changed[index] = 230

    const sameResult = compareInteractionEvidence({ sample: unchanged }, { sample: Buffer.from(unchanged) })
    ctx.assert.equal(sameResult.changed, false, 'identical screenshots should not count as a visual change')

    const changedResult = compareInteractionEvidence({ sample: unchanged }, { sample: changed })
    ctx.assert.equal(changedResult.changed, true, 'a substantial pixel delta should count as a visual change')
    ctx.assert.ok(changedResult.changed_pixel_ratio > 0.1, 'visual evidence should report the changed pixel ratio')
  }
}
