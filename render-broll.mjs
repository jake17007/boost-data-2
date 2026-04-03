#!/usr/bin/env node
/**
 * Remotion server-side render script for B-Roll compositions.
 * Called by the Python server via subprocess.
 *
 * Usage: node render-broll.mjs <json-config-path>
 *
 * Config JSON:
 * {
 *   "mainVideoUrl": "http://localhost:8000/serve-video?path=...",
 *   "brollActions": [...],
 *   "totalDuration": 46.5,
 *   "compositionWidth": 1920,
 *   "compositionHeight": 1080,
 *   "brollVolume": 0.15,
 *   "outputPath": "/path/to/output.mp4"
 * }
 */
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs';

const configPath = process.argv[2];
if (!configPath) {
  console.error(JSON.stringify({ status: 'error', error: 'No config path provided' }));
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const FPS = 30;
const durationInFrames = Math.max(1, Math.round((config.totalDuration || 30) * FPS));

async function main() {
  try {
    console.error('[remotion] Bundling composition...');
    const bundleLocation = await bundle({
      entryPoint: path.resolve(path.dirname(new URL(import.meta.url).pathname), 'src/remotion/index.jsx'),
      webpackOverride: (currentConfig) => currentConfig,
    });

    console.error('[remotion] Selecting composition...');
    const inputProps = {
      mainVideoUrl: config.mainVideoUrl,
      brollActions: config.brollActions,
      fps: FPS,
      brollVolume: config.brollVolume ?? 0.15,
    };

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'BRollComposition',
      inputProps,
    });

    // Override duration and dimensions from config
    composition.durationInFrames = durationInFrames;
    composition.width = config.compositionWidth || 1920;
    composition.height = config.compositionHeight || 1080;
    composition.fps = FPS;

    console.error(`[remotion] Rendering ${durationInFrames} frames...`);

    let lastPercent = 0;
    const cpus = (await import('os')).default.cpus().length;
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: config.outputPath,
      inputProps,
      concurrency: Math.max(2, Math.min(cpus, 8)),
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct > lastPercent) {
          lastPercent = pct;
          // Write progress to stdout as JSON lines for the Python server to read
          console.log(JSON.stringify({ status: 'progress', percent: pct }));
        }
      },
    });

    console.log(JSON.stringify({ status: 'done', outputPath: config.outputPath }));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
    process.exit(1);
  }
}

main();
