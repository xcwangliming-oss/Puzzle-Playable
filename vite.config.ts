import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import url from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { execFile } from 'child_process';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const progressMap = new Map<string, number>();
let playableTemplateHtml: string | null = null;
let playableTemplateStamp = '';
let playableTemplateBuild: Promise<string> | null = null;

const PLAYABLE_MAX_BYTES = 5 * 1024 * 1024;

type ExportedState = {
  params?: { effectType?: string };
  shatterColor?: string;
};

function toDataUrl(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mimeType};base64,${content.toString('base64')}`;
}

function readFrameSequence(directory: string, filenames: string[]): string[] {
  return filenames.map(filename => {
    const filePath = path.resolve(directory, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`缺少原始破碎帧：${filePath}`);
    }
    return toDataUrl(filePath);
  });
}

function getSelectedOriginalEffectFrames(state: ExportedState): { type: string; sequences: Record<string, string[]> } | undefined {
  const effectType = state.params?.effectType || 'default';

  // The playable owns a WebP copy of the original default shatter sequence.
  // Using it keeps the exported file below the 5 MB network limit without
  // substituting another effect.
  if (effectType === 'default') {
    return {
      type: effectType,
      sequences: {
        left: readFrameSequence(
          'assets/effects/playable-default/left',
          Array.from({ length: 44 }, (_, index) => `l_${String(index).padStart(2, '0')}.webp`),
        ),
        right: readFrameSequence(
          'assets/effects/playable-default/right',
          Array.from({ length: 44 }, (_, index) => `r_${String(index).padStart(2, '0')}.webp`),
        ),
      },
    };
  }

  if (effectType === 'highlight') {
    return {
      type: effectType,
      sequences: {
        highlight: readFrameSequence(
          'assets/effects/highlight',
          Array.from({ length: 34 }, (_, index) => `highlight_${String(index).padStart(2, '0')}.png`),
        ),
      },
    };
  }

  if (effectType === 'traditional') {
    return {
      type: effectType,
      sequences: {
        traditional: readFrameSequence(
          'assets/effects/traditional',
          Array.from({ length: 34 }, (_, index) => `Armature_green_${String(index).padStart(2, '0')}.png`),
        ),
      },
    };
  }

  const effectLabels: Record<string, string> = {
    'bordered-gem': '包边宝石',
    'gem-shatter': '宝石破碎',
  };
  if (effectLabels[effectType]) {
    throw new Error(`“${effectLabels[effectType]}”尚未提供不改变原始效果且小于 5MB 的可试玩帧资源，已停止生成，避免替换成其他效果。`);
  }

  throw new Error(`当前破碎效果“${effectType}”没有可导出的原始帧，已停止生成，避免替换成其他效果。`);
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getPlayableTemplateStamp(): string {
  const sourceFiles = [
    'index.html',
    'src/main.ts',
    'src/style.css',
    'src/boardMechanics.ts',
    'src/propRules.ts',
    'src/failureOverlay.ts',
    'src/playableStateContract.ts',
    'assets/playable-blocks',
    'assets/failure-impact.webp',
    'assets/ui/jewel-hand.png',
    'assets/ui/jewel-arrow.png',
    'assets/playable-audio',
  ];

  return sourceFiles.map(file => {
    try {
      const stat = fs.statSync(path.resolve(file));
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${file}:missing`;
    }
  }).join('|');
}

function getPlayableTemplate(): Promise<string> {
  const sourceStamp = getPlayableTemplateStamp();
  if (playableTemplateHtml && playableTemplateStamp === sourceStamp) {
    return Promise.resolve(playableTemplateHtml);
  }

  if (playableTemplateBuild) return playableTemplateBuild;

  playableTemplateBuild = new Promise((resolve, reject) => {
    execFile(process.execPath, ['build_playable.mjs'], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }

      const htmlPath = path.resolve('./dist_playable/index.html');
      if (!fs.existsSync(htmlPath)) {
        reject(new Error('HTML file not found after build.'));
        return;
      }

      playableTemplateHtml = fs.readFileSync(htmlPath, 'utf8').replace(/\uFEFF/g, '').replace(/茂禄驴/g, '');
      playableTemplateStamp = sourceStamp;
      resolve(playableTemplateHtml);
    });
  });

  playableTemplateBuild.finally(() => {
    playableTemplateBuild = null;
  }).catch(() => {});

  return playableTemplateBuild;
}

