const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || (inputPath
  ? path.join(process.cwd(), `${path.parse(inputPath).name}-compressed.jpg`)
  : '');

if (!inputPath) {
  console.error('用法: node scripts/compress-image.js <输入图片> [输出图片]');
  process.exit(1);
}

async function compressImage() {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const metadata = await sharp(inputPath).metadata();
  const origWidth = metadata.width;
  const origHeight = metadata.height;
  let quality = 75;
  
  await sharp(inputPath)
    .jpeg({ quality: quality, mozjpeg: true })
    .toFile(outputPath);
  
  let size = fs.statSync(outputPath).size;
  console.log(`质量 ${quality}%: ${(size / 1024 / 1024).toFixed(2)}MB`);
  
  while (size > 1024 * 1024 && quality > 40) {
    quality -= 5;
    await sharp(inputPath)
      .jpeg({ quality: quality, mozjpeg: true })
      .toFile(outputPath);
    size = fs.statSync(outputPath).size;
    console.log(`质量 ${quality}%: ${(size / 1024 / 1024).toFixed(2)}MB`);
  }
  
  if (size > 1024 * 1024) {
    const scale = Math.sqrt(1024 * 1024 / size) * 0.95;
    await sharp(inputPath)
      .resize(Math.floor(origWidth * scale), Math.floor(origHeight * scale))
      .jpeg({ quality: 70, mozjpeg: true })
      .toFile(outputPath);
    size = fs.statSync(outputPath).size;
  }
  
  console.log(`\n压缩完成！`);
  console.log(`输出路径: ${outputPath}`);
  console.log(`最终大小: ${(size / 1024).toFixed(1)}KB`);
}

compressImage().catch(console.error);
