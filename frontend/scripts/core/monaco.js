/**
 * Monaco editor bootstrap and language detection.
 */
(function() {
  const monacoEditors = new Map()
  let monacoReady = false
  let monacoInitPromise = null

  function initMonaco() {
    if (monacoInitPromise) return monacoInitPromise
    if (window.monaco?.editor) {
      monacoReady = true
      monacoInitPromise = Promise.resolve(true)
      return monacoInitPromise
    }

    monacoInitPromise = new Promise((resolve) => {
      const amdRequire = window.require
      if (!amdRequire?.config) {
        console.warn('[Monaco] AMD loader is unavailable.')
        resolve(false)
        return
      }

      const timeout = setTimeout(() => {
        if (!monacoReady) {
          console.warn('[Monaco] Editor load timed out.')
          resolve(false)
        }
      }, 8000)

      const finish = (ok) => {
        clearTimeout(timeout)
        resolve(ok)
      }

      try {
        amdRequire.config({
          paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }
        })
      } catch (error) {
        console.warn('[Monaco] Loader config failed:', error)
        finish(false)
        return
      }

      amdRequire(['vs/editor/editor.main'], function() {
        if (!window.monaco?.editor) {
          console.warn('[Monaco] Editor loaded without editor API.')
          finish(false)
          return
        }
        monaco.editor.defineTheme('lingxi-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6a9955' },
            { token: 'keyword', foreground: 'c586c0' },
            { token: 'string', foreground: 'ce9178' },
            { token: 'number', foreground: 'b5cea8' },
            { token: 'tag', foreground: '569cd6' },
            { token: 'attribute.name', foreground: '9cdcfe' },
            { token: 'attribute.value', foreground: 'ce9178' }
          ],
          colors: {
            'editor.background': '#16162a',
            'editor.foreground': '#e8e8ed',
            'editorLineNumber.foreground': '#555',
            'editorLineNumber.activeForeground': '#a5b4fc',
            'editor.selectionBackground': '#264f78',
            'editor.lineHighlightBackground': '#1f1f3a',
            'editorCursor.foreground': '#a5b4fc',
            'editorError.foreground': '#f87171',
            'editorWarning.foreground': '#f59e0b'
          }
        })
        monacoReady = true
        finish(true)
      }, function(error) {
        console.warn('[Monaco] Editor load failed:', error)
        finish(false)
      })
    })

    return monacoInitPromise
  }

  function getMonacoLanguage(fileName) {
    const ext = fileName.split('.').pop().toLowerCase()
    const langMap = {
      html: 'html',
      htm: 'html',
      css: 'css',
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      json: 'json',
      md: 'markdown',
      py: 'python',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      go: 'go',
      rs: 'rust',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      svg: 'xml',
      vue: 'html',
      jsx: 'javascript',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      lua: 'lua'
    }
    return langMap[ext] || 'plaintext'
  }

  window.MonacoService = {
    editors: monacoEditors,
    init: initMonaco,
    getLanguage: getMonacoLanguage,
    isReady: () => monacoReady
  }
})()
