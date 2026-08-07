const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const sharp = require('sharp')

module.exports = {
  id: 'media-ecosystem-tools',
  title: 'Bundled media tools upscale images and extract video frames',
  tags: ['media', 'video', 'image', 'ffmpeg'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/media-gen\.js$/i,
    /^electron\/modules\/schemas\/media-gen\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const sourceImage = path.join(workspace.dir, 'source.png')
    const sourceVideo = path.join(workspace.dir, 'source.mp4')
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
    const storageConfig = require(path.join(ctx.root, 'electron/modules/storage-config'))
    const { upscaleMedia, extractVideoFrames } = require(path.join(
      ctx.root,
      'electron/modules/tool-handlers/media-gen'
    ))

    try {
      storageConfig.init(workspace.storagePath, {
        isPackaged: true,
        getPath: () => workspace.dir
      })
      await sharp({
        create: { width: 40, height: 24, channels: 3, background: { r: 40, g: 130, b: 220 } }
      }).png().toFile(sourceImage)
      const upscaled = await upscaleMedia({ path: sourceImage, scale: 2 })
      ctx.assert.equal(upscaled.success, true, 'image upscaling should succeed')
      const upscaledMetadata = await sharp(upscaled.path).metadata()
      ctx.assert.equal(upscaledMetadata.width, 80, 'upscaled image width should match the requested factor')
      ctx.assert.equal(upscaledMetadata.height, 48, 'upscaled image height should match the requested factor')

      execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=96x54:rate=6',
        '-t', '1.2', '-pix_fmt', 'yuv420p', '-y', sourceVideo
      ], { windowsHide: true, timeout: 30000 })
      const frames = await extractVideoFrames({
        path: sourceVideo,
        timestamps: [0, 0.5, 1],
        width: 48
      })
      ctx.assert.equal(frames.success, true, 'video frame extraction should succeed')
      ctx.assert.equal(frames.frame_count, 3, 'each requested timestamp should create a frame')
      ctx.assert.ok(frames.frames.every(filePath => fs.existsSync(filePath)), 'all extracted frame paths should exist')
      const frameMetadata = await sharp(frames.frames[0]).metadata()
      ctx.assert.equal(frameMetadata.width, 48, 'frame extraction should honor the requested output width')
    } finally {
      workspace.cleanup()
    }
  }
}
