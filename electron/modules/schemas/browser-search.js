/**
 * 工具 Schema - browser-search 类别 (6 个工具)
 * 自动拆分自 tools-schema.js
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "lxweb",
      "description": "灵犀内置 Web 工具。用于搜索公开网页、抓取网页正文、在网页正文中查找关键词、在右侧窗口打开网页、在系统浏览器打开链接或查看状态。传 url 且不传 action 时自动抓取网页；传 query 且不传 action 时自动搜索。搜索一个主题的多组相关关键词时，优先一次传 queries 数组，工具会并行搜索并合并去重，不要拆成多次串行搜索。用户要求“右侧窗口/右侧页面/右侧打开网页”时使用 action=open_right，不能回答只能打开系统浏览器。默认搜索优先百度，并会并发尝试百度、必应中文、DuckDuckGo 等免费搜索源、去重；普通抓取失败时自动使用隐藏浏览器并发渲染兜底。",
      "parameters": {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "enum": [
              "search",
              "fetch",
              "find",
              "design",
              "open",
              "open_right",
              "status"
            ],
            "description": "可选。操作类型：search 搜索，fetch 抓取网页正文，find 抓取网页后查找关键词，open_right 在主窗口右侧 webview 面板打开网页，open 在系统浏览器打开，status 查看工具状态。不填时根据 query/url 自动判断"
          },
          "query": {
            "type": "string",
            "description": "单个搜索关键词。action=search 且只有一个关键词时填写"
          },
          "queries": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "多个相关搜索关键词。action=search 时可一次传入，工具会并行搜索这些关键词并合并去重；适合搜索某个页面、产品、事件或技术主题的多组相关词"
          },
          "url": {
            "type": "string",
            "description": "网页地址。action=fetch/open/open_right 时填写"
          },
          "pattern": {
            "type": "string",
            "description": "action=find 时填写，要在网页正文中查找的关键词或简单文本模式"
          },
          "max_results": {
            "type": "integer",
            "description": "action=find 时最多返回多少条匹配片段，默认 12，最大 50"
          },
          "viewport_width": {
            "type": "integer",
            "description": "action=design viewport width, default 1440"
          },
          "viewport_height": {
            "type": "integer",
            "description": "action=design viewport height, default 900"
          },
          "scroll_samples": {
            "type": "integer",
            "description": "action=design scroll sample count, default 5, max 12"
          },
          "delay_ms": {
            "type": "integer",
            "description": "action=design render wait time in milliseconds"
          },
          "engine": {
            "type": "string",
            "enum": [
              "auto",
              "baidu",
              "bing_cn",
              "bing",
              "duckduckgo",
              "google"
            ],
            "description": "可选搜索源，默认 auto；auto 会优先百度，并并发尝试多个搜索源"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "discover_code",
      "description": "具体关键词、DOM id、函数名、错误文本、文件名或路径片段",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "具体关键词、DOM id、函数名、错误文本、文件名或路径片段"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少个事实命中，默认由系统控制"
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "browser_search",
      "description": "旧版兼容入口：搜索公开网页信息。新调用请使用 lxweb。支持 queries 数组并行搜索多个相关关键词。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "搜索关键词"
          },
          "queries": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "多个相关搜索关键词，工具会并行搜索并合并去重"
          },
          "engine": {
            "type": "string",
            "enum": [
              "auto",
              "baidu",
              "bing_cn",
              "bing",
              "duckduckgo",
              "google"
            ]
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "browser_fetch",
      "description": "获取网页内容",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "网址"
          }
        },
        "required": [
          "url"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "browser_open",
      "description": "在浏览器中打开网页",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "网址"
          }
        },
        "required": [
          "url"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "research_website_runtime",
      "description": "研究目标网站的设计风格、公开前端代码、资源和运行态交互。参考/借鉴/复刻网站时优先用这个工具，而不是先截图；默认不截图，不依赖静态图片分析；会用隐藏窗口采集多滚动位置 DOM、CSS 设计 token、公开 JS/CSS、图片/视频/音频/SVG、Canvas/WebGL、动画和技术栈信号。适合借鉴网站设计语言、滚动叙事、动效结构和前端实现方式；不要用于绕过登录、抓后端源码或复制非公开代码。",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "目标网站 URL，例如 https://example.com"
          },
          "html_path": {
            "type": "string",
            "description": "本地 HTML 文件路径。可传相对项目路径或绝对路径"
          },
          "viewport_width": {
            "type": "number",
            "description": "隐藏窗口宽度，默认 1440"
          },
          "viewport_height": {
            "type": "number",
            "description": "隐藏窗口高度，默认 900"
          },
          "scroll_samples": {
            "type": "number",
            "description": "滚动采样次数，默认 5，最多 12。用于分析下拉滚动过程中的布局、场景和动效变化"
          },
          "delay_ms": {
            "type": "number",
            "description": "每个滚动采样点等待时间，默认 600ms"
          },
          "include_source": {
            "type": "boolean",
            "description": "是否抓取公开 JS/CSS 源码片段，默认 true"
          },
          "include_assets": {
            "type": "boolean",
            "description": "是否返回图片、视频、音频、SVG 等资源清单，默认 true"
          },
          "same_origin_only": {
            "type": "boolean",
            "description": "抓取公开源码时是否只抓同源资源，默认 true"
          },
          "max_source_files": {
            "type": "number",
            "description": "最多抓取多少个公开 JS/CSS 文件，默认 24"
          },
          "source_sample_chars": {
            "type": "number",
            "description": "每个公开源码文件返回的片段字符数，默认 3000"
          },
          "mode": {
            "type": "string",
            "enum": [
              "design",
              "crawl"
            ],
            "description": "design=single-page runtime design research; crawl=polite same-origin site crawl with robots/sitemap, rate limits, rendered public content extraction, and captcha/anti-bot/login-wall detection without bypass"
          },
          "max_pages": {
            "type": "number",
            "description": "mode=crawl maximum pages, default 12, max 80"
          },
          "max_depth": {
            "type": "number",
            "description": "mode=crawl same-origin link depth, default 2, max 5"
          },
          "respect_robots": {
            "type": "boolean",
            "description": "mode=crawl respect robots.txt, default true"
          },
          "include_sitemap": {
            "type": "boolean",
            "description": "mode=crawl read sitemap.xml and Sitemap entries from robots.txt, default true"
          },
          "crawl_delay_ms": {
            "type": "number",
            "description": "mode=crawl delay between page visits in milliseconds, default 700"
          },
          "page_text_chars": {
            "type": "number",
            "description": "mode=crawl max extracted main text characters per page, default 5000"
          },
          "include_screenshots": {
            "type": "boolean",
            "description": "可选视觉佐证，默认 false。只有需要对照画面时才开启；网站设计和代码分析不得以截图为主证据"
          }
        }
      }
    }
  }
]
