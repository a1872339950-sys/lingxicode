const path = require('path')

module.exports = {
  id: 'runtime-verify-diagnosis',
  title: 'Runtime interaction failures preserve actionable diagnosis',
  tags: ['runtime', 'interaction', 'diagnosis'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/website-research\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i
  ],

  async run(ctx) {
    const { buildInteractionFailureDiagnosis } = require(path.join(ctx.root, 'electron/modules/tool-handlers/website-research'))
    const populatedPage = {
      url: 'http://localhost:3000/projects',
      title: 'Projects',
      readyState: 'complete',
      page: {
        url: 'http://localhost:3000/projects',
        title: 'Projects',
        readyState: 'complete',
        bodyTextLength: 120,
        bodyChildCount: 4,
        interactiveElementCount: 2,
        visibleInteractiveElementCount: 1
      },
      interactiveElements: [{ selector: '#open', role: 'button', name: 'Open panel', effectiveVisible: true, interactable: true }],
      selectors: []
    }
    const hiddenBy = { depth: 2, node: { id: 'project-required', tagName: 'DIV' }, reasons: ['display:none'] }
    const hidden = buildInteractionFailureDiagnosis({
      click: {
        found: false,
        reason: 'locator_not_interactable',
        locator: { selector: '#create' },
        candidates: [{ selector: '#create', role: 'button', name: 'Create', effectiveVisible: false, interactable: false, hiddenBy }]
      },
      before: populatedPage,
      after: populatedPage
    })
    ctx.assert.equal(hidden.error_type, 'ui_element_not_interactable', 'hidden controls need a visibility-specific error type')
    ctx.assert.equal(hidden.blocking_evidence?.hiddenBy?.node?.id, 'project-required', 'hidden ancestor evidence must survive classification')

    const missing = buildInteractionFailureDiagnosis({
      click: {
        found: false,
        reason: 'locator_absent',
        locator: { selector: '#missing' },
        nearby_candidates: populatedPage.interactiveElements
      },
      before: populatedPage,
      after: populatedPage
    })
    ctx.assert.equal(missing.error_type, 'ui_locator_not_found', 'missing locators on populated pages need a locator-specific error')
    ctx.assert.equal(missing.nearby_candidates?.[0]?.selector, '#open', 'nearby candidates must be returned to the model')

    const blankPage = {
      url: 'file:///empty/index.html',
      title: '',
      readyState: 'complete',
      page: {
        url: 'file:///empty/index.html',
        readyState: 'complete',
        bodyTextLength: 0,
        bodyChildCount: 0,
        interactiveElementCount: 0,
        visibleInteractiveElementCount: 0
      },
      interactiveElements: [],
      selectors: []
    }
    const blank = buildInteractionFailureDiagnosis({
      click: { found: false, reason: 'locator_absent', locator: { selector: '#create' } },
      before: blankPage,
      after: blankPage
    })
    ctx.assert.equal(blank.error_type, 'runtime_target_blank_or_wrong', 'blank pages must not be flattened into generic not_found')
    ctx.assert.ok(/绑定|runtime_id/.test(blank.next_action), 'blank runtime diagnosis should direct the model to a bound runtime target')

    const expectedHidden = {
      selector: '#panel',
      exists: true,
      visible: false,
      hiddenBy: { depth: 1, node: { id: 'shell' }, reasons: ['display:none'] },
      ancestorChain: [{ depth: 0, node: { id: 'panel' } }, { depth: 1, node: { id: 'shell' } }]
    }
    const afterClick = { ...populatedPage, selectors: [expectedHidden] }
    const transition = buildInteractionFailureDiagnosis({
      click: { found: true, locator: { selector: '#open' } },
      before: populatedPage,
      after: afterClick,
      expectedVisibleSelector: '#panel'
    })
    ctx.assert.equal(transition.error_type, 'ui_state_transition_failed', 'existing-but-hidden expected state needs a transition-specific error')
    ctx.assert.equal(transition.blocking_evidence?.hiddenBy?.node?.id, 'shell', 'expected-state diagnosis must preserve its hidden ancestor')
  }
}
