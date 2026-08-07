# 动作预设（可选）

用户未指定动作时，先问清楚用途，再选预设；**不要**默认套 9 态桌宠图集。

## 游戏横版 / 平台

- `idle` 待机  
- `walk` 走路  
- `run` 跑步  
- `jump` 跳跃  
- `fall` 下落  
- `attack` 攻击  
- `hurt` 受击  
- `die` 倒地  

## 网页 / UI 小人

- `idle`  
- `hover`  
- `click`  
- `success`  
- `error`  
- `loading`  

## 展示 / 吉祥物（项目内，不是软件宠物）

- `idle`  
- `wave`  
- `look`  
- `cheer`  

## 自定义

完全由用户定义动作名、帧数、单帧尺寸、是否循环、是否左右镜像。

## 与灵犀桌宠图集的关系

仅当用户明确说「兼容灵犀桌宠图集 / 8×9 192×208」时，才使用：

`idle, running-right, running-left, waving, jumping, failed, waiting, running, review`

并参考 `legacy-atlas-optional.md`。默认工程**不需要**该协议。
