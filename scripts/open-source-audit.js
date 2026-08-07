const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const failures = []
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  '.installer-build',
  '.lingxi',
  '.tmp-real-scenarios',
  'change-sessions',
  'data',
  'output'
])
const textExtensions = new Set([
  '.bat', '.cjs', '.cs', '.css', '.html', '.js', '.json', '.jsx', '.md',
  '.mjs', '.nsh', '.ps1', '.py', '.scss', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml'
])

function relative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/')
}

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath, output)
    else output.push(fullPath)
  }
  return output
}

function fail(message) {
  failures.push(message)
}

const forbiddenPaths = [
  'services/lingxi-model-gateway',
  'plugins/react-bits',
  'plugins/product-design-plus'
]

for (const item of forbiddenPaths) {
  if (fs.existsSync(path.join(root, item))) fail(`不应存在的目录或文件: ${item}`)
}

for (const required of ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', '一键启动开发版.bat']) {
  if (!fs.existsSync(path.join(root, required))) fail(`缺少开源文件: ${required}`)
}

const attributionFiles = [
  'skills/web-design/LICENSE',
  'skills/MATTPOCOCK_SKILLS_LICENSE.txt',
  'plugins/character-animation/NOTICE.md',
  'plugins/character-animation/skills/character-animation/LICENSE.txt'
]

for (const required of attributionFiles) {
  if (!fs.existsSync(path.join(root, required))) fail(`缺少第三方来源或许可证文件: ${required}`)
}

const thirdPartyNoticesPath = path.join(root, 'THIRD_PARTY_NOTICES.md')
if (fs.existsSync(thirdPartyNoticesPath)) {
  const thirdPartyNotices = fs.readFileSync(thirdPartyNoticesPath, 'utf8')
  for (const marker of ['xiaopu-ai/web-design', 'mattpocock/skills', 'openai/skills · hatch-pet']) {
    if (!thirdPartyNotices.includes(marker)) fail(`第三方声明缺少来源: ${marker}`)
  }
}

const launcherPath = path.join(root, '一键启动开发版.bat')
if (fs.existsSync(launcherPath)) {
  const launcher = fs.readFileSync(launcherPath)
  const hasUtf8Bom = launcher[0] === 0xef && launcher[1] === 0xbb && launcher[2] === 0xbf
  if (!hasUtf8Bom) fail('一键启动脚本必须保留 UTF-8 BOM，否则中文 Windows CMD 可能闪退')
  const launcherText = launcher.toString('utf8')
  if (/(^|[^\r])\n/.test(launcherText)) fail('一键启动脚本必须使用 CRLF 换行')
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (!packageJson.license) fail('package.json 缺少 license')
if (path.isAbsolute(packageJson.build?.directories?.output || '')) fail('构建输出目录不能写死为绝对路径')
if ((packageJson.build?.files || []).some(item => /^services(?:\/|\*|$)/.test(item))) {
  fail('打包规则仍包含 services')
}

const patterns = [
  ['OpenAI 格式密钥', /(?<![A-Za-z])sk-[A-Za-z0-9_-]{24,}/],
  ['AWS Access Key', /AKIA[0-9A-Z]{16}/],
  ['私钥', /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ['硬编码 Bearer Token', /Bearer\s+[A-Za-z0-9._-]{24,}/],
  ['个人 Windows 用户路径', /[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/i]
]

for (const filePath of walk(root)) {
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) continue
  let text = ''
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    continue
  }
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) fail(`${label}: ${relative(filePath)}`)
  }
}

const configDir = path.join(root, 'config')
if (fs.existsSync(configDir)) {
  for (const name of fs.readdirSync(configDir)) {
    if (name.endsWith('.json') && !name.endsWith('.example.json')) {
      fail(`本机配置不应进入仓库: config/${name}`)
    }
  }
}

if (failures.length) {
  console.error(`开源检查失败，共 ${failures.length} 项：`)
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log('开源检查通过：未发现密钥、私人路径、运行数据或受限组件。')
