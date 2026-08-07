/* 灵犀 i18n 极简框架
 * 用法：
 *   <span data-i18n="common.confirm">确定</span>
 *   <input data-i18n-placeholder="input.search" placeholder="搜索">
 *   <button data-i18n-title="btn.save" title="保存">
 *   动态内容：i18n.t('common.confirm')
 *   切换语言：i18n.setLocale('en-US')
 *   启动时调用：await i18n.init()
 *
 * 两种加载方式都支持：
 *   - 普通 <script src="i18n.js">：会自动挂 window.i18n，自动 DOMContentLoaded 跑 init + applyI18n
 *   - ES module：import { i18n } from './i18n.js' 也可拿到
 */

// 用一个 IIFE 构造 I18n 对象（避免顶层污染）
const _i18nFactory = (function () {
  'use strict';
  const STORAGE_KEY = 'lingxiLanguage';
  const SUPPORTED = ['zh-CN', 'en-US'];
  const FALLBACK = 'zh-CN';

  return {
    STORAGE_KEY,
    SUPPORTED,
    FALLBACK,
    create() {
      const I18n = {
        locale: FALLBACK,
        translations: {},
        _ready: false,
        _readyPromise: null,
        _onChangeCallbacks: [],
        _root: null, // 浏览器环境（window）或 Node 环境（globalThis）

        bindRoot(root) { this._root = root; return this; },

        async init() {
          if (this._readyPromise) return this._readyPromise;
          this._readyPromise = (async () => {
            // 默认语言（zh-CN）做静态 import（顶部已 import），直接读
            // 其他语言（en-US）做动态 import
            for (const loc of SUPPORTED) {
              if (this.translations[loc] && Object.keys(this.translations[loc]).length > 0) continue;
              if (typeof window !== 'undefined' && window.__I18N_LOCALE__ && window.__I18N_LOCALE__[loc]) {
                this.translations[loc] = window.__I18N_LOCALE__[loc];
                continue;
              }
              try {
                const mod = await import(`../../i18n/${loc}.js`);
                this.translations[loc] = (mod && mod.default) || mod.translations || {};
              } catch (e) {
                console.warn('[i18n] load failed:', loc, e);
                this.translations[loc] = {};
              }
            }
            const root = this._root || (typeof window !== 'undefined' ? window : null);
            const saved = (() => {
              try { return root && root.localStorage ? root.localStorage.getItem(STORAGE_KEY) : null; }
              catch (e) { return null; }
            })();
            this.locale = SUPPORTED.includes(saved) ? saved : FALLBACK;
            this._ready = true;
            this._notifyChange();
            return this.locale;
          })();
          return this._readyPromise;
        },

        setLocale(locale, opts = {}) {
          if (!SUPPORTED.includes(locale)) {
            console.warn('[i18n] unsupported locale:', locale);
            return;
          }
          this.locale = locale;
          const root = this._root || (typeof window !== 'undefined' ? window : null);
          try { if (root && root.localStorage) root.localStorage.setItem(STORAGE_KEY, locale); } catch (e) {}
          if (opts.persist !== false) {
            try {
              if (root && root.api && typeof root.api.setLanguage === 'function') {
                root.api.setLanguage(locale);
              }
            } catch (e) {}
          }
          this._notifyChange();
          if (opts.applyDom !== false) this.applyI18n();
        },

        onChange(cb) {
          if (typeof cb === 'function') this._onChangeCallbacks.push(cb);
        },

        _notifyChange() {
          for (const cb of this._onChangeCallbacks) {
            try { cb(this.locale); } catch (e) { console.error(e); }
          }
        },

        t(key, params) {
          if (!key) return '';
          const dict = this.translations[this.locale] || {};
          const fb = this.translations[FALLBACK] || {};
          let text = dict[key];
          if (text == null) text = fb[key];
          if (text == null) text = key;
          if (params && typeof text === 'string') {
            return Object.keys(params).reduce((s, k) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]), text);
          }
          return text;
        },

        applyI18n(scope) {
          const root = this._root || (typeof window !== 'undefined' ? window : null);
          const doc = (scope && scope.querySelectorAll) ? scope : (root && root.document);
          if (!doc) return;
          const map = [
            ['data-i18n', 'textContent'],
            ['data-i18n-placeholder', 'placeholder'],
            ['data-i18n-title', 'title'],
            ['data-i18n-aria-label', 'ariaLabel'],
          ];
          for (const [attr, prop] of map) {
            const nodes = doc.querySelectorAll(`[${attr}]`);
            for (const el of nodes) {
              const key = el.getAttribute(attr);
              if (!key) continue;
              let params = null;
              const paramsAttr = el.getAttribute('data-i18n-params');
              if (paramsAttr) {
                try { params = JSON.parse(paramsAttr); }
                catch (e) { params = null; }
              }
              const val = this.t(key, params);
              if (prop === 'textContent') el.textContent = val;
              else el[prop] = val;
            }
          }
          const html = (doc && doc.documentElement) ? doc.documentElement : null;
          if (html) html.setAttribute('lang', this.locale);
        },

        is(locale) { return this.locale === locale; },

        n(value, options = {}) {
          const v = Number(value) || 0;
          const { one, other, zero, two } = options;
          if (v === 0 && zero != null) return this.t(zero);
          if (v === 1 && one != null) return this.t(one);
          if (v === 2 && two != null) return this.t(two);
          return this.t(other || 'common.count', { count: v });
        },

        SUPPORTED,
        STORAGE_KEY,
      };
      return I18n;
    }
  };
})();

// 创建全局唯一 i18n 实例（暴露到文件顶层，方便 export）
const i18n = _i18nFactory.create();

// 默认语言（zh-CN）做静态 import（与 i18n.js 一起被浏览器加载）
// 其他语言（en-US）在 init() 内部做动态 import
import zhCnStatic from '../../i18n/zh-CN.js';
i18n.translations['zh-CN'] = (zhCnStatic && zhCnStatic.default) || zhCnStatic || {};

// 浏览器环境：自动绑定 window、自动 bootstrap
(function autoBind() {
  if (typeof window === 'undefined') return;
  i18n.bindRoot(window);
  try { window.i18n = i18n; } catch (e) {}

  function _autoBootstrap() {
    try { i18n.applyI18n(window.document); } catch (e) { console.error('[i18n] auto apply failed', e); }
  }
  i18n.init()
    .then(_autoBootstrap)
    .catch((e) => console.error('[i18n] auto init failed', e));

  // i18n.init() 内部用的是 import() 异步加载翻译表，
  // 而 document 可能在 init 之前已 ready。
  // 当 readyState 非 loading 时也跑一次 applyI18n，
  // 确保静态节点的初始翻译不丢
  if (window.document && window.document.readyState !== 'loading') {
    // 主流程已经在 init().then 里跑了 applyI18n，这里不重复
  } else if (window.document) {
    window.document.addEventListener('DOMContentLoaded', _autoBootstrap);
  }
})();

// ES module 导出：让子窗口可以 `import { i18n } from './i18n.js'`
export { i18n };
export default i18n;
