import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// ── Shell command helpers ──────────────────────────────────────────────────────

// execCapture: captures stdout (for ffprobe JSON parsing), no buffer limit issues
function execCapture(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      } else {
        reject(new Error(`Command failed (code ${code}): ${Buffer.concat(errChunks).toString('utf-8').slice(0, 500)}`));
      }
    });
    child.on('error', reject);
  });
}

// execStream: streams stdout/stderr to our process (for ffmpeg which writes to a progress file)
// Resolves on exit code 0 OR 1 (ffmpeg exits 1 on minor warnings but still succeeds).
// Only rejects on code >= 2 (actual hard failures).
function execStream(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => process.stdout.write(d));
    child.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('close', (code) => {
      // ffmpeg exits 1 on warnings but still produces valid output.
      // Only treat code >= 2 as a genuine failure.
      if (code === null || code <= 1) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

// ── Args & paths ──────────────────────────────────────────────────────────────
const BACKEND_ROOT = process.cwd();
const inputPath = process.argv[2];
const fileId = process.argv[3] || 'master_party';

function resolveInputMovie(): string {
  if (inputPath && fs.existsSync(path.resolve(inputPath))) return path.resolve(inputPath);
  const uploadsDir = path.join(BACKEND_ROOT, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const found = fs.readdirSync(uploadsDir).find(f => f.startsWith(fileId));
    if (found) return path.join(uploadsDir, found);
  }
  return path.join(BACKEND_ROOT, 'sample.mp4');
}

const INPUT_MOVIE = resolveInputMovie();
const OUTPUT_DIR = path.join(BACKEND_ROOT, 'output_hls');
const OUTPUT_M3U8 = path.join(OUTPUT_DIR, `${fileId}.m3u8`);
const STATUS_FILE = path.join(BACKEND_ROOT, `transcode_status_${fileId}.json`);
const PROGRESS_FILE = path.join(BACKEND_ROOT, `transcode_progress_${fileId}.txt`);

// ── Supabase Storage client ────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const STORAGE_BUCKET = 'hls-streams';

// ── Status writer ─────────────────────────────────────────────────────────────
const updateStatus = (data: Record<string, unknown>) => {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to write status file:', e);
  }
};

// ── Video metadata via ffprobe ─────────────────────────────────────────────────
interface VideoMetadata {
  duration: number;
  videoCodec: string;
  audioCodec: string;
}

async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const cmd = `ffprobe -v error -show_entries stream=codec_name,codec_type -show_entries format=duration -of json "${filePath}"`;
  const stdout = await execCapture(cmd);
  const metadata = JSON.parse(stdout);

  const streams = metadata.streams || [];
  const videoStream = streams.find((s: any) => s.codec_type === 'video' && s.codec_name !== 'png' && s.codec_name !== 'mjpeg');
  const audioStream = streams.find((s: any) => s.codec_type === 'audio');

  return {
    duration: parseFloat(metadata.format?.duration || '0'),
    videoCodec: videoStream?.codec_name || '',
    audioCodec: audioStream?.codec_name || '',
  };
}

// ── Supabase segment uploader ─────────────────────────────────────────────────
const UPLOAD_CONCURRENCY = 5;
const uploadedSegments = new Set<string>();
const uploadQueue: string[] = [];
let activeUploads = 0;
// Collect all promises so we can await them at the end
const allUploadPromises: Promise<void>[] = [];

// Helper to add timeout to any promise
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms))
  ]);
};

