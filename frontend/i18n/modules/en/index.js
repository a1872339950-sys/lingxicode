/* English translations — business module merger
 * Each module file exports a default key/value dictionary.
 * This file merges them in namespace order.
 * To add a module: create modules/en/<name>.js, then import + add to `modules` below.
 */
import common from './common.js';
import menu from './menu.js';
import tab from './tab.js';
import sidebar from './sidebar.js';
import settings from './settings.js';
import chat from './chat.js';
import project from './project.js';
import model from './model.js';
import tool from './tool.js';
import tool_display from './tool_display.js';
import terminal from './terminal.js';
import editor from './editor.js';
import status from './status.js';
import dialog from './dialog.js';
import music from './music.js';
import prompt from './prompt.js';
import error from './error.js';
import time from './time.js';
import context from './context.js';
import auto from './auto.js';
import git_panel from './git_panel.js';
import app from './app.js';
import ai_message_ui from './ai_message_ui.js';
import window_tabs from './window_tabs.js';
import integration_market from './integration_market.js';
import skills_main from './skills_main.js';
import settings_main from './settings_main.js';
import storage_settings from './storage_settings.js';
import quick_model_settings from './quick_model_settings.js';
import summary_menu from './summary_menu.js';
import worker_model_settings from './worker_model_settings.js';
import ai_permission_settings from './ai_permission_settings.js';
import file_preview from './file_preview.js';
import change_session_actions from './change_session_actions.js';
import context_compression_status from './context_compression_status.js';
import context_visibility from './context_visibility.js';
import theme_settings from './theme_settings.js';
import context_ui from './context_ui.js';
import ai_tool_renderer from './ai_tool_renderer.js';
import ask_popup from './ask_popup.js';
import attachments from './attachments.js';
import chat_history from './chat_history.js';
import chat_renderer from './chat_renderer.js';
import execution_progress_ui from './execution_progress_ui.js';
import file_utils from './file_utils.js';
import i18n_settings from './i18n_settings.js';
import message_copy from './message_copy.js';
import models from './models.js';
import project_list from './project_list.js';
import projects from './projects.js';
import settings_panel_ui from './settings_panel_ui.js';

const modules = [
  common, menu, tab, sidebar, settings,
  chat, project, model, tool, tool_display, terminal,
  editor, status, dialog,
  music, prompt, error, time,
  context, auto, git_panel,
  app, ai_message_ui, window_tabs, integration_market, skills_main,
  settings_main, storage_settings, quick_model_settings, summary_menu, worker_model_settings,
  ai_permission_settings, file_preview, change_session_actions,
  context_compression_status, context_visibility,
  theme_settings, context_ui,
  ai_tool_renderer,
  ask_popup,
  attachments,
  chat_history,
  chat_renderer,
  execution_progress_ui,
  file_utils,
  i18n_settings,
  message_copy,
  models,
  project_list,
  projects,
  settings_panel_ui,
];

export const translations = Object.assign({}, ...modules);
export default translations;
