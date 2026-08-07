/**
 * 右侧外部 webview preload — 对齐 Codex Client Hints 品牌
 * 不暴露 Node/IPC。仅修正 navigator.userAgentData.brands，避免页面脚本读到 Electron。
 */

const chromeVersion = process.versions.chrome || '150.0.0.0'
const major = String(chromeVersion).split('.')[0] || '150'
const platformName =
  process.platform === 'darwin' ? 'macOS' :
  process.platform === 'linux' ? 'Linux' :
  'Windows'

// 与 Codex k6 一致的 brands 顺序/GREASE
const brands = [
  { brand: 'Chromium', version: major },
  { brand: 'Google Chrome', version: major },
  { brand: 'Not=A?Brand', version: '24' }
]

const spoofSource = `(() => {
  try {
    if (window.__lingxiUaDataPatched) return;
    window.__lingxiUaDataPatched = true;
    const brands = ${JSON.stringify(brands)};
    const platformName = ${JSON.stringify(platformName)};
    const chromeVersion = ${JSON.stringify(chromeVersion)};
    const fullVersionList = [
      { brand: 'Chromium', version: chromeVersion },
      { brand: 'Google Chrome', version: chromeVersion },
      { brand: 'Not=A?Brand', version: '10.0.0.0' }
    ];
    const uaData = {
      brands,
      mobile: false,
      platform: platformName,
      getHighEntropyValues: async () => ({
        brands,
        mobile: false,
        platform: platformName,
        platformVersion: platformName === 'Windows' ? '15.0.0' : '13.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        uaFullVersion: chromeVersion,
        fullVersionList,
        wow64: false
      }),
      toJSON: () => ({ brands, mobile: false, platform: platformName })
    };
    try {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        get: function () { return uaData; },
        configurable: true
      });
    } catch (_) {
      try {
        Object.defineProperty(navigator, 'userAgentData', {
          get: function () { return uaData; },
          configurable: true
        });
      } catch (__) {}
    }
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: function () { return false; },
        configurable: true
      });
    } catch (_) {}
  } catch (e) {}
})();`

function inject() {
  try {
    if (!document.documentElement) return false
    if (document.documentElement.dataset.lingxiUaData === '1') return true
    const script = document.createElement('script')
    script.textContent = spoofSource
    document.documentElement.insertBefore(script, document.documentElement.firstChild)
    script.remove()
    document.documentElement.dataset.lingxiUaData = '1'
    return true
  } catch (_) {
    return false
  }
}

if (!inject()) {
  const observer = new MutationObserver(() => {
    if (inject()) observer.disconnect()
  })
  try { observer.observe(document, { childList: true, subtree: true }) } catch (_) {}
  document.addEventListener('DOMContentLoaded', () => {
    inject()
    try { observer.disconnect() } catch (_) {}
  }, { once: true })
}
