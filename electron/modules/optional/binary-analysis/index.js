/**
 * 可选模块：二进制分析
 * 卸载：删除本目录 electron/modules/optional/binary-analysis/
 */

const path = require('path')
const schema = require('./schema')
const { handlers } = require('./handlers')

module.exports = {
  id: 'binary_analysis',

  feature: {
    id: 'binary_analysis',
    category: '安全分析',
    title: '二进制分析',
    description: '对授权样本/自有构建产物做静态结构分析（导入表、节区、字符串、熵等）。默认关闭。完整反编译需本机自备 Ghidra/r2。',
    defaultEnabled: false,
    risk: 'high',
    tools: ['inspect_binary'],
    hint: '删除目录 electron/modules/optional/binary-analysis 可彻底卸载本能力。仅用于有权分析的文件。'
  },

  toolsSchema: schema,
  handlers,

  display: {
    inspect_binary: {
      zh: '二进制分析',
      en: 'Binary Analysis'
    }
  },

  skillPath: path.join(__dirname, 'SKILL.md')
}
