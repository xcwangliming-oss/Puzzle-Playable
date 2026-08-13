import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
import path from 'path';

async function buildPlayable() {
  console.log('Building standalone playable ad...');
  
  await build({
    root: process.cwd(),
    base: './',
    build: {
      outDir: 'dist_playable',
      emptyOutDir: true,
      minify: false,
      // The playable is downloaded as one HTML file, including all audio.
      assetsInlineLimit: 20_000_000,
    },
    plugins: [viteSingleFile()],
  });

  const outHtml = path.join(process.cwd(), 'dist_playable', 'index.html');
  if (fs.existsSync(outHtml)) {
    const html = fs.readFileSync(outHtml, 'utf8').replace(/\uFEFF/g, '').replace(/ï»¿/g, '');
    fs.writeFileSync(outHtml, html, 'utf8');
    console.log(`\n✅ Successfully generated playable ad at: ${outHtml}`);
    console.log(`You can upload this single HTML file to any ad network.`);
  } else {
    console.error('❌ Build failed to produce index.html');
  }
}

buildPlayable();
