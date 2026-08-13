import http from 'node:http';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, 'tmp');
const progressMap = new Map();
const port = Number(process.env.PORT || 3099);

await mkdir(tmpDir, { recursive: true });

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function parseTimemark(timemark) {
  const parts = String(timemark || '').split(':');
  if (parts.length !== 3) return 0;
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

function convertWebm({ inputPath, outputPath, mode, duration, taskId, fps }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath);

    if (mode === 'mp4') {
      command.outputOptions([
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
      ]);
    } else {
      command
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
          '-c:a', 'pcm_s16le'
        ]);
    }

    command
      .on('progress', progress => {
        if (duration > 0 && progress.timemark) {
          const pct = Math.min(100, (parseTimemark(progress.timemark) / duration) * 100);
          progressMap.set(taskId, pct);
        }
      })
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function handleConvert(req, res, url) {
  const taskId = url.searchParams.get('taskId') || randomUUID();
  const duration = Number(url.searchParams.get('duration') || 0);
  const mode = url.searchParams.get('mode') === 'mp4' ? 'mp4' : 'alpha';
  const fpsParam = Number(url.searchParams.get('fps') || 30);
  const fps = Math.max(24, Math.min(60, Number.isFinite(fpsParam) ? Math.round(fpsParam) : 30));
  const inputPath = path.join(tmpDir, `${taskId}.webm`);
  const outputPath = path.join(tmpDir, `${taskId}.${mode === 'mp4' ? 'mp4' : 'mov'}`);

  progressMap.set(taskId, 0);

  try {
    await pipeline(req, fs.createWriteStream(inputPath));
    await convertWebm({ inputPath, outputPath, mode, duration, taskId, fps });

    const stat = fs.statSync(outputPath);
    res.writeHead(200, {
      'content-type': mode === 'mp4' ? 'video/mp4' : 'video/quicktime',
      'content-length': stat.size,
      'content-disposition': `attachment; filename="${mode === 'mp4' ? 'direct-output.mp4' : 'combo-material.mov'}"`,
      'cache-control': 'no-store'
    });

    await pipeline(fs.createReadStream(outputPath), res);
  } catch (err) {
    console.error('[convert]', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Conversion failed' });
    } else {
      res.destroy(err);
    }
  } finally {
    progressMap.delete(taskId);
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true })
    ]);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/progress') {
    const taskId = url.searchParams.get('taskId') || '';
    sendJson(res, 200, { progress: progressMap.get(taskId) || 0 });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/convert') {
    await handleConvert(req, res, url);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Puzzle converter listening on http://127.0.0.1:${port}`);
});
