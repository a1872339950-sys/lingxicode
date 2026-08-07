/* i18n 设置项：把"语言"控件注入设置面板
 * 启动顺序：必须在 i18n.init() 完成后才能调用
 */
(function () {
  'use strict';

  function createLanguageSection() {
    // 查找设置面板"其他"内容容器，附加一段独立的"语言"区域
    const host = document.getElementById('settingsContentOther');
    if (!host) {
      console.warn('[i18n-settings] settingsContentOther not found');
      return;
    }

    // 防重复注入
    if (document.getElementById('i18nLanguageSection')) return;

    // 创建独立 section
    const section = document.createElement('div');
    section.id = 'i18nLanguageSection';
    section.className = 'settings-section';
    section.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid var(--border-color,#2a2f3a);';
    section.innerHTML = `
      <h3 class="settings-section-title" data-i18n="settings.language">语言</h3>
      <p class="settings-section-desc" data-i18n="settings.language.desc" style="font-size:12px;color:var(--text-secondary,#888);margin:4px 0 12px;">界面语言。切换后新回复、思考块、按钮文字会跟着变。文件名、路径、项目名等真实信息原样显示。</p>
      <div class="settings-row" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="lang-btn" data-locale="zh-CN"
          style="padding:8px 16px;border-radius:6px;border:1px solid var(--border-color,#2a2f3a);background:var(--bg-primary,#1a1d24);color:var(--text-primary,#eee);cursor:pointer;font-size:13px;">
          简体中文
        </button>
        <button type="button" class="lang-btn" data-locale="en-US"
          style="padding:8px 16px;border-radius:6px;border:1px solid var(--border-color,#2a2f3a);background:var(--bg-primary,#1a1d24);color:var(--text-primary,#eee);cursor:pointer;font-size:13px;">
          English
        </button>
      </div>
      <div id="i18nLanguageStatus" style="margin-top:8px;font-size:12px;color:var(--text-secondary,#888);min-height:18px;"></div>
    `;
    host.appendChild(section);

    // 按钮样式（高亮当前语言）
    function highlightActive() {
      const active = (window.i18n && window.i18n.locale) || 'zh-CN';
      section.querySelectorAll('.lang-btn').forEach(btn => {
        const isActive = btn.getAttribute('data-locale') === active;
        btn.style.background = isActive
          ? 'var(--accent-primary,#5b8def)'
          : 'var(--bg-primary,#1a1d24)';
        btn.style.color = isActive ? '#fff' : 'var(--text-primary,#eee)';
        btn.style.borderColor = isActive
          ? 'var(--accent-primary,#5b8def)'
          : 'var(--border-color,#2a2f3a)';
      });
    }
    highlightActive();

    // 绑定点击
    section.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const locale = btn.getAttribute('data-locale');
        if (!window.i18n) return;
        window.i18n.setLocale(locale);
        highlightActive();
        const status = document.getElementById('i18nLanguageStatus');
        if (status) {
          status.textContent = (window.i18n && window.i18n.t)
            ? window.i18n.t('settings.saved')
            : ((window.i18n?.t?.('auto.js_i18n_settings_67_1') ?? '已保存'));
          setTimeout(() => { if (status) status.textContent = ''; }, 1800);
        }
      });
    });

    // 监听语言变化，更新高亮
    if (window.i18n && typeof window.i18n.onChange === 'function') {
      window.i18n.onChange(highlightActive);
    }
  }

  // 等待 i18n ready + DOM ready
  async function bootstrap() {
    // DOM ready
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }
    // i18n ready
    if (window.i18n && typeof window.i18n.init === 'function') {
      try { await window.i18n.init(); } catch (e) { console.error(e); }
    }
    createLanguageSection();
    // 应用一次 i18n 把新注入的 data-i18n 翻译掉
    if (window.i18n && typeof window.i18n.applyI18n === 'function') {
      window.i18n.applyI18n();
    }
  }

  bootstrap();
})();
