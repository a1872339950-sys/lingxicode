/**
 * 灵犀网页交付脚手架入口。
 * 骨架阶段仅做轻量提示；成品内容由 AI 替换 index.html / styles.css 后自然生效。
 */
(function () {
  const stage = document.body?.getAttribute('data-lingxi-stage') || 'skeleton'
  if (stage === 'skeleton') {
    console.info('[lingxi-site] skeleton ready')
  }
})()
