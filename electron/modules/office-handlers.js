/**
 * Office 工具 handler（Excel + PowerPoint）
 * 从 tools.js 的 executeToolForProject switch 中提取
 *
 * 导出 handleOfficeTool(name, args) —— 命中返回 { handled: true, result }，否则 { handled: false }
 */

const { executePPTCommand, executeExcelCommand, executeDocxCommand } = require('./office-bridge')

// Excel 基础工具：走 excel-control 模块（COM 自动化）
const excelBasicHandlers = {
  excel_open: (args) => require('./excel-control').openExcel(args.visible !== false),
  excel_load: (args) => require('./excel-control').loadFile(args.file_path),
  excel_create: (args) => require('./excel-control').createNew(),
  excel_write_cell: (args) => require('./excel-control').writeCell(args.row, args.col, args.value, args.show_mouse !== false),
  excel_write_range: (args) => require('./excel-control').writeRange(args.start_row, args.start_col, args.data, args.show_mouse !== false),
  excel_read_range: (args) => require('./excel-control').readRange(args.start_row, args.start_col, args.rows, args.cols),
  excel_set_style: (args) => require('./excel-control').setStyle(args.start_row, args.start_col, args.rows, args.cols, {
    bg_color: args.bg_color,
    text_color: args.text_color,
    bold: args.bold
  }),
  excel_sort_column: (args) => require('./excel-control').sortColumn(args.col, args.order),
  excel_save: (args) => require('./excel-control').saveFile(args.file_path),
  excel_close: (args) => require('./excel-control').closeExcel()
}

// Excel 高级工具：走 Python 脚本桥
const excelAdvancedHandlers = {
  excel_set_formula: ['set_formula'],
  excel_get_formula: ['get_formula'],
  excel_add_chart: ['add_chart'],
  excel_delete_chart: ['delete_chart'],
  excel_list_charts: ['list_charts'],
  excel_insert_rows: ['insert_rows'],
  excel_insert_columns: ['insert_columns'],
  excel_delete_rows: ['delete_rows'],
  excel_delete_columns: ['delete_columns'],
  excel_set_row_height: ['set_row_height'],
  excel_set_column_width: ['set_column_width'],
  excel_merge_cells: ['merge_cells'],
  excel_unmerge_cells: ['unmerge_cells'],
  excel_set_border: ['set_border'],
  excel_set_alignment: ['set_alignment'],
  excel_add_conditional_format_color_scale: ['add_conditional_format_color_scale'],
  excel_add_conditional_format_data_bar: ['add_conditional_format_data_bar'],
  excel_clear_conditional_formats: ['clear_conditional_formats'],
  excel_create_sheet: ['create_sheet'],
  excel_delete_sheet: ['delete_sheet'],
  excel_rename_sheet: ['rename_sheet'],
  excel_switch_sheet: ['switch_sheet'],
  excel_list_sheets: ['list_sheets'],
  excel_get_active_sheet: ['get_active_sheet'],
  excel_auto_filter: ['auto_filter'],
  excel_filter_column: ['filter_column'],
  excel_clear_filter: ['clear_filter'],
  excel_add_data_validation_list: ['add_data_validation_list'],
  excel_clear_data_validation: ['clear_data_validation'],
  excel_add_image: ['add_image'],
  excel_add_comment: ['add_comment'],
  excel_delete_comment: ['delete_comment'],
  excel_find_value: ['find_value'],
  excel_replace_value: ['replace_value'],
  excel_freeze_panes: ['freeze_panes'],
  excel_unfreeze_panes: ['unfreeze_panes'],
  excel_get_used_range: ['get_used_range'],
  excel_clear_range: ['clear_range'],
  excel_clear_range_contents: ['clear_range_contents'],
  excel_clear_range_formats: ['clear_range_formats'],
  excel_run_script: ['run_script']
}

