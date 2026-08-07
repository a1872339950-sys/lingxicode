import Phaser from 'phaser'
import { PlayScene } from './game/scenes/PlayScene'
import { gameConfig } from './game/config'

const config: Phaser.Types.Core.GameConfig = {
  ...gameConfig,
  scene: [PlayScene],
  parent: 'game-parent'
}

// eslint-disable-next-line no-new
new Phaser.Game(config)
