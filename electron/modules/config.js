/**
 * 共享配置中心
 * 管理全局变量，提供 getter/setter 接口
 */

let appDataPath = null
let linguaBasePath = null
let mainWindow = null
let skillsDir = null
let plansDir = null

// AbortControllers 映射（projectId → AbortController）
const abortControllers = new Map()

// 项目实例映射（projectId → instance）
const projectInstances = new Map()

// 已启用的技能列表
let enabledSkills = []

// 所有可用技能（内置 + 用户自定义）
let allSkills = []

module.exports = {
  // appDataPath
  setAppDataPath: (p) => { appDataPath = p },
  getAppDataPath: () => appDataPath,

  // linguaBasePath
  setLinguaBasePath: (p) => { linguaBasePath = p },
  getLinguaBasePath: () => linguaBasePath,

  // mainWindow
  setMainWindow: (win) => { mainWindow = win },
  getMainWindow: () => mainWindow,

  // skillsDir
  setSkillsDir: (p) => { skillsDir = p },
  getSkillsDir: () => skillsDir,

  // plansDir
  setPlansDir: (p) => { plansDir = p },
  getPlansDir: () => plansDir,

  // abortControllers
  getAbortControllers: () => abortControllers,
  setAbortController: (projectId, controller) => { abortControllers.set(projectId, controller) },
  deleteAbortController: (projectId) => { abortControllers.delete(projectId) },
  getAbortController: (projectId) => abortControllers.get(projectId),

  // projectInstances
  getProjectInstances: () => projectInstances,
  setProjectInstance: (projectId, instance) => { projectInstances.set(projectId, instance) },
  deleteProjectInstance: (projectId) => { projectInstances.delete(projectId) },
  getProjectInstance: (projectId) => projectInstances.get(projectId),

  // enabledSkills
  setEnabledSkills: (skills) => { enabledSkills = skills },
  getEnabledSkills: () => enabledSkills,
  addEnabledSkill: (skillName) => { if (!enabledSkills.includes(skillName)) enabledSkills.push(skillName) },
  removeEnabledSkill: (skillName) => {
    const idx = enabledSkills.indexOf(skillName)
    if (idx !== -1) enabledSkills.splice(idx, 1)
  },

  // allSkills
  setAllSkills: (skills) => { allSkills = skills },
  getAllSkills: () => allSkills
}
