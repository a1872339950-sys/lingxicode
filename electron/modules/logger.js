'use strict';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

// 通过环境变量 LOG_LEVEL 控制日志级别，默认为 warn
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.warn;

function shouldLog(level) {
  return LOG_LEVELS[level] >= currentLevel;
}

const logger = {
  debug(...args) { if (shouldLog('debug')) console.log(...args); },
  info(...args) { if (shouldLog('info')) console.log(...args); },
  warn(...args) { if (shouldLog('warn')) console.warn(...args); },
  error(...args) { if (shouldLog('error')) console.error(...args); },
};

module.exports = logger;
