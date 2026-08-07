window.AppLogger = {
  _level: 2, // 0=debug, 1=info, 2=warn, 3=error
  debug(...args) { if (this._level <= 0) console.log(...args); },
  info(...args) { if (this._level <= 1) console.log(...args); },
  warn(...args) { if (this._level <= 2) console.warn(...args); },
  error(...args) { if (this._level <= 3) console.error(...args); },
};
