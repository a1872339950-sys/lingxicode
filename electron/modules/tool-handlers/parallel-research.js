const { executeParallelResearch } = require('../parallel-research')

const handlers = {
  parallel_research: executeParallelResearch
}

module.exports = { handlers }