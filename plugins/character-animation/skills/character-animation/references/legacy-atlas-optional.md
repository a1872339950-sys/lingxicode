# 可选：灵犀桌宠 8×9 图集（非默认）

仅在用户**明确要求**「兼容灵犀桌宠图集 / 固定格 atlas」时使用。默认项目内 2D 动画**不要**启用。

- 画布：`1536×1872`
- 网格：8 列 × 9 行
- 格：`192×208`
- 行：idle / running-right / running-left / waving / jumping / failed / waiting / running / review

脚本 `scripts/*.py` 中的 atlas 工具按该规格设计，可在此模式下使用。  
普通项目动画请用「用户指定 cell 尺寸 + 动作列表」，输出 `frames/` + 可选自定义 sheet。
