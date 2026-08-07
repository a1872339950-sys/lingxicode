"""
Excel 自动化控制脚本
使用 pywin32 COM API 操作 Excel + pyautogui 显示鼠标轨迹
支持高级功能：公式、图表、数据透视表、条件格式化、工作表操作等
"""

import sys
import json
import time
import os

# 调试信息输出到 stderr，不影响 stdout 的 JSON 输出
def debug_print(msg):
    print(msg, file=sys.stderr)

# 尝试导入库
try:
    import win32com.client
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
    debug_print("警告: pywin32 未安装，Excel COM 功能不可用")

try:
    import pyautogui
    HAS_PYAUTOGUI = True
    pyautogui.FAILSAFE = True  # 安全机制：鼠标移到左上角可中止
except ImportError:
    HAS_PYAUTOGUI = False
    debug_print("警告: pyautogui 未安装，鼠标可视化功能不可用")

# ===== Excel VBA 常量定义 =====
# 图表类型
XL_CHART_COLUMN_CLUSTERED = 51
XL_CHART_COLUMN_STACKED = 52
XL_CHART_BAR_CLUSTERED = 57
XL_CHART_BAR_STACKED = 58
XL_CHART_LINE = 4
XL_CHART_LINE_MARKERS = 65
XL_CHART_PIE = 5
XL_CHART_SCATTER = 72
XL_CHART_AREA = 1
XL_CHART_DOUGHNUT = 80

# 条件格式类型
XL_CONDITIONAL_FORMAT_CELL_VALUE = 1
XL_CONDITIONAL_FORMAT_FORMULA = 2
XL_CONDITIONAL_FORMAT_COLOR_SCALE = 3
XL_CONDITIONAL_FORMAT_DATA_BAR = 4

# 边框位置
XL_BORDER_LEFT = 7
XL_BORDER_RIGHT = 8
XL_BORDER_TOP = 9
XL_BORDER_BOTTOM = 10
XL_BORDER_INSIDE_VERTICAL = 11
XL_BORDER_INSIDE_HORIZONTAL = 12

# 边框样式
XL_BORDER_CONTINUOUS = 1
XL_BORDER_DASHED = 2
XL_BORDER_DOTTED = 3
XL_BORDER_DOUBLE = 4
XL_BORDER_NONE = -4142

# 水平对齐
XL_ALIGN_LEFT = -4131
XL_ALIGN_CENTER = -4108
XL_ALIGN_RIGHT = -4152

# 垂直对齐
XL_ALIGN_TOP = -4160
XL_ALIGN_CENTER_V = -4108
XL_ALIGN_BOTTOM = -4107

# 排序顺序
XL_ASCENDING = 1
XL_DESCENDING = 2

# 篮选操作
XL_FILTER_AUTO = 1

# 数据验证类型
XL_VALIDATE_WHOLE_NUMBER = 1
XL_VALIDATE_DECIMAL = 2
XL_VALIDATE_LIST = 3
XL_VALIDATE_DATE = 4
XL_VALIDATE_TIME = 5
XL_VALIDATE_TEXT_LENGTH = 6
XL_VALIDATE_CUSTOM = 7


