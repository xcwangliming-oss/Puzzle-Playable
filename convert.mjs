import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const ffmpegPath = ffmpegInstaller.path;
ffmpeg.setFfmpegPath(ffmpegPath);

const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
if (fs.existsSync(ffprobePath)) {
  ffmpeg.setFfprobePath(ffprobePath);
}

let dir = './';
let files = [];

if (process.argv[2]) {
  const targetPath = path.resolve(process.argv[2]);
  if (fs.existsSync(targetPath)) {
    dir = path.dirname(targetPath);
    files = [path.basename(targetPath)];
  } else {
    console.error(`❌ 找不到指定的文件: ${targetPath}`);
    process.exit(1);
  }
} else {
  // 默认扫描当前目录下的常见视频格式
  files = fs.readdirSync(dir).filter(f => f.endsWith('.webm') || f.endsWith('.mov') || f.endsWith('.mp4'));
}

if (files.length === 0) {
  console.log('❌ 当前目录下没有找到可转换的的视频文件！(.webm, .mov, .mp4)');
  process.exit(0);
}

console.log(`🔎 找到了 ${files.length} 个视频文件，准备转换...\n`);

function processFile(index) {
  if (index >= files.length) {
    console.log('🎉 所有转换任务已完成！');
    process.exit(0);
  }

  const file = files[index];
  const input = path.join(dir, file);
  
  if (file.startsWith('temp_')) {
    processFile(index + 1);
    return;
  }

  ffmpeg.ffprobe(input, (err, metadata) => {
    if (err) {
      console.warn(`⚠️ 无法解析视频元数据: ${file}，将使用备用规则转换。`);
      runFallbackConversion(file, input, index);
      return;
    }

    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    const pixFmt = videoStream?.pix_fmt || '';
    const hasAlpha = pixFmt.includes('a') || pixFmt.includes('alpha') || pixFmt.includes('rgba');
    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;

    console.log(`--------------------------------------------------`);
    console.log(`📹 正在处理: ${file}`);
    console.log(`📊 视频分辨率: ${width}x${height} | 像素格式: ${pixFmt} | 包含透明通道: ${hasAlpha ? '是' : '否'}`);

    if (file.includes('transparent-source') && file.endsWith('.webm')) {
      // 模式 A: 左右双侧 WebM -> 透明 MOV
      const output = path.join(dir, file.replace('.webm', '.mov').replace('transparent-source-', 'combo-material-'));
      convertSideBySideToMov(input, output, () => processFile(index + 1));
    } else if (hasAlpha) {
      // 模式 B: 包含透明通道的普通视频 (如 MOV) -> 左右双侧 WebM (用于网页高性能播放)
      const ext = path.extname(file);
      const output = path.join(dir, 'transparent-source-' + file.replace(ext, '.webm'));
      convertTransparentToSideBySide(input, output, () => processFile(index + 1));
    } else {
      // 模式 C: 普通视频 -> 兼容性 MP4
      const ext = path.extname(file);
      if (ext.toLowerCase() === '.mp4') {
        console.log(`⚡ 跳过: ${file} 已经是标准的 MP4 格式，无需转换。`);
        processFile(index + 1);
      } else {
        const output = path.join(dir, file.replace(ext, '.mp4'));
        convertNormalToMp4(input, output, () => processFile(index + 1));
      }
    }
  });
}

function runFallbackConversion(file, input, index) {
  const ext = path.extname(file).toLowerCase();
  console.log(`--------------------------------------------------`);
  console.log(`📹 正在处理 (备用模式): ${file}`);
  
  if (file.includes('transparent-source') && ext === '.webm') {
    const output = path.join(dir, file.replace('.webm', '.mov').replace('transparent-source-', 'combo-material-'));
    convertSideBySideToMov(input, output, () => processFile(index + 1));
  } else if (ext === '.mov') {
    const output = path.join(dir, 'transparent-source-' + file.replace('.mov', '.webm'));
    convertTransparentToSideBySide(input, output, () => processFile(index + 1));
  } else {
    const output = path.join(dir, file.replace(ext, '.mp4'));
    convertNormalToMp4(input, output, () => processFile(index + 1));
  }
}

