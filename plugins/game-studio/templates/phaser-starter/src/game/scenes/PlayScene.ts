import Phaser from 'phaser'
import { stepMotion } from '../../systems/playerMotion'

/**
 * 薄场景：呈现 + 输入；规则片段放 systems/
 */
export class PlayScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private keyA!: Phaser.Input.Keyboard.Key
  private keyD!: Phaser.Input.Keyboard.Key
  private keyR!: Phaser.Input.Keyboard.Key
  private platforms!: Phaser.Physics.Arcade.StaticGroup
  private spawn = { x: 120, y: 300 }

  constructor() {
    super('play')
  }

  create() {
    this.platforms = this.physics.add.staticGroup()
    const ground = this.add.rectangle(400, 420, 720, 40, 0x3b4252)
    this.physics.add.existing(ground, true)
    this.platforms.add(ground)

    const ledge = this.add.rectangle(520, 300, 180, 24, 0x4c566a)
    this.physics.add.existing(ledge, true)
    this.platforms.add(ledge)

    const body = this.add.rectangle(this.spawn.x, this.spawn.y, 28, 36, 0x88c0d0)
    this.physics.add.existing(body)
    this.player = body as unknown as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.platforms)

    if (!this.input.keyboard) throw new Error('keyboard missing')
    this.cursors = this.input.keyboard.createCursorKeys()
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A)
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R)

    this.add.text(16, 16, '最小可玩：走到平台 · 掉落可 R 重置', {
      fontSize: '14px',
      color: '#eceff4'
    }).setScrollFactor(0)
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
      this.player.setPosition(this.spawn.x, this.spawn.y)
      this.player.setVelocity(0, 0)
      return
    }

    const onGround = this.player.body.blocked.down || this.player.body.touching.down
    const input = {
      left: !!(this.cursors.left?.isDown || this.keyA.isDown),
      right: !!(this.cursors.right?.isDown || this.keyD.isDown),
      jump: !!(this.cursors.up?.isDown || this.cursors.space?.isDown)
    }
    const next = stepMotion(
      { onGround, vx: this.player.body.velocity.x, vy: this.player.body.velocity.y },
      input
    )
    this.player.setVelocityX(next.vx)
    if (input.jump && onGround) this.player.setVelocityY(next.vy)

    if (this.player.y > 500) {
      this.player.setPosition(this.spawn.x, this.spawn.y)
      this.player.setVelocity(0, 0)
    }
  }
}
