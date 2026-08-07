#!/usr/bin/env python3
"""把 frames 目录拼成 contact sheet 预览。依赖: pip install pillow"""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("需要 Pillow：python -m pip install pillow") from exc


def main() -> None:
    p = argparse.ArgumentParser(description="Build a contact sheet from frame PNGs.")
    p.add_argument("--input-dir", required=True, help="含 000.png… 的目录")
    p.add_argument("--output", required=True, help="输出 png 路径")
    p.add_argument("--cols", type=int, default=8, help="每行列数，默认 8")
    p.add_argument("--pad", type=int, default=4, help="间距像素")
    args = p.parse_args()

    folder = Path(args.input_dir)
    files = sorted(folder.glob("*.png"))
    if not files:
        raise SystemExit(f"没有 png: {folder}")

    images = [Image.open(f).convert("RGBA") for f in files]
    fw, fh = images[0].size
    cols = max(1, args.cols)
    rows = (len(images) + cols - 1) // cols
    pad = args.pad
    sheet = Image.new(
        "RGBA",
        (cols * fw + (cols + 1) * pad, rows * fh + (rows + 1) * pad),
        (20, 20, 24, 255),
    )
    for i, im in enumerate(images):
        if im.size != (fw, fh):
            im = im.resize((fw, fh), Image.Resampling.NEAREST)
        r, c = divmod(i, cols)
        x = pad + c * (fw + pad)
        y = pad + r * (fh + pad)
        sheet.paste(im, (x, y), im)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print("wrote", out, f"({len(images)} frames)")


if __name__ == "__main__":
    main()
