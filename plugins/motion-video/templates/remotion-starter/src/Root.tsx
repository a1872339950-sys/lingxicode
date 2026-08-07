import React from 'react'
import { Composition } from 'remotion'
import { Main } from './compositions/Main'

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Main"
        component={Main}
        durationInFrames={150}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          title: '灵犀 · 程序化短视频',
          subtitle: '15 秒示例片头'
        }}
      />
    </>
  )
}