// 1. 左右双侧 WebM -> 透明 MOV (用于剪辑软件 AE/PR)
function convertSideBySideToMov(input, output, callback) {
  console.log(`✨ 转换目标: 合并左右双侧 -> 透明 Prores MOV`);
  console.log(`💾 输出路径: ${output}`);

  if (fs.existsSync(output)) {
    console.log(`⚠️ 输出文件已存在，跳过。`);
    callback();
    return;
  }

  ffmpeg(input)
    .complexFilter([
      '[0:v]format=yuv420p,split=2[left][right]',
      '[left]crop=iw/2:ih:0:0[rgb]',
      '[right]crop=iw/2:ih:iw/2:0,format=gray[alpha]',
      '[rgb][alpha]alphamerge[out]'
    ])
    .outputOptions([
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'prores_ks',
      '-profile:v', '4',
      '-pix_fmt', 'yuva444p10le',
      '-c:a', 'pcm_s16le',
      '-y'
    ])
    .save(output)
    .on('progress', (progress) => {
      if (progress.percent !== undefined) {
        const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
        process.stdout.write(`\r⏳ 转换进度: ${pct}%`);
      } else {
        process.stdout.write(`\r⏳ 正在转换... (当前帧: ${progress.frames})`);
      }
    })
    .on('end', () => {
      console.log(`\n✅ 转换成功！`);
      callback();
    })
    .on('error', (err) => {
      console.error(`\n❌ 转换失败: ${err.message}`);
      callback();
    });
}

// 2. 透明视频 (MOV/WEBM) -> 左右双侧 WebM (用于网页高性能播放)
function convertTransparentToSideBySide(input, output, callback) {
  console.log(`✨ 转换目标: 转换透明视频 -> 左右双侧 WebM`);
  console.log(`💾 输出路径: ${output}`);

  if (fs.existsSync(output)) {
    console.log(`⚠️ 输出文件已存在，跳过。`);
    callback();
    return;
  }

  ffmpeg(input)
    .complexFilter([
      '[0:v]split=2[left][right]',
      '[left]format=yuv420p[rgb]',
      '[right]format=yuva420p,alphaextract,format=yuv420p[alpha]',
      '[rgb][alpha]hstack[out]'
    ])
    .outputOptions([
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuv420p',
      '-crf', '30',
      '-b:v', '0',
      '-y'
    ])
    .save(output)
    .on('progress', (progress) => {
      if (progress.percent !== undefined) {
        const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
        process.stdout.write(`\r⏳ 转换进度: ${pct}%`);
      } else {
        process.stdout.write(`\r⏳ 正在转换... (当前帧: ${progress.frames})`);
      }
    })
    .on('end', () => {
      console.log(`\n✅ 转换成功！`);
      callback();
    })
    .on('error', (err) => {
      console.error(`\n❌ 转换失败: ${err.message}`);
      callback();
    });
}

// 3. 普通视频 -> 兼容性 MP4 (H.264)
function convertNormalToMp4(input, output, callback) {
  console.log(`✨ 转换目标: 转换普通视频 -> 兼容性 H.264 MP4`);
  console.log(`💾 输出路径: ${output}`);

  if (fs.existsSync(output)) {
    console.log(`⚠️ 输出文件已存在，跳过。`);
    callback();
    return;
  }

  ffmpeg(input)
    .outputOptions([
      '-vf', 'fps=30,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-threads', '0',
      '-y'
    ])
    .save(output)
    .on('progress', (progress) => {
      if (progress.percent !== undefined) {
        const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
        process.stdout.write(`\r⏳ 转换进度: ${pct}%`);
      } else {
        process.stdout.write(`\r⏳ 正在转换... (当前帧: ${progress.frames})`);
      }
    })
    .on('end', () => {
      console.log(`\n✅ 转换成功！`);
      callback();
    })
    .on('error', (err) => {
      console.error(`\n❌ 转换失败: ${err.message}`);
      callback();
    });
}

processFile(0);
