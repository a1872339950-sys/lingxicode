/* 灵犀中文翻译表（默认）
 * 命名规范：模块.位置
 * 不翻译：文件名、路径、项目名、模型返回内容、聊天内容
 *
 * 翻译内容已按业务模块拆分到 modules/zh/ 目录下；新增/修改 key 请到对应模块文件。
 * 本文件仅作为 i18n.init() 动态 import() 的入口。
 */
import { translations } from './modules/zh/index.js';

export { translations };
export default translations;
