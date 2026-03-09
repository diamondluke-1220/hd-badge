#!/usr/bin/env bun
// extract-waveform.ts — Generate 60-bar waveform data from an MP3 file
// Usage: bun scripts/extract-waveform.ts <file.mp3> [bars=60]
//
// Output: a JS object entry ready to paste into badge-render.js WAVEFORMS
// Requires: ffmpeg installed (brew install ffmpeg)

const BARS = parseInt(process.argv[3] || '60', 10);
const file = process.argv[2];

if (!file) {
  console.error('Usage: bun scripts/extract-waveform.ts <file.mp3> [bars=60]');
  process.exit(1);
}

// Check file exists
const f = Bun.file(file);
if (!await f.exists()) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

// Get duration via ffprobe
const probe = Bun.spawnSync({
  cmd: ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
});
const duration = parseFloat(probe.stdout.toString().trim());
if (isNaN(duration) || duration <= 0) {
  console.error('Could not determine file duration. Is ffmpeg/ffprobe installed?');
  process.exit(1);
}

// Format duration as M:SS
const mins = Math.floor(duration / 60);
const secs = Math.round(duration % 60);
const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

// Extract raw 16-bit mono PCM via ffmpeg
const ffmpeg = Bun.spawnSync({
  cmd: ['ffmpeg', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '22050', '-v', 'error', 'pipe:1'],
});

if (ffmpeg.exitCode !== 0) {
  console.error('ffmpeg failed:', ffmpeg.stderr.toString());
  process.exit(1);
}

const raw = new Int16Array(ffmpeg.stdout.buffer);
const totalSamples = raw.length;
const samplesPerBar = Math.floor(totalSamples / BARS);

// Compute RMS amplitude per bar
const rmsValues: number[] = [];
for (let i = 0; i < BARS; i++) {
  const start = i * samplesPerBar;
  const end = Math.min(start + samplesPerBar, totalSamples);
  let sumSquares = 0;
  for (let j = start; j < end; j++) {
    const normalized = raw[j] / 32768; // normalize to -1..1
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / (end - start));
  rmsValues.push(rms);
}

// Normalize to 0..1 range (peak = 1.0)
const maxRms = Math.max(...rmsValues);
const normalized = rmsValues.map(v => Math.round((v / maxRms) * 1000) / 1000);

// Derive song name from filename (strip common prefixes like "Help Desk - ")
const basename = file.split('/').pop()!.replace(/\.[^.]+$/, '');
const songName = basename
  .replace(/^Help Desk\s*[-–—]\s*/i, '')
  .toUpperCase()
  .replace(/[-_]/g, ' ')
  .trim();

// Output ready-to-paste JS
console.log(`\n// Add this line to WAVEFORMS in public/js/badge-render.js:\n`);
console.log(`  '${songName}':${' '.repeat(Math.max(1, 22 - songName.length))}{ duration: '${durationStr}', data: [${normalized.join(',')}] },`);
console.log(`\n// Song: ${songName} | Duration: ${durationStr} | Bars: ${BARS}`);
console.log(`// Source: ${file}`);