class ExcelController:
    """Excel 控制器"""

    def __init__(self):
        self.excel = None
        self.workbook = None
        self.sheet = None
        self.is_visible = False

    def open_excel(self, visible=True):
        """打开 Excel 应用"""
        if not HAS_WIN32:
            return {"success": False, "error": "pywin32 未安装"}

        try:
            # 尝试获取已有的 Excel 实例
            try:
                self.excel = win32com.client.GetActiveObject("Excel.Application")
                debug_print("Excel 已在运行")
            except:
                # 如果没有，启动独立的 Excel 进程（不通过 COM 创建）
                # 这样 Python 退出时不会关闭 Excel
                debug_print("启动独立的 Excel 进程...")
                os.system("start excel")

                # 等待并重试连接（最多5次，每次等待2秒）
                connected = False
                for i in range(5):
                    time.sleep(2)
                    try:
                        self.excel = win32com.client.GetActiveObject("Excel.Application")
                        connected = True
                        debug_print(f"第{i+1}次尝试连接成功")
                        break
                    except:
                        debug_print(f"第{i+1}次尝试连接失败，继续等待...")
                        continue

                if not connected:
                    return {"success": False, "error": "Excel 启动成功但连接失败，请稍后重试或手动打开 Excel 后再操作"}

            self.excel.Visible = visible
            self.is_visible = visible
            return {"success": True, "message": "Excel 已打开"}
        except Exception as e:
            # 返回友好的错误信息，不直接返回 COM 错误码
            error_msg = str(e)
            if "2147221021" in error_msg or "2147" in error_msg:
                return {"success": False, "error": "无法连接到 Excel，请确保 Excel 已启动"}
            return {"success": False, "error": f"Excel 操作失败: {error_msg}"}

    def _ensure_excel_connected(self):
        """确保连接到已运行的 Excel（每次新进程都需要重新连接）"""
        if self.excel is not None:
            return True

        try:
            self.excel = win32com.client.GetActiveObject("Excel.Application")
            self.is_visible = self.excel.Visible

            # 尝试获取当前活动的工作簿和工作表
            try:
                self.workbook = self.excel.ActiveWorkbook
                self.sheet = self.excel.ActiveSheet
            except:
                pass  # 可能没有打开的工作簿

            debug_print("已连接到运行中的 Excel")
            return True
        except Exception as e:
            debug_print(f"连接 Excel 失败: {e}")
            return False

    def load_file(self, file_path):
        """加载 Excel 文件"""
        # 确保连接到 Excel
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        try:
            # 绝对路径
            abs_path = os.path.abspath(file_path)
            self.workbook = self.excel.Workbooks.Open(abs_path)
            self.sheet = self.workbook.ActiveSheet

            # 获取数据范围
            used_range = self.sheet.UsedRange
            rows = used_range.Rows.Count
            cols = used_range.Columns.Count

            # 读取数据预览
            data_preview = []
            for i in range(1, min(rows + 1, 20)):  # 最多预览20行
                row_data = []
                for j in range(1, cols + 1):
                    cell_value = self.sheet.Cells(i, j).Value
                    row_data.append(cell_value if cell_value is not None else "")
                data_preview.append(row_data)

            return {
                "success": True,
                "message": f"已加载 {abs_path}",
                "rows": rows,
                "cols": cols,
                "preview": data_preview[:10]  # 前10行预览
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def create_new(self):
        """创建新工作簿"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        try:
            self.workbook = self.excel.Workbooks.Add()
            self.sheet = self.workbook.ActiveSheet
            return {"success": True, "message": "新工作簿已创建"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def write_cell(self, row, col, value, show_mouse=False):
        """写入单元格（默认不控制鼠标，让用户可以正常操作）"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表，请先打开或创建工作簿"}

        try:
            # 通过 COM API 写入
            cell = self.sheet.Cells(row, col)
            cell.Value = value

            # 鼠标跟随已默认禁用，用户可正常使用鼠标

            return {
                "success": True,
                "message": f"已写入单元格 {self._get_cell_ref(row, col)}",
                "value": value
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def write_range(self, start_row, start_col, data, show_mouse=False):
        """批量写入区域（默认不控制鼠标）"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表，请先打开或创建工作簿"}

        try:
            written_cells = 0
            for i, row_data in enumerate(data):
                for j, value in enumerate(row_data):
                    cell = self.sheet.Cells(start_row + i, start_col + j)
                    cell.Value = value
                    written_cells += 1

            return {
                "success": True,
                "message": f"已写入 {written_cells} 个单元格",
                "range": f"{self._get_cell_ref(start_row, start_col)}:{self._get_cell_ref(start_row + len(data) - 1, start_col + len(data[0]) - 1)}"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def read_range(self, start_row, start_col, rows, cols):
        """读取区域数据"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表，请先打开或创建工作簿"}

        try:
            data = []
            for i in range(rows):
                row_data = []
                for j in range(cols):
                    cell_value = self.sheet.Cells(start_row + i, start_col + j).Value
                    row_data.append(cell_value if cell_value is not None else "")
                data.append(row_data)

            return {
                "success": True,
                "data": data
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_style(self, start_row, start_col, rows, cols, style):
        """设置区域样式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表，请先打开或创建工作簿"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(start_row + rows - 1, start_col + cols - 1)
            )

            # 背景颜色
            if "bg_color" in style:
                # 将颜色字符串转换为 Excel 颜色值
                color = self._parse_color(style["bg_color"])
                if color:
                    range_obj.Interior.Color = color

            # 字体颜色
            if "text_color" in style:
                color = self._parse_color(style["text_color"])
                if color:
                    range_obj.Font.Color = color

            # 加粗
            if style.get("bold"):
                range_obj.Font.Bold = True

            return {"success": True, "message": "样式已应用"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def sort_column(self, col, order="asc"):
        """排序列"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表，请先打开或创建工作簿"}

        try:
            used_range = self.sheet.UsedRange

            # Excel 排序 - 使用 SortFields 方式
            order_val = 1 if order == "asc" else 2  # xlAscending=1, xlDescending=2

            self.sheet.Sort.SortFields.Clear()
            self.sheet.Sort.SortFields.Add(
                self.sheet.Columns(col),
                0,  # xlSortOnValues
                order_val,
                0,  # xlSortNormal
                0   # xlSortDefault
            )

            # 执行排序
            self.sheet.Sort.SetRange(used_range)
            self.sheet.Sort.Header = 1  # xlYes
            self.sheet.Sort.Apply()

            return {"success": True, "message": f"列 {self._get_col_name(col)} 已排序"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def save_file(self, file_path=None):
        """保存文件"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行，请先打开 Excel"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿，请先打开或创建文件"}

        try:
            if file_path:
                abs_path = os.path.abspath(file_path)
                self.workbook.SaveAs(abs_path)
                return {"success": True, "message": f"已保存到 {abs_path}", "path": abs_path}
            else:
                self.workbook.Save()
                return {"success": True, "message": "文件已保存"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def close_excel(self, force=False):
        """关闭 Excel"""
        try:
            if force:
                # 强制关闭
                if self.workbook:
                    self.workbook.Close(SaveChanges=False)
                if self.excel:
                    self.excel.Quit()
                self.excel = None
                self.workbook = None
                self.sheet = None
                return {"success": True, "message": "Excel 已关闭"}
            else:
                # 不强制关闭，让 Excel 保持运行
                return {"success": True, "message": "Excel 保持运行中，请手动关闭"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_cell_ref(self, row, col):
        """获取单元格引用（如 A1）"""
        col_name = ""
        while col > 0:
            col -= 1
            col_name = chr(65 + col % 26) + col_name
            col = col // 26
        return f"{col_name}{row}"

    def _get_col_name(self, col):
        """获取列名（从1开始）"""
        return self._get_cell_ref(1, col)[0:-1]

    def _parse_color(self, color_str):
        """解析颜色字符串为 RGB 值"""
        # 支持 #RRGGBB 格式
        if color_str.startswith("#"):
            hex_color = color_str[1:]
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            # Excel 使用 BGR 格式
            return b * 256 * 256 + g * 256 + r
        return None

    def _move_mouse_to_cell(self, row, col):
        """尝试将鼠标移动到单元格位置（模拟效果）"""
        # 注意：这只是模拟效果，无法精确定位到 Excel 单元格
        # 实际效果取决于 Excel 窗口位置和单元格大小
        try:
            # 获取 Excel 窗口位置（简化处理）
            # 这里使用屏幕中心区域作为模拟位置
            screen_width, screen_height = pyautogui.size()

            # 计算模拟位置（基于行列偏移）
            base_x = screen_width // 3
            base_y = screen_height // 4

            # 每个单元格约 80x20 像素的偏移
            offset_x = col * 80
            offset_y = (row - 1) * 20

            target_x = base_x + offset_x
            target_y = base_y + offset_y

            # 确保不超出屏幕范围
            target_x = min(max(target_x, 100), screen_width - 100)
            target_y = min(max(target_y, 100), screen_height - 100)

            # 移动鼠标（带动画）
            pyautogui.moveTo(target_x, target_y, duration=0.2)

        except Exception as e:
            pass  # 鼠标移动失败不影响实际写入

    # ===== 高级功能：公式 =====

    def set_formula(self, row, col, formula):
        """设置单元格公式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            cell = self.sheet.Cells(row, col)
            cell.Formula = formula
            return {"success": True, "message": f"公式已设置: {formula}", "cell": self._get_cell_ref(row, col)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_formula(self, row, col):
        """获取单元格公式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            cell = self.sheet.Cells(row, col)
            formula = cell.Formula
            return {"success": True, "formula": formula, "cell": self._get_cell_ref(row, col)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：图表 =====

    def add_chart(self, chart_type="column", start_row=1, start_col=1, end_row=10, end_col=5,
                  left=100, top=100, width=400, height=300, title=None):
        """创建图表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            # 图表类型映射
            chart_type_map = {
                "column": XL_CHART_COLUMN_CLUSTERED,
                "column_stacked": XL_CHART_COLUMN_STACKED,
                "bar": XL_CHART_BAR_CLUSTERED,
                "bar_stacked": XL_CHART_BAR_STACKED,
                "line": XL_CHART_LINE,
                "line_markers": XL_CHART_LINE_MARKERS,
                "pie": XL_CHART_PIE,
                "scatter": XL_CHART_SCATTER,
                "area": XL_CHART_AREA,
                "doughnut": XL_CHART_DOUGHNUT
            }

            xl_chart_type = chart_type_map.get(chart_type.lower(), XL_CHART_COLUMN_CLUSTERED)

            # 数据范围
            data_range = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            # 创建图表
            chart_obj = self.sheet.ChartObjects().Add(left, top, width, height)
            chart = chart_obj.Chart
            chart.SetSourceData(data_range)
            chart.ChartType = xl_chart_type

            # 设置标题
            if title:
                chart.HasTitle = True
                chart.ChartTitle.Text = title

            return {"success": True, "message": f"图表已创建: {chart_type}", "chart_name": chart_obj.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_chart(self, chart_name):
        """删除图表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.ChartObjects(chart_name).Delete()
            return {"success": True, "message": f"图表 {chart_name} 已删除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_charts(self):
        """列出所有图表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            charts = []
            for chart_obj in self.sheet.ChartObjects():
                charts.append({
                    "name": chart_obj.Name,
                    "type": chart_obj.Chart.ChartType,
                    "left": chart_obj.Left,
                    "top": chart_obj.Top,
                    "width": chart_obj.Width,
                    "height": chart_obj.Height
                })
            return {"success": True, "charts": charts, "count": len(charts)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：行列操作 =====

    def insert_rows(self, row, count=1):
        """插入行"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Rows(row).Insert()
            return {"success": True, "message": f"已插入 {count} 行"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def insert_columns(self, col, count=1):
        """插入列"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Columns(col).Insert()
            return {"success": True, "message": f"已插入 {count} 列"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_rows(self, row, count=1):
        """删除行"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            for i in range(count):
                self.sheet.Rows(row).Delete()
            return {"success": True, "message": f"已删除 {count} 行"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_columns(self, col, count=1):
        """删除列"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            for i in range(count):
                self.sheet.Columns(col).Delete()
            return {"success": True, "message": f"已删除 {count} 列"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_row_height(self, row, height):
        """设置行高"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Rows(row).RowHeight = height
            return {"success": True, "message": f"行 {row} 高度设置为 {height}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_column_width(self, col, width):
        """设置列宽"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Columns(col).ColumnWidth = width
            return {"success": True, "message": f"列 {self._get_col_name(col)} 宽度设置为 {width}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：合并单元格 =====

    def merge_cells(self, start_row, start_col, end_row, end_col):
        """合并单元格"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.Merge()
            return {"success": True, "message": f"单元格已合并: {self._get_cell_ref(start_row, start_col)}:{self._get_cell_ref(end_row, end_col)}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def unmerge_cells(self, start_row, start_col, end_row, end_col):
        """取消合并单元格"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.UnMerge()
            return {"success": True, "message": "单元格已取消合并"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：边框设置 =====

    def set_border(self, start_row, start_col, end_row, end_col,
                   border_type="all", style="continuous", color="#000000", weight=1):
        """设置边框"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            ppt_color = self._parse_color(color)
            style_map = {
                "continuous": XL_BORDER_CONTINUOUS,
                "dashed": XL_BORDER_DASHED,
                "dotted": XL_BORDER_DOTTED,
                "double": XL_BORDER_DOUBLE,
                "none": XL_BORDER_NONE
            }
            xl_style = style_map.get(style.lower(), XL_BORDER_CONTINUOUS)

            # 边框位置映射
            border_positions = {
                "left": [XL_BORDER_LEFT],
                "right": [XL_BORDER_RIGHT],
                "top": [XL_BORDER_TOP],
                "bottom": [XL_BORDER_BOTTOM],
                "outline": [XL_BORDER_LEFT, XL_BORDER_RIGHT, XL_BORDER_TOP, XL_BORDER_BOTTOM],
                "inside": [XL_BORDER_INSIDE_VERTICAL, XL_BORDER_INSIDE_HORIZONTAL],
                "all": [XL_BORDER_LEFT, XL_BORDER_RIGHT, XL_BORDER_TOP, XL_BORDER_BOTTOM,
                        XL_BORDER_INSIDE_VERTICAL, XL_BORDER_INSIDE_HORIZONTAL]
            }

            positions = border_positions.get(border_type.lower(), [XL_BORDER_LEFT, XL_BORDER_RIGHT, XL_BORDER_TOP, XL_BORDER_BOTTOM])

            for pos in positions:
                border = range_obj.Borders(pos)
                if xl_style == XL_BORDER_NONE:
                    border.LineStyle = xl_style
                else:
                    border.LineStyle = xl_style
                    border.Weight = weight
                    if ppt_color:
                        border.Color = ppt_color

            return {"success": True, "message": f"边框已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：对齐方式 =====

    def set_alignment(self, start_row, start_col, end_row, end_col,
                      horizontal="center", vertical="center", wrap_text=False):
        """设置对齐方式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            # 水平对齐
            h_align_map = {
                "left": XL_ALIGN_LEFT,
                "center": XL_ALIGN_CENTER,
                "right": XL_ALIGN_RIGHT
            }
            range_obj.HorizontalAlignment = h_align_map.get(horizontal.lower(), XL_ALIGN_CENTER)

            # 垂直对齐
            v_align_map = {
                "top": XL_ALIGN_TOP,
                "center": XL_ALIGN_CENTER_V,
                "bottom": XL_ALIGN_BOTTOM
            }
            range_obj.VerticalAlignment = v_align_map.get(vertical.lower(), XL_ALIGN_CENTER_V)

            # 自动换行
            range_obj.WrapText = wrap_text

            return {"success": True, "message": f"对齐方式已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：条件格式化 =====

    def add_conditional_format_color_scale(self, start_row, start_col, end_row, end_col,
                                            color1="#63BE7B", color2="#FFEB84", color3="#F8696B"):
        """添加三色色阶条件格式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            # 添加色阶条件格式
            format = range_obj.FormatConditions.AddColorScale(3)

            # 设置最小值颜色
            format.ColorScaleCriteria(1).FormatColor.Color = self._parse_color(color1)
            format.ColorScaleCriteria(1).Type = 1  # xlConditionValueLowestValue

            # 设置中间值颜色
            format.ColorScaleCriteria(2).FormatColor.Color = self._parse_color(color2)
            format.ColorScaleCriteria(2).Type = 4  # xlConditionValuePercentile
            format.ColorScaleCriteria(2).Value = 50

            # 设置最大值颜色
            format.ColorScaleCriteria(3).FormatColor.Color = self._parse_color(color3)
            format.ColorScaleCriteria(3).Type = 2  # xlConditionValueHighestValue

            return {"success": True, "message": "色阶条件格式已添加"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_conditional_format_data_bar(self, start_row, start_col, end_row, end_col,
                                         bar_color="#63BE7B"):
        """添加数据条条件格式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            format = range_obj.FormatConditions.AddDatabar()
            format.BarColor.Color = self._parse_color(bar_color)

            return {"success": True, "message": "数据条条件格式已添加"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_conditional_formats(self, start_row, start_col, end_row, end_col):
        """清除条件格式"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.FormatConditions.Delete()
            return {"success": True, "message": "条件格式已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：工作表操作 =====

    def create_sheet(self, name=None):
        """创建新工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿"}

        try:
            sheet = self.workbook.Sheets.Add(After=self.workbook.Sheets(self.workbook.Sheets.Count))
            if name:
                sheet.Name = name
            self.sheet = sheet
            return {"success": True, "message": f"工作表已创建", "sheet_name": sheet.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_sheet(self, name):
        """删除工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿"}

        try:
            self.workbook.Sheets(name).Delete()
            return {"success": True, "message": f"工作表 {name} 已删除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def rename_sheet(self, old_name, new_name):
        """重命名工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿"}

        try:
            self.workbook.Sheets(old_name).Name = new_name
            return {"success": True, "message": f"工作表已重命名为 {new_name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def switch_sheet(self, name):
        """切换工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿"}

        try:
            self.sheet = self.workbook.Sheets(name)
            self.sheet.Activate()
            return {"success": True, "message": f"已切换到工作表 {name}", "sheet_name": name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_sheets(self):
        """列出所有工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.workbook:
            return {"success": False, "error": "没有活动的工作簿"}

        try:
            sheets = []
            for sheet in self.workbook.Sheets:
                sheets.append({"name": sheet.Name, "type": sheet.Type})
            return {"success": True, "sheets": sheets, "count": len(sheets)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_active_sheet(self):
        """获取当前活动工作表"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        try:
            return {"success": True, "sheet_name": self.sheet.Name if self.sheet else None}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：筛选 =====

    def auto_filter(self, start_row, start_col, end_row, end_col):
        """启用自动筛选"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.AutoFilter()
            return {"success": True, "message": "自动筛选已启用"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def filter_column(self, col, criteria):
        """筛选列"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            # 检查是否已启用筛选
            if not self.sheet.AutoFilterMode:
                return {"success": False, "error": "请先启用自动筛选"}

            self.sheet.AutoFilter.Range.AutoFilter(Field=col, Criteria1=criteria)
            return {"success": True, "message": f"列 {col} 已筛选: {criteria}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_filter(self):
        """清除筛选"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            if self.sheet.AutoFilterMode:
                self.sheet.AutoFilterMode = False
            return {"success": True, "message": "筛选已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：数据验证 =====

    def add_data_validation_list(self, start_row, start_col, end_row, end_col,
                                  list_values):
        """添加列表数据验证"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )

            # 添加数据验证
            range_obj.Validation.Add(Type=XL_VALIDATE_LIST, AlertStyle=1, Formula1=list_values)
            return {"success": True, "message": f"数据验证已添加: {list_values}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_data_validation(self, start_row, start_col, end_row, end_col):
        """清除数据验证"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.Validation.Delete()
            return {"success": True, "message": "数据验证已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：图片 =====

    def add_image(self, image_path, left=100, top=100, width=None, height=None):
        """插入图片"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            abs_path = os.path.abspath(image_path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"图片文件不存在: {abs_path}"}

            if width and height:
                shape = self.sheet.Shapes.AddPicture(abs_path, False, True, left, top, width, height)
            else:
                shape = self.sheet.Shapes.InsertPicture(abs_path)

            return {"success": True, "message": f"图片已插入", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：注释 =====

    def add_comment(self, row, col, text):
        """添加单元格注释"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            cell = self.sheet.Cells(row, col)
            cell.AddComment(text)
            return {"success": True, "message": f"注释已添加到 {self._get_cell_ref(row, col)}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_comment(self, row, col):
        """删除单元格注释"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            cell = self.sheet.Cells(row, col)
            if cell.Comment:
                cell.Comment.Delete()
            return {"success": True, "message": f"注释已删除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：查找替换 =====

    def find_value(self, text, start_row=1, start_col=1, end_row=None, end_col=None):
        """查找值"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            if end_row and end_col:
                range_obj = self.sheet.Range(
                    self.sheet.Cells(start_row, start_col),
                    self.sheet.Cells(end_row, end_col)
                )
            else:
                range_obj = self.sheet.UsedRange

            found = range_obj.Find(text)
            if found:
                return {"success": True, "found": True,
                        "row": found.Row, "col": found.Column,
                        "cell": self._get_cell_ref(found.Row, found.Column)}
            else:
                return {"success": True, "found": False, "message": "未找到"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def replace_value(self, find_text, replace_text, start_row=1, start_col=1, end_row=None, end_col=None):
        """替换值"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            if end_row and end_col:
                range_obj = self.sheet.Range(
                    self.sheet.Cells(start_row, start_col),
                    self.sheet.Cells(end_row, end_col)
                )
            else:
                range_obj = self.sheet.UsedRange

            # 替换所有匹配
            count_before = self._count_occurrences(range_obj, find_text)
            range_obj.Replace(find_text, replace_text, LookAt=2)  # xlPart

            return {"success": True, "message": f"已替换 {count_before} 处"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _count_occurrences(self, range_obj, text):
        """计算出现次数"""
        count = 0
        for cell in range_obj:
            if cell.Value and str(cell.Value).find(text) >= 0:
                count += 1
        return count

    # ===== 高级功能：冻结窗格 =====

    def freeze_panes(self, row, col):
        """冻结窗格"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Activate()
            self.excel.ActiveWindow.SplitRow = row
            self.excel.ActiveWindow.SplitColumn = col
            self.excel.ActiveWindow.FreezePanes = True
            return {"success": True, "message": f"窗格已冻结于 {row}行 {col}列"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def unfreeze_panes(self):
        """取消冻结窗格"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            self.sheet.Activate()
            self.excel.ActiveWindow.FreezePanes = False
            return {"success": True, "message": "窗格已取消冻结"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：获取数据范围 =====

    def get_used_range(self):
        """获取已使用的范围"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            used_range = self.sheet.UsedRange
            return {"success": True,
                    "start_row": used_range.Row,
                    "start_col": used_range.Column,
                    "rows": used_range.Rows.Count,
                    "cols": used_range.Columns.Count,
                    "range": f"{self._get_cell_ref(used_range.Row, used_range.Column)}:{self._get_cell_ref(used_range.Row + used_range.Rows.Count - 1, used_range.Column + used_range.Columns.Count - 1)}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_range(self, start_row, start_col, end_row, end_col):
        """清除区域内容"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.Clear()
            return {"success": True, "message": f"区域已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_range_contents(self, start_row, start_col, end_row, end_col):
        """清除区域内容（保留格式）"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.ClearContents()
            return {"success": True, "message": f"区域内容已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def clear_range_formats(self, start_row, start_col, end_row, end_col):
        """清除区域格式（保留内容）"""
        if not self._ensure_excel_connected():
            return {"success": False, "error": "Excel 未运行"}

        if not self.sheet:
            return {"success": False, "error": "没有活动的工作表"}

        try:
            range_obj = self.sheet.Range(
                self.sheet.Cells(start_row, start_col),
                self.sheet.Cells(end_row, end_col)
            )
            range_obj.ClearFormats()
            return {"success": True, "message": f"区域格式已清除"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# 全局控制器实例
_controller = None


def get_controller():
    """获取控制器实例"""
    global _controller
    if _controller is None:
        _controller = ExcelController()
    return _controller


def execute_command(action, args):
    """执行命令"""
    ctrl = get_controller()

    result = {"success": False, "error": "未知命令"}

    if action == "open_excel":
        result = ctrl.open_excel(args.get("visible", True))

    elif action == "load_file":
        result = ctrl.load_file(args.get("file_path"))

    elif action == "create_new":
        result = ctrl.create_new()

    elif action == "write_cell":
        result = ctrl.write_cell(
            args.get("row", 1),
            args.get("col", 1),
            args.get("value", ""),
            args.get("show_mouse", False)  # 默认禁用鼠标跟随
        )

    elif action == "write_range":
        result = ctrl.write_range(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("data", []),
            args.get("show_mouse", False)  # 默认禁用鼠标跟随
        )

    elif action == "read_range":
        result = ctrl.read_range(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("rows", 10),
            args.get("cols", 10)
        )

    elif action == "set_style":
        result = ctrl.set_style(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("rows", 1),
            args.get("cols", 1),
            args.get("style", {})
        )

    elif action == "sort_column":
        result = ctrl.sort_column(
            args.get("col", 1),
            args.get("order", "asc")
        )

    elif action == "save_file":
        result = ctrl.save_file(args.get("file_path"))

    elif action == "close_excel":
        result = ctrl.close_excel(args.get("force", False))

    # ===== 高级功能命令 =====
    elif action == "set_formula":
        result = ctrl.set_formula(
            args.get("row", 1),
            args.get("col", 1),
            args.get("formula", "")
        )

    elif action == "get_formula":
        result = ctrl.get_formula(args.get("row", 1), args.get("col", 1))

    elif action == "add_chart":
        result = ctrl.add_chart(
            args.get("chart_type", "column"),
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 10),
            args.get("end_col", 5),
            args.get("left", 100),
            args.get("top", 100),
            args.get("width", 400),
            args.get("height", 300),
            args.get("title")
        )

    elif action == "delete_chart":
        result = ctrl.delete_chart(args.get("chart_name"))

    elif action == "list_charts":
        result = ctrl.list_charts()

    elif action == "insert_rows":
        result = ctrl.insert_rows(args.get("row", 1), args.get("count", 1))

    elif action == "insert_columns":
        result = ctrl.insert_columns(args.get("col", 1), args.get("count", 1))

    elif action == "delete_rows":
        result = ctrl.delete_rows(args.get("row", 1), args.get("count", 1))

    elif action == "delete_columns":
        result = ctrl.delete_columns(args.get("col", 1), args.get("count", 1))

    elif action == "set_row_height":
        result = ctrl.set_row_height(args.get("row", 1), args.get("height", 15))

    elif action == "set_column_width":
        result = ctrl.set_column_width(args.get("col", 1), args.get("width", 10))

    elif action == "merge_cells":
        result = ctrl.merge_cells(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 1),
            args.get("end_col", 2)
        )

    elif action == "unmerge_cells":
        result = ctrl.unmerge_cells(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 1),
            args.get("end_col", 2)
        )

    elif action == "set_border":
        result = ctrl.set_border(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 2),
            args.get("end_col", 2),
            args.get("border_type", "outline"),
            args.get("style", "continuous"),
            args.get("color", "#000000"),
            args.get("weight", 1)
        )

    elif action == "set_alignment":
        result = ctrl.set_alignment(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 2),
            args.get("end_col", 2),
            args.get("horizontal", "center"),
            args.get("vertical", "center"),
            args.get("wrap_text", False)
        )

    elif action == "add_conditional_format_color_scale":
        result = ctrl.add_conditional_format_color_scale(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 10),
            args.get("end_col", 5),
            args.get("color1", "#63BE7B"),
            args.get("color2", "#FFEB84"),
            args.get("color3", "#F8696B")
        )

    elif action == "add_conditional_format_data_bar":
        result = ctrl.add_conditional_format_data_bar(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 10),
            args.get("end_col", 5),
            args.get("bar_color", "#63BE7B")
        )

    elif action == "clear_conditional_formats":
        result = ctrl.clear_conditional_formats(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 10),
            args.get("end_col", 5)
        )

    elif action == "create_sheet":
        result = ctrl.create_sheet(args.get("name"))

    elif action == "delete_sheet":
        result = ctrl.delete_sheet(args.get("name"))

    elif action == "rename_sheet":
        result = ctrl.rename_sheet(args.get("old_name"), args.get("new_name"))

    elif action == "switch_sheet":
        result = ctrl.switch_sheet(args.get("name"))

    elif action == "list_sheets":
        result = ctrl.list_sheets()

    elif action == "get_active_sheet":
        result = ctrl.get_active_sheet()

    elif action == "auto_filter":
        result = ctrl.auto_filter(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 10),
            args.get("end_col", 5)
        )

    elif action == "filter_column":
        result = ctrl.filter_column(args.get("col", 1), args.get("criteria", ""))

    elif action == "clear_filter":
        result = ctrl.clear_filter()

    elif action == "add_data_validation_list":
        result = ctrl.add_data_validation_list(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 5),
            args.get("end_col", 1),
            args.get("list_values", "")
        )

    elif action == "clear_data_validation":
        result = ctrl.clear_data_validation(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 5),
            args.get("end_col", 1)
        )

    elif action == "add_image":
        result = ctrl.add_image(
            args.get("image_path"),
            args.get("left", 100),
            args.get("top", 100),
            args.get("width"),
            args.get("height")
        )

    elif action == "add_comment":
        result = ctrl.add_comment(args.get("row", 1), args.get("col", 1), args.get("text", ""))

    elif action == "delete_comment":
        result = ctrl.delete_comment(args.get("row", 1), args.get("col", 1))

    elif action == "find_value":
        result = ctrl.find_value(
            args.get("text", ""),
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row"),
            args.get("end_col")
        )

    elif action == "replace_value":
        result = ctrl.replace_value(
            args.get("find_text", ""),
            args.get("replace_text", ""),
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row"),
            args.get("end_col")
        )

    elif action == "freeze_panes":
        result = ctrl.freeze_panes(args.get("row", 1), args.get("col", 1))

    elif action == "unfreeze_panes":
        result = ctrl.unfreeze_panes()

    elif action == "get_used_range":
        result = ctrl.get_used_range()

    elif action == "clear_range":
        result = ctrl.clear_range(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 2),
            args.get("end_col", 2)
        )

    elif action == "clear_range_contents":
        result = ctrl.clear_range_contents(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 2),
            args.get("end_col", 2)
        )

    elif action == "clear_range_formats":
        result = ctrl.clear_range_formats(
            args.get("start_row", 1),
            args.get("start_col", 1),
            args.get("end_row", 2),
            args.get("end_col", 2)
        )

    elif action == "run_script":
        # 执行用户提供的脚本代码
        script_code = args.get("script", "")
        delay = args.get("delay", 0.3)

        if not script_code:
            result = {"success": False, "error": "脚本代码为空"}
        else:
            try:
                # 创建执行环境
                import io
                from contextlib import redirect_stdout, redirect_stderr

                # 准备执行环境
                exec_globals = {
                    'time': time,
                    'os': os,
                    'win32com': win32com.client if HAS_WIN32 else None,
                    'HAS_WIN32': HAS_WIN32,
                    'INCHES_TO_POINTS': INCHES_TO_POINTS,
                    'inches_to_points': inches_to_points,
                    'get_controller': get_controller,
                    'ExcelController': ExcelController,
                    # 图表常量
                    'XL_CHART_COLUMN_CLUSTERED': XL_CHART_COLUMN_CLUSTERED,
                    'XL_CHART_BAR_CLUSTERED': XL_CHART_BAR_CLUSTERED,
                    'XL_CHART_LINE': XL_CHART_LINE,
                    'XL_CHART_PIE': XL_CHART_PIE,
                    'XL_CHART_SCATTER': XL_CHART_SCATTER,
                    # 边框常量
                    'XL_BORDER_LEFT': XL_BORDER_LEFT,
                    'XL_BORDER_RIGHT': XL_BORDER_RIGHT,
                    'XL_BORDER_TOP': XL_BORDER_TOP,
                    'XL_BORDER_BOTTOM': XL_BORDER_BOTTOM,
                    'XL_BORDER_CONTINUOUS': XL_BORDER_CONTINUOUS,
                    # 对齐常量
                    'XL_ALIGN_LEFT': XL_ALIGN_LEFT,
                    'XL_ALIGN_CENTER': XL_ALIGN_CENTER,
                    'XL_ALIGN_RIGHT': XL_ALIGN_RIGHT,
                    'XL_ALIGN_TOP': XL_ALIGN_TOP,
                    'XL_ALIGN_CENTER_V': XL_ALIGN_CENTER_V,
                    'XL_ALIGN_BOTTOM': XL_ALIGN_BOTTOM,
                    # 内置延迟函数
                    'step_delay': delay
                }

                # 添加内置辅助函数
                exec_globals['delay_step'] = lambda: time.sleep(delay)
                exec_globals['ctrl'] = ctrl  # 提供当前控制器

                # 执行脚本
                stdout_capture = io.StringIO()
                stderr_capture = io.StringIO()

                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    exec(script_code, exec_globals)

                result = {
                    "success": True,
                    "message": "脚本执行完成",
                    "stdout": stdout_capture.getvalue(),
                    "stderr": stderr_capture.getvalue()
                }
            except Exception as e:
                import traceback
                result = {
                    "success": False,
                    "error": str(e),
                    "traceback": traceback.format_exc()
                }

    return result


# 主入口：接收 JSON 命令，返回 JSON 结果
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少命令参数"}))
        sys.exit(1)

    try:
        # 解析命令 JSON
        command_json = sys.argv[1]
        command = json.loads(command_json)

        action = command.get("action")
        args = command.get("args", {})

        result = execute_command(action, args)
        print(json.dumps(result, ensure_ascii=False))

    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"JSON 解析错误: {str(e)}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))