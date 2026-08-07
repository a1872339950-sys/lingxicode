import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence
} from 'remotion'

export type MainProps = {
  title: string
  subtitle: string
}

export const Main: React.FC<MainProps> = ({ title, subtitle }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleIn = spring({ frame, fps, config: { damping: 200 } })
  const titleY = interpolate(titleIn, [0, 1], [24, 0])
  const titleOp = interpolate(titleIn, [0, 1], [0, 1])

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 20% 20%, #1e3a5f 0%, #0b0c10 55%, #000 100%)',
        color: 'white',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48
        }}
      >
        <div
          style={{
            transform: `translateY(${titleY}px)`,
            opacity: titleOp,
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -0.5 }}>
            {title}
          </div>
          <Sequence from={18} layout="none">
            <div
              style={{
                marginTop: 16,
                fontSize: 28,
                opacity: 0.85,
                fontWeight: 500
              }}
            >
              {subtitle}
            </div>
          </Sequence>
        </div>
      </AbsoluteFill>

      <Sequence from={70}>
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: 64
          }}
        >
          <div
            style={{
              padding: '12px 28px',
              borderRadius: 999,
              background: '#0EA5E9',
              fontSize: 22,
              fontWeight: 600,
              opacity: interpolate(frame, [70, 90], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp'
              })
            }}
          >
            开始创作
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  )
}