// PPT 工具：全部走 Python 脚本桥
const pptHandlers = {
  ppt_open: ['open_ppt'],
  ppt_create: ['create_new'],
  ppt_load: ['load_file'],
  ppt_add_slide: ['add_slide'],
  ppt_set_title: ['set_slide_title'],
  ppt_set_content: ['set_slide_content'],
  ppt_add_text: ['add_text_box'],
  ppt_add_bullets: ['add_bullet_list'],
  ppt_set_bg_color: ['set_background_color'],
  ppt_goto_slide: ['go_to_slide'],
  ppt_save: ['save_file'],
  ppt_close: ['close_ppt'],
  ppt_add_image: ['add_image'],
  ppt_add_video: ['add_video'],
  ppt_add_audio: ['add_audio'],
  ppt_add_shape: ['add_shape'],
  ppt_add_line: ['add_line'],
  ppt_add_animation: ['add_animation'],
  ppt_add_motion_path: ['add_motion_path'],
  ppt_set_animation_timing: ['set_animation_timing'],
  ppt_set_transition: ['set_transition'],
  ppt_set_transition_sound: ['set_transition_sound'],
  ppt_set_font_style: ['set_font_style'],
  ppt_set_element_position: ['set_element_position'],
  ppt_set_element_size: ['set_element_size'],
  ppt_set_element_rotation: ['set_element_rotation'],
  ppt_set_gradient_background: ['set_gradient_background'],
  ppt_set_shape_fill: ['set_shape_fill'],
  ppt_add_hyperlink: ['add_hyperlink'],
  ppt_add_click_action: ['add_click_action'],
  ppt_add_chart: ['add_chart'],
  ppt_align_elements: ['align_elements'],
  ppt_distribute_elements: ['distribute_elements'],
  ppt_group_shapes: ['group_shapes'],
  ppt_duplicate_shape: ['duplicate_shape'],
  ppt_delete_shape: ['delete_shape'],
  ppt_rename_shape: ['rename_shape'],
  ppt_get_shape_info: ['get_shape_info'],
  ppt_list_shapes: ['list_shapes'],
  ppt_run_script: ['run_script']
}

// Word 工具：python-docx 桥
const docxHandlers = {
  docx_create: ['create_new'],
  docx_open: ['open_file'],
  docx_load: ['open_file'],
  docx_save: ['save_file'],
  docx_add_heading: ['add_heading'],
  docx_add_paragraph: ['add_paragraph'],
  docx_set_paragraph: ['set_paragraph'],
  docx_replace_text: ['replace_text'],
  docx_get_outline: ['get_outline'],
  docx_fill_placeholders: ['fill_placeholders'],
  docx_close: ['close'],
  docx_copy_template: ['copy_template'],
  docx_run_script: ['run_script']
}

/**
 * 处理 Office 工具调用
 * @returns {Promise<{ handled: true, result: any } | { handled: false }>}
 */
async function handleOfficeTool(name, args) {
  // Excel 基础工具
  const basicHandler = excelBasicHandlers[name]
  if (basicHandler) {
    try {
      const result = await basicHandler(args || {})
      return { handled: true, result }
    } catch (e) {
      return { handled: true, result: { success: false, error: e.message } }
    }
  }

  // Excel 高级工具
  const excelAction = excelAdvancedHandlers[name]
  if (excelAction) {
    try {
      const result = await executeExcelCommand(excelAction[0], args)
      return { handled: true, result }
    } catch (e) {
      return { handled: true, result: { success: false, error: e.message } }
    }
  }

  // PPT 工具
  const pptAction = pptHandlers[name]
  if (pptAction) {
    try {
      const result = await executePPTCommand(pptAction[0], args)
      return { handled: true, result }
    } catch (e) {
      return { handled: true, result: { success: false, error: e.message } }
    }
  }

  // Word 工具
  const docxAction = docxHandlers[name]
  if (docxAction) {
    try {
      const result = await executeDocxCommand(docxAction[0], args || {})
      return { handled: true, result }
    } catch (e) {
      return { handled: true, result: { success: false, error: e.message } }
    }
  }

  return { handled: false }
}

module.exports = {
  handleOfficeTool,
  excelBasicHandlers,
  excelAdvancedHandlers,
  pptHandlers,
  docxHandlers
}
