#!/usr/bin/env node
const { scaffold, parseArgs } = require('./copy-dir.cjs')
const args = parseArgs(process.argv.slice(2))
scaffold('remotion-starter', args.dest || args.d, {
  force: !!args.force,
  name: args.name,
  label: '程序化短视频（Remotion）项目'
})
