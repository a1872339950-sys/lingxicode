#!/usr/bin/env node
const { parseArgs, scaffoldFromTemplate } = require('./copy-dir.cjs')
const args = parseArgs(process.argv.slice(2))
scaffoldFromTemplate({
  templateName: 'phaser-starter',
  destArg: args.dest || args.d,
  force: !!args.force,
  name: args.name,
  label: 'Phaser 2D 最小可玩项目'
})
