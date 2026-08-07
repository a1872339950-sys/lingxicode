# 架构边界

## 推荐分层

- simulation：唯一玩法真源  
- content：关卡/数值数据  
- input：动作与键位  
- assets：manifest  
- renderer/scenes：薄适配  
- ui：DOM  

## 桥接

场景通过明确 API 读状态、派发意图；禁止场景直接改一堆隐式全局。
