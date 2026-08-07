# Phaser 目录建议

```text
src/
  systems/           # 玩法
  game/
    main.ts          # Phaser.Game 配置
    scenes/
      BootScene.ts
      PreloadScene.ts
      MenuScene.ts
      PlayScene.ts
  input/
    actions.ts
    bindings.ts
  assets/
    manifest.ts
  ui/
    hud.ts
```

场景职责：编排与呈现。系统职责：规则与状态。
