#!/usr/bin/env python3
"""把横向动作条切成逐帧 PNG。依赖: pip install pillow"""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("需要 Pillow：python -m pip install pillow") from exc


def main() -> None:
    p = argparse.ArgumentParser(description="Extract horizontal sprite strip into frames.")
    p.add_argument("--input", required=True, help="横向 strip 图片路径")
    p.add_argument("--out-dir", required=True, help="输出目录，如 frames/walk")
    p.add_argument("--frames", type=int, required=True, help="横向帧数")
    p.add_argument("--prefix", default="", help="文件名前缀")
    args = p.parse_args()

    src = Path(args.input)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    im = Image.open(src).convert("RGBA")
    if args.frames < 1:
        raise SystemExit("frames 必须 >= 1")
    step = im.width / args.frames
    for i in range(args.frames):
        left = int(round(i * step))
        right = int(round((i + 1) * step))
        frame = im.crop((left, 0, right, im.height))
        name = f"{args.prefix}{i:03d}.png"
        frame.save(out / name)
        print("wrote", out / name)
    print("done", args.frames, "frames ->", out)


if __name__ == "__main__":
    main()