async function uploadSegment(segFile: string, retries = 3): Promise<void> {
  if (!supabase) return;
  const localPath = path.join(OUTPUT_DIR, segFile);
  if (!fs.existsSync(localPath)) {
    console.warn(`⚠️ Segment file not found, skipping: ${segFile}`);
    return;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = fs.readFileSync(localPath);
      const { error } = await withTimeout(
        supabase.storage.from(STORAGE_BUCKET).upload(`${fileId}/${segFile}`, data, { contentType: 'video/MP2T', upsert: true }),
        15000 // 15 second timeout per segment attempt
      );
      if (error) throw error;
      console.log(`  ✓ CDN upload: ${segFile}`);
      return;
    } catch (e: any) {
      console.error(`⚠️ Upload attempt ${attempt}/${retries} failed for ${segFile}:`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  console.error(`❌ Failed to upload segment ${segFile} after ${retries} attempts.`);
}

function drainQueue(): void {
  while (uploadQueue.length > 0 && activeUploads < UPLOAD_CONCURRENCY) {
    const segFile = uploadQueue.shift()!;
    activeUploads++;
    const p = uploadSegment(segFile).finally(() => {
      activeUploads--;
      drainQueue(); // Immediately fill freed slot
    });
    allUploadPromises.push(p);
  }
}

function enqueueSegment(segFile: string): void {
  if (uploadedSegments.has(segFile)) return;
  uploadedSegments.add(segFile);
  uploadQueue.push(segFile);
  drainQueue();
}

// ── Finalize Supabase Upload ───────────────────────────────────────────────────
async function finalizeSupabaseUpload(): Promise<string | null> {
  if (!supabase) {
    console.warn('⚠️ Supabase not configured — using local server URL.');
    return null;
  }

  console.log(`☁️ Finalizing HLS playlist upload for [${fileId}] to Supabase Storage...`);

  const playlistFile = `${fileId}.m3u8`;
  const m3u8LocalPath = path.join(OUTPUT_DIR, playlistFile);

  if (!fs.existsSync(m3u8LocalPath)) {
    console.error(`❌ Playlist file not found: ${m3u8LocalPath}`);
    return null;
  }

  // Rewrite .m3u8 with absolute Supabase CDN URLs for each segment
  const baseUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileId}`;
  const originalPlaylist = fs.readFileSync(m3u8LocalPath, 'utf-8');
  const rewrittenPlaylist = originalPlaylist
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('#') && trimmed.endsWith('.ts')) {
        return `${baseUrl}/${trimmed}`;
      }
      return line;
    })
    .join('\n');

  try {
    const { error: playlistError } = await withTimeout(
      supabase.storage
        .from(STORAGE_BUCKET)
        .upload(`${fileId}/${playlistFile}`, Buffer.from(rewrittenPlaylist, 'utf-8'), {
          contentType: 'application/x-mpegURL',
          upsert: true,
        }),
      15000
    );

    if (playlistError) {
      console.error(`❌ Failed to upload rewritten playlist:`, playlistError.message);
      return null;
    }
  } catch (e: any) {
    console.error(`❌ Failed to upload rewritten playlist (timeout/network):`, e.message);
    return null;
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileId}/${playlistFile}`;
  console.log(`✅ HLS stream on CDN: ${publicUrl}`);

  // Clean up local files to free disk space
  try {
    const allFiles = fs.readdirSync(OUTPUT_DIR);
    for (const file of allFiles.filter(f => f.startsWith(fileId))) {
      try { fs.unlinkSync(path.join(OUTPUT_DIR, file)); } catch {}
    }
    if (fs.existsSync(INPUT_MOVIE)) fs.unlinkSync(INPUT_MOVIE);
    console.log(`🗑️ Cleaned up local files for [${fileId}].`);
  } catch {}

  return publicUrl;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function runPipeline() {
  try {
    if (!fs.existsSync(INPUT_MOVIE)) {
      console.error(`🔴 Source file not found: ${INPUT_MOVIE}`);
      updateStatus({ status: 'failed', progress: 0, eta: 'Source file missing', speed: '0x' });
      process.exit(1);
    }

    // Clean up stale output files from previous runs for this fileId only
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    } else {
      for (const f of fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith(fileId))) {
        try { fs.rmSync(path.join(OUTPUT_DIR, f), { recursive: true, force: true }); } catch {}
      }
    }

    console.log('🔍 Running ffprobe on input file...');
    const { duration, videoCodec, audioCodec } = await getVideoMetadata(INPUT_MOVIE);
    console.log(`📊 Duration: ${duration}s | Video: ${videoCodec} | Audio: ${audioCodec}`);

    if (duration === 0) {
      throw new Error('ffprobe returned duration=0. Input file may be corrupt or unsupported.');
    }

    updateStatus({ status: 'starting', progress: 0, eta: 'Calculating...', speed: '0x' });

    // Smart codec detection — copy if already compatible, transcode otherwise
    const videoSupported = ['h264', 'hevc', 'h265', 'vp9', 'av1'].includes(videoCodec.toLowerCase());
    const audioSupported = ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(audioCodec.toLowerCase());

    const videoFlag = videoSupported ? '-c:v copy' : '-c:v libx264 -preset ultrafast -crf 23 -threads 0';
    const audioFlag = audioSupported ? '-c:a copy' : '-c:a aac -ac 2 -ar 48000';

    console.log(`🎬 Video: ${videoFlag} | Audio: ${audioFlag}`);

    const ffmpegCmd = [
      'ffmpeg -y',
      `-loglevel error`,
      `-progress "${PROGRESS_FILE}"`,
      `-i "${INPUT_MOVIE}"`,
      videoFlag,
      audioFlag,
      '-map 0:v:0? -map 0:a:0?',
      '-sn -dn',
      '-start_number 0',
      '-hls_time 10',
      '-hls_list_size 0',
      '-hls_flags append_list',
      `-f hls "${OUTPUT_M3U8}"`,
    ].join(' ');

    console.log('🚀 Starting ffmpeg HLS pipeline...');

    // ── Progress reporter + pipelined CDN uploader ─────────────────────────
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
      // 1. Pipeline newly written segments to Supabase
      if (fs.existsSync(OUTPUT_M3U8)) {
        try {
          const lines = fs.readFileSync(OUTPUT_M3U8, 'utf-8').split('\n');
          const segments = lines.filter(l => {
            const t = l.trim();
            return t.length > 0 && !t.startsWith('#') && t.endsWith('.ts');
          });
          // Skip the last segment — ffmpeg may still be writing to it
          for (const seg of segments.slice(0, -1)) {
            enqueueSegment(seg.trim());
          }
        } catch {}
      }

      // 2. Parse ffmpeg progress file and report status
      if (fs.existsSync(PROGRESS_FILE)) {
        try {
          const content = fs.readFileSync(PROGRESS_FILE, 'utf-8');
          let outTimeUs = 0;
          let speed = '0x';
          for (const line of content.split('\n')) {
            const [key, val] = line.split('=');
            if (key === 'out_time_us') outTimeUs = parseInt(val ?? '0', 10) || 0;
            if (key === 'speed') speed = (val ?? '').trim();
          }
          if (duration > 0 && outTimeUs > 0) {
            const outTimeSec = outTimeUs / 1_000_000;
            const pct = Math.min(99, Math.round((outTimeSec / duration) * 100));
            const elapsed = (Date.now() - startTime) / 1000;
            const ratio = outTimeSec / duration;
            let eta = 'Calculating...';
            if (pct >= 1 && elapsed > 2 && ratio > 0) {
              const remaining = (elapsed / ratio) - elapsed;
              if (remaining > 0) {
                const m = Math.floor(remaining / 60);
                const s = Math.floor(remaining % 60);
                eta = m > 0 ? `${m}m ${s}s` : `${s}s`;
              }
            }
            updateStatus({ status: 'encoding', progress: pct, eta, speed });
          }
        } catch {}
      }
    }, 1000);

    try {
      await execStream(ffmpegCmd);
      console.log('✅ ffmpeg completed.');
    } finally {
      clearInterval(progressInterval);
      try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch {}
    }

    // Enqueue the final segment (previously skipped to avoid partial writes)
    if (fs.existsSync(OUTPUT_M3U8)) {
      const lines = fs.readFileSync(OUTPUT_M3U8, 'utf-8').split('\n');
      for (const line of lines) {
        const seg = line.trim();
        if (seg.length > 0 && !seg.startsWith('#') && seg.endsWith('.ts')) {
          enqueueSegment(seg);
        }
      }
    }

    updateStatus({ status: 'uploading_segments', progress: 100, eta: 'Uploading to CDN...', speed: '0x' });

    // Wait for the queue to completely drain
    while (uploadQueue.length > 0 || activeUploads > 0) {
      await new Promise(r => setTimeout(r, 500));
    }
    // Await all promises to ensure rejections are caught (though we swallow them in uploadSegment)
    await Promise.allSettled(allUploadPromises);

    // Upload the rewritten .m3u8 and get the CDN URL
    const supabaseStreamUrl = await finalizeSupabaseUpload();

    updateStatus({
      status: 'complete',
      progress: 100,
      eta: '0s',
      speed: '0x',
      streamUrl: supabaseStreamUrl || null,
    });

    console.log('🎉 Pipeline complete!', supabaseStreamUrl ? `CDN: ${supabaseStreamUrl}` : '(local URL)');

    // Grace period before deleting status file
    setTimeout(() => {
      try { if (fs.existsSync(STATUS_FILE)) fs.unlinkSync(STATUS_FILE); } catch {}
    }, 60_000);

  } catch (error: any) {
    console.error('❌ Pipeline failed:', error?.message || error);
    try {
      fs.appendFileSync(path.join(OUTPUT_DIR, 'transcoder.log'), `❌ ${error?.stack || error}\n`);
    } catch {}
    updateStatus({ status: 'failed', progress: 0, eta: 'Failed', speed: '0x', error: error?.message || 'Unknown error' });
  }
}

runPipeline();