export default defineConfig({
  base: './',
  build: {
    outDir: process.env.VERCEL ? 'dist' : '../个人Blog/public/playables/block-puzzle',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'ffmpeg-converter',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const parsedUrl = url.parse(req.url!, true);
          
          if (parsedUrl.pathname === '/api/build-playable') {
              let bodyStr = '';
              req.on('data', chunk => {
                  bodyStr += chunk.toString();
              });
              req.on('end', () => {
                  let initialStateStr = '{}';
                  try {
                      if (bodyStr) {
                          const bodyJson = JSON.parse(bodyStr);
                          initialStateStr = bodyJson.initialState || '{}';
                      }
                  } catch(e) {}
                  
                  let parsedInitialState: ExportedState = {};
                  try {
                    parsedInitialState = JSON.parse(initialStateStr);
                  } catch {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end('导出的牌面数据无效，无法读取破碎效果设置。');
                    return;
                  }

                  let effectFrames: { type: string; sequences: Record<string, string[]> } | undefined;
                  try {
                    effectFrames = getSelectedOriginalEffectFrames(parsedInitialState);
                  } catch (error) {
                    res.statusCode = 422;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end(error instanceof Error ? error.message : String(error));
                    return;
                  }

                  getPlayableTemplate().then(templateHtml => {
                    let html = templateHtml;
                      html = html.replace(/\uFEFF/g, '').replace(/ï»¿/g, '');
                      
                      // Inject PLAYABLE_CONFIG
                      const configObj = { ...parsedUrl.query, initialState: initialStateStr, effectFrames };
                      const configScript = '<script>window.PLAYABLE_CONFIG = ' + serializeForInlineScript(configObj) + ';' + '<' + '/script>';
                      // The playable entry module reads PLAYABLE_CONFIG at module evaluation time.
                      // Inject it before that module rather than relying on deferred-module timing.
                      html = html.replace(/<script\s+type="module"/i, configScript + '<script type="module"');

                      if (Buffer.byteLength(html, 'utf8') > PLAYABLE_MAX_BYTES) {
                        res.statusCode = 422;
                        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                        res.end('生成后的单文件超过 5MB 限制。为保证效果与设置一致，已停止生成，不会自动替换破碎效果。');
                        return;
                      }
                      
                      res.setHeader('Content-Type', 'text/html');
                      res.setHeader('Cache-Control', 'no-store');
                      const qFilename = (parsedUrl.query.filename as string) || 'playable_ad.html';
                      const outFilename = qFilename.endsWith('.html') ? qFilename : qFilename + '.html';
                      res.setHeader('Content-Disposition', `attachment; filename="${outFilename}"`);
                      res.end(html);
                  }).catch(error => {
                    res.statusCode = 500;
                    res.end('Build failed:\n' + (error instanceof Error ? error.message : String(error)));
                  });
              });
              return;
          }

          if (parsedUrl.pathname === '/preview-standalone' || parsedUrl.pathname === '/preview-standalone.html') {
              const htmlPath = path.resolve('./dist_playable/index.html');
              if (fs.existsSync(htmlPath)) {
                  res.setHeader('Content-Type', 'text/html');
                  res.end(fs.readFileSync(htmlPath, 'utf8'));
              } else {
                  res.statusCode = 404;
                  res.end('No playable build found yet. Please click "生成并预览" first.');
              }
              return;
          }

          if (parsedUrl.pathname === '/api/progress' && req.method === 'GET') {
              const taskId = parsedUrl.query.taskId as string;
              const pct = progressMap.get(taskId) || 0;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ progress: pct }));
              return;
          }

          if (parsedUrl.pathname === '/api/convert' && req.method === 'POST') {
             const taskId = (parsedUrl.query.taskId as string) || Date.now().toString();
             const duration = parseFloat((parsedUrl.query.duration as string) || '0');
             const mode = parsedUrl.query.mode === 'mp4' ? 'mp4' : 'alpha';
             const fpsParam = Number((parsedUrl.query.fps as string) || 30);
             const fps = Math.max(24, Math.min(60, Number.isFinite(fpsParam) ? Math.round(fpsParam) : 30));
             const webmPath = path.resolve(`./temp_${taskId}.webm`);
             const movPath = path.resolve(`./temp_${taskId}.mov`);
             const mp4Path = path.resolve(`./temp_${taskId}.mp4`);
             
             progressMap.set(taskId, 0);

             const writeStream = fs.createWriteStream(webmPath);
             req.pipe(writeStream);
             
             req.on('end', () => {
                 if (mode === 'mp4') {
                   ffmpeg(webmPath)
                    .outputOptions([
                        '-map', '0:v:0',
                        '-map', '0:a?',
                        '-vf', `fps=${fps},format=yuv420p`,
                        '-c:v', 'libx264',
                        '-preset', 'veryfast',
                        '-crf', '20',
                        '-pix_fmt', 'yuv420p',
                        '-threads', '0',
                        '-c:a', 'aac',
                        '-b:a', '192k',
                        '-movflags', '+faststart'
                    ])
                   .on('progress', (progress) => {
                       if (duration > 0 && progress.timemark) {
                           const parts = progress.timemark.split(':');
                           const h = parseFloat(parts[0]);
                           const m = parseFloat(parts[1]);
                           const s = parseFloat(parts[2]);
                           const totalSeconds = h * 3600 + m * 60 + s;
                           let percent = (totalSeconds / duration) * 100;
                           if (percent > 100) percent = 100;
                           progressMap.set(taskId, percent);
                       }
                   })
                   .save(mp4Path)
                   .on('end', () => {
                       res.setHeader('Content-Type', 'video/mp4');
                       res.setHeader('Content-Disposition', 'attachment; filename="direct-output.mp4"');
                       const readStream = fs.createReadStream(mp4Path);
                       readStream.pipe(res);
                       readStream.on('end', () => {
                           progressMap.delete(taskId);
                           if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
                           if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
                       });
                   })
                   .on('error', (err) => {
                       console.error('FFmpeg MP4 Conversion Error:', err);
                       progressMap.delete(taskId);
                       res.statusCode = 500;
                       res.end('Conversion failed');
                       if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
                       if (fs.existsSync(mp4Path)) fs.unlinkSync(mp4Path);
                   });
                   return;
                 }

                 ffmpeg(webmPath)
                   .complexFilter([
                       '[0:v]format=yuv420p,split=2[left][right]', // 强制剥离Chrome录制的残留假Alpha通道！
                       '[left]crop=iw/2:ih:0:0[rgb]',       // 左半边：RGB画面
                       '[right]crop=iw/2:ih:iw/2:0,format=gray[alpha]',  // 右半边：转为单通道灰度图
                       '[rgb][alpha]alphamerge[out]'       // 将灰度图的亮度映射为真正的 Alpha 通道
                   ])
                    .outputOptions([
                        '-map', '[out]',
                        '-map', '0:a?',
                        '-c:v', 'prores_ks',      // 使用 Apple ProRes 编码器，而不是巨大的 qtrle
                        '-profile:v', '4',        // 4 代表 ProRes 4444，支持透明通道且体积大幅减小
                        '-pix_fmt', 'yuva444p10le', // 必须指定 10-bit YUV + Alpha 格式才能包含透明通道并被剪辑软件识别
                        '-c:a', 'pcm_s16le'       // 标准无损PCM音频，广泛兼容剪辑软件
                    ])
                   .on('progress', (progress) => {
                       if (duration > 0 && progress.timemark) {
                           const parts = progress.timemark.split(':');
                           const h = parseFloat(parts[0]);
                           const m = parseFloat(parts[1]);
                           const s = parseFloat(parts[2]);
                           const totalSeconds = h * 3600 + m * 60 + s;
                           let percent = (totalSeconds / duration) * 100;
                           if (percent > 100) percent = 100;
                           progressMap.set(taskId, percent);
                       }
                   })
                   .save(movPath)
                   .on('end', () => {
                       res.setHeader('Content-Type', 'video/quicktime');
                       res.setHeader('Content-Disposition', 'attachment; filename="combo-material.mov"');
                       const readStream = fs.createReadStream(movPath);
                       readStream.pipe(res);
                       readStream.on('end', () => {
                           progressMap.delete(taskId);
                           if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
                           if (fs.existsSync(movPath)) fs.unlinkSync(movPath);
                       });
                   })
                   .on('error', (err) => {
                       console.error('FFmpeg Conversion Error:', err);
                       progressMap.delete(taskId);
                       res.statusCode = 500;
                       res.end('Conversion failed');
                       if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
                   });
             });
             return;
          }
          next();
        });
      }
    }
  ]
});
