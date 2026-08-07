const fs = require('fs')
const path = require('path')
const vm = require('vm')

function pillHasAdded(html, n) {
  const text = String(html || '')
  // 滚轮数字把 "+1" 拆成 + 与 aria-label="1" / 数字 span
  return text.includes(`+${n}`) ||
    new RegExp(`ai-change-pill-add[\\s\\S]{0,200}aria-label="${n}"`).test(text) ||
    new RegExp(`ai-change-pill-add[\\s\\S]{0,200}>${n}<`).test(text)
}

function pillHasRemoved(html, n) {
  const text = String(html || '')
  return text.includes(`-${n}`) ||
    new RegExp(`ai-change-pill-remove[\\s\\S]{0,200}aria-label="${n}"`).test(text) ||
    new RegExp(`ai-change-pill-remove[\\s\\S]{0,200}>${n}<`).test(text)
}

function pillFileCount(html, n) {
  const text = String(html || '')
  return text.includes(`${n} 文件`) || new RegExp(`ai-change-pill-meta-file[^>]*>${n}\\s*文件`).test(text)
}

module.exports = {
  id: 'ai-change-pill.live-start',
  title: 'AI change pill appears on mutating tool start and reconciles on result',
  tags: ['ai-ui', 'change-pill'],
  changedFilePatterns: [
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/ai-change-pill\.js$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-change-pill.js'), 'utf8')

    function makeNode(html = '') {
      const node = {
        innerHTML: String(html || ''),
        onclick: null,
        style: {},
        classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
        querySelector(selector) {
          const text = this.innerHTML || ''
          if (!selector) return null
          // 极简实现：按 class 名在片段中定位，返回可再 query 的节点
          const className = String(selector).replace(/^\./, '')
          if (!text.includes(className)) return null
          const start = text.indexOf(className)
          // 截取该 class 所在标签的一段内容，供二次 querySelector / textContent 使用
          const slice = text.slice(Math.max(0, start - 40), start + 280)
          const child = makeNode(slice)
          child.textContent = (slice.match(/>([^<]*)</) || [])[1] || ''
          child.remove = () => {
            this.innerHTML = this.innerHTML.replace(slice, '')
          }
          return child
        },
        querySelectorAll(selector) {
          const found = this.querySelector(selector)
          return found ? [found] : []
        },
        insertBefore(newNode) {
          if (newNode && newNode.outerHTML) this.innerHTML = newNode.outerHTML + this.innerHTML
          else if (newNode && newNode.innerHTML) this.innerHTML = newNode.innerHTML + this.innerHTML
          return newNode
        },
        setAttribute() {},
        getAttribute() { return null },
        remove() {}
      }
      return node
    }

    const root = makeNode('')
    const sandbox = {
      window: {
        AiMessageUI: {
          calculateEditLines(oldText, newText) {
            const oldLines = String(oldText || '').split(/\r\n|\r|\n/).filter(Boolean).length
            const newLines = String(newText || '').split(/\r\n|\r|\n/).filter(Boolean).length
            return { add: Math.max(0, newLines - oldLines), remove: Math.max(0, oldLines - newLines) }
          }
        }
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      document: {
        getElementById() {
          return root
        },
        createElement(tag) {
          const el = makeNode('')
          el.tagName = String(tag || '').toUpperCase()
          el.className = ''
          Object.defineProperty(el, 'outerHTML', {
            get() {
              const cls = el.className ? ` class="${el.className}"` : ''
              return `<${tag}${cls}>${el.innerHTML}</${tag}>`
            }
          })
          return el
        }
      }
    }
    vm.runInNewContext(source, sandbox)
    const pill = sandbox.window.AiChangePill.bind({ root })

    function snapAdded() {
      return Number(pill.getOperationSnapshot?.()?.summary?.added || 0)
    }
    function snapRemoved() {
      return Number(pill.getOperationSnapshot?.()?.summary?.removed || 0)
    }
    function snapFiles() {
      return Number(pill.getOperationSnapshot?.()?.summary?.fileCount || 0)
    }

    pill.recordToolStart('edit_file', {
      path: 'src/app.js',
      old_content: 'const a = 1\n',
      new_content: 'const a = 1\nconst b = 2\n'
    }, { toolCallId: 'tool-1' })
    ctx.assert.ok(root.innerHTML.includes('ai-change-pill') || snapAdded() > 0, 'change pill should render immediately on tool-start')
    ctx.assert.ok(snapAdded() === 1 || pillHasAdded(root.innerHTML, 1), 'change pill should show estimated additions on tool-start')

    pill.recordToolResult('edit_file', {
      path: 'src/app.js',
      old_content: 'const a = 1\n',
      new_content: 'const a = 1\nconst b = 2\n'
    }, { success: true }, { toolCallId: 'tool-1' })
    ctx.assert.equal(snapAdded(), 1, 'tool-result should replace pending contribution instead of doubling it')
    ctx.assert.ok(snapAdded() !== 2, 'pending and final contribution should not be counted twice')

    pill.recordToolStart('edit_file', {
      path: 'src/broken.js',
      old_content: 'x\n',
      new_content: 'x\ny\n'
    }, { toolCallId: 'tool-2' })
    ctx.assert.equal(snapAdded(), 2, 'second pending edit should add to live summary')

    pill.recordToolResult('edit_file', {
      path: 'src/broken.js',
      old_content: 'x\n',
      new_content: 'x\ny\n'
    }, { success: false, error: 'failed' }, { toolCallId: 'tool-2' })
    ctx.assert.equal(snapAdded(), 1, 'failed result should remove its pending contribution')

    pill.clear()
    pill.recordToolStart('text_edit', {
      path: 'src/a.js',
      edits: [{ op: 'insert_at_line', line: 1, content: 'const a = 1\n' }]
    }, { toolCallId: 'tool-3' })
    ctx.assert.ok(snapAdded() === 1 || root.innerHTML.includes('ai-change-pill'), 'first live text_edit should render the pill immediately')
    ctx.assert.equal(snapAdded(), 1, 'first live text_edit should estimate one added line')

    pill.recordToolResult('text_edit', {
      path: 'src/a.js',
      edits: [{ op: 'insert_at_line', line: 1, content: 'const a = 1\n' }]
    }, { success: true, added_lines: 1, removed_lines: 0 }, { toolCallId: 'tool-3' })
    ctx.assert.equal(snapAdded(), 1, 'text_edit result should use returned line delta')

    pill.recordToolResult('text_edit', {
      path: 'src/b.js',
      edits: [{ op: 'replace_lines', start_line: 3, end_line: 3, content: 'const b = 2\nconst c = 3\n' }]
    }, { success: true, added_lines: 2, removed_lines: 1 }, { toolCallId: 'tool-4' })
    ctx.assert.equal(snapFiles(), 2, 'second file should accumulate instead of clearing the first file')
    ctx.assert.equal(snapAdded(), 3, 'live summary should include additions from both files')
    ctx.assert.equal(snapRemoved(), 1, 'live summary should include removals from later files')
    ctx.assert.ok(pillFileCount(root.innerHTML, 2) || snapFiles() === 2, 'pill UI or snapshot should reflect two files')

    pill.clear()
    ;[
      ['assets/banner.png', 'image'],
      ['assets/narration.mp3', 'audio'],
      ['assets/demo.mp4', 'video']
    ].forEach(([mediaPath, label], index) => {
      pill.recordToolStart('write_file', {
        path: mediaPath,
        content: 'binary media placeholder'
      }, { toolCallId: `media-${index}` })
      pill.recordToolResult('write_file', {
        path: mediaPath,
        content: 'binary media placeholder'
      }, { success: true, path: mediaPath }, { toolCallId: `media-${index}` })
      ctx.assert.equal(snapFiles(), 0, `${label} output must not be counted as a diff file`)
      ctx.assert.equal(snapAdded(), 0, `${label} output must not contribute diff additions`)
    })

    pill.recordToolResult('generate_image', {}, { success: true, path: 'assets/cover.png' }, { toolCallId: 'generated-image' })
    ctx.assert.equal(snapFiles(), 0, 'dedicated media generation must not be counted as a diff file')
  }
}
