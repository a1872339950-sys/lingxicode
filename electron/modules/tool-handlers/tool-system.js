const handlers = {
  tool_self_check: async (args, ctx) => {
    const { runToolSelfCheck } = require('../tool-self-check')
    return runToolSelfCheck(args || {}, ctx || {})
  },
  create_skill_draft: async (args, ctx) => {
    const projectSkillDrafts = require('../project-skill-drafts')
    return projectSkillDrafts.createSkillDraft(args || {}, ctx || {})
  },
  install_skill_draft: async (args, ctx) => {
    const projectSkillDrafts = require('../project-skill-drafts')
    return projectSkillDrafts.installSkillDraft(args || {}, ctx || {})
  },
  list_skill_drafts: async (args, ctx) => {
    const projectSkillDrafts = require('../project-skill-drafts')
    const projectPath = ctx?.projectPath || args?.projectPath || ''
    const scope = String(args?.scope || '').trim().toLowerCase()
    const globalDrafts = projectSkillDrafts.listSkillDrafts(projectPath, 'global')
    const projectDrafts = projectPath ? projectSkillDrafts.listSkillDrafts(projectPath, 'project') : []
    return {
      success: true,
      drafts: scope === 'project' ? projectDrafts : scope === 'global' ? globalDrafts : globalDrafts,
      globalDrafts,
      projectDrafts,
      skills: projectSkillDrafts.listProjectSkills(projectPath)
    }
  }
}

module.exports = {
  handlers
}
