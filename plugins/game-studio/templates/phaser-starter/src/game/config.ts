import Phaser from 'phaser'

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  backgroundColor: '#1a1b26',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 900 }, debug: false }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
}
