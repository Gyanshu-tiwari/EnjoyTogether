import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = util.promisify(exec);
const BACKEND_ROOT = process.cwd();
const inputPath = process.argv[2];
const fileId = process.argv[3] || 'master_party';

// ── Resolve input file path ───────────────────────────────────────────────────
// The frontend may upload .mkv, .avi, .mp4 etc. We search the uploads/ dir for
// any file whose basename starts with the fileId to find the actual file.
function resolveInputMovie(): string {
  if (inputPath) return path.resolve(inputPath);
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

// ── Supabase Storage client ────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const STORAGE_BUCKET = 'hls-streams';

interface VideoMetadata {
  duration: number;
  videoCodec: string;
  audioCodec: string;
}

async function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  const cmd = `ffprobe -v error -show_entries stream=codec_name,codec_type -show_entries format=duration -of json "${inputPath}"`;
  const { stdout } = await execPromise(cmd);
  const metadata = JSON.parse(stdout);

  const streams = metadata.streams || [];
  const videoStream = streams.find((s: any) => s.codec_type === 'video' && s.codec_name !== 'png' && s.codec_name !== 'mjpeg');
  const audioStream = streams.find((s: any) => s.codec_type === 'audio');

  const duration = parseFloat(metadata.format?.duration || '0');
  const videoCodec = videoStream?.codec_name || '';
  const audioCodec = audioStream?.codec_name || '';

  return { duration, videoCodec, audioCodec };
}

// ── Finalize Supabase Upload ────────────────────────────────────────────────
// Uploads the rewritten .m3u8 playlist, waits for any trailing segment uploads,
// and cleans up local Railway disk files.
async function finalizeSupabaseUpload(fileId: string, segmentFiles: string[]): Promise<string | null> {
  if (!supabase) {
    console.warn('⚠️ Supabase not configured — skipping CDN upload, using local Railway URL.');
    return null;
  }

  console.log(`☁️ Finalizing HLS playlist upload for [${fileId}] to Supabase Storage...`);

  const allFiles = fs.readdirSync(OUTPUT_DIR);
  const ownFiles = allFiles.filter(f => f.startsWith(fileId));
  const playlistFile = `${fileId}.m3u8`;

  if (!ownFiles.includes(playlistFile)) {
    console.error(`❌ Playlist file ${playlistFile} not found in output dir.`);
    return null;
  }

  // Step 1: Rewrite the .m3u8 playlist — replace relative segment paths
  //         with fully resolved Supabase CDN public URLs
  const m3u8LocalPath = path.join(OUTPUT_DIR, playlistFile);
  const originalPlaylist = fs.readFileSync(m3u8LocalPath, 'utf-8');
  const baseUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileId}`;

  const rewrittenPlaylist = originalPlaylist
    .split('\n')
    .map(line => {
      // Rewrite lines that are segment filenames (end in .ts, no # prefix)
      if (line.trim().length > 0 && !line.startsWith('#') && line.includes('.ts')) {
        const segmentName = line.trim();
        return `${baseUrl}/${segmentName}`;
      }
      return line;
    })
    .join('\n');

  // Step 2: Upload the rewritten .m3u8 playlist
  const { error: playlistError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(`${fileId}/${playlistFile}`, Buffer.from(rewrittenPlaylist, 'utf-8'), {
      contentType: 'application/x-mpegURL',
      upsert: true,
    });

  if (playlistError) {
    console.error(`❌ Failed to upload rewritten playlist:`, playlistError.message);
    return null;
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${fileId}/${playlistFile}`;
  console.log(`✅ HLS stream uploaded to Supabase CDN: ${publicUrl}`);

  // Step 3: Clean up local Railway disk files to prevent disk bloat
  for (const file of ownFiles) {
    try {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
    } catch (e) {
      // Non-fatal: best-effort cleanup
    }
  }
  // Also remove the source video to free Railway disk
  try {
    if (fs.existsSync(INPUT_MOVIE)) fs.unlinkSync(INPUT_MOVIE);
  } catch (e) {}

  console.log(`🗑️ Cleaned up local Railway disk files for [${fileId}].`);
  return publicUrl;
}

const updateStatus = (data: any) => {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
};

async function runPipeline() {
  try {
    if (!fs.existsSync(INPUT_MOVIE)) {
      console.error(`🔴 Source asset file not found at: ${INPUT_MOVIE}`);
      process.exit(1);
    }

    // ── Scoped directory cleanup ────────────────────────────────────────────
    // Only delete files for THIS fileId — not the entire output_hls/ directory.
    // This prevents concurrent transcoders from wiping each other's segments.
    if (fs.existsSync(OUTPUT_DIR)) {
      const existingFiles = fs.readdirSync(OUTPUT_DIR);
      const staleOwnFiles = existingFiles.filter(f => f.startsWith(fileId));
      for (const file of staleOwnFiles) {
        fs.rmSync(path.join(OUTPUT_DIR, file), { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('🔍 Inspecting incoming video attributes with ffprobe...');
    const { duration, videoCodec, audioCodec } = await getVideoMetadata(INPUT_MOVIE);
    console.log(`📊 Detected duration: ${duration}s, Video Codec: ${videoCodec}, Audio Codec: ${audioCodec}`);

    const PROGRESS_FILE = path.join(BACKEND_ROOT, 'transcode_progress.txt');

    updateStatus({ status: 'starting', progress: 0, eta: 'Calculating...', speed: '0x' });

    const SUPPORTED_VIDEO_CODECS = ['h264', 'vp9', 'av1'];
    const SUPPORTED_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

    const videoSupported = SUPPORTED_VIDEO_CODECS.includes(videoCodec.toLowerCase());
    const audioSupported = SUPPORTED_AUDIO_CODECS.includes(audioCodec.toLowerCase());

    const videoFlag = videoSupported ? '-c:v copy' : '-c:v libx264 -preset ultrafast -threads 0';
    const audioFlag = audioSupported ? '-c:a copy' : '-c:a aac -ac 2 -ar 48000 -aac_coder fast';

    console.log(`🎬 Configured mapping -> Video: ${videoFlag}, Audio: ${audioFlag}`);
    console.log('🎬 Starting adaptive keyframe-aligned HLS stream copy/transcode pipeline...');

    const ffmpegCmd = `ffmpeg -loglevel error -y -progress "${PROGRESS_FILE}" -i "${INPUT_MOVIE}" ${videoFlag} ${audioFlag} -map 0:v:0 -map 0:a:0 -sn -dn -start_number 0 -hls_time 10 -hls_list_size 0 -f hls "${OUTPUT_M3U8}"`;

    // ── Pipelined Background Segment Uploader ────────────────────────────────
    // Uploads segments to Supabase as soon as FFMPEG finishes writing them to the playlist
    const uploadedSegments = new Set<string>();
    const activeUploadPromises: Promise<void>[] = [];
    let allSegmentsIdentified: string[] = [];

    const uploadSegment = async (segFile: string) => {
      if (!supabase) return;
      const localPath = path.join(OUTPUT_DIR, segFile);
      if (!fs.existsSync(localPath)) return;
      
      try {
        const data = fs.readFileSync(localPath);
        const storagePath = `${fileId}/${segFile}`;
        const { error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, data, {
            contentType: 'video/MP2T',
            upsert: true,
          });
        if (error) throw error;
        console.log(`  ✓ Pipelined upload: ${segFile}`);
      } catch (e: any) {
        console.error(`❌ Failed to pipeline upload segment ${segFile}:`, e.message);
      }
    };

    // ── Progress & Upload polling interval ────────────────────────────────────
    // Declared outside try/finally so it is ALWAYS cleared on exit.
    const startTime = Date.now();
    const interval = setInterval(() => {
      // 1. Pipeline newly completed segments
      if (fs.existsSync(OUTPUT_M3U8)) {
        try {
          const playlistContent = fs.readFileSync(OUTPUT_M3U8, 'utf-8');
          const lines = playlistContent.split('\n');
          // Collect all segment filenames in order
          const segmentsInPlaylist: string[] = [];
          for (const line of lines) {
            const segFile = line.trim();
            if (segFile.length > 0 && !segFile.startsWith('#') && segFile.endsWith('.ts')) {
              segmentsInPlaylist.push(segFile);
            }
          }
          // Skip the LAST segment — ffmpeg may still be writing to it.
          // Only upload segments that have been "sealed" (i.e. ffmpeg has moved past them).
          const safeSegments = segmentsInPlaylist.slice(0, -1);
          for (const segFile of safeSegments) {
            if (!uploadedSegments.has(segFile)) {
              uploadedSegments.add(segFile);
              allSegmentsIdentified.push(segFile);
              const p = uploadSegment(segFile);
              activeUploadPromises.push(p);
            }
          }
        } catch (e) {
          // Ignore read collisions during FFMPEG writes
        }
      }

      // 2. Report progress
      if (fs.existsSync(PROGRESS_FILE)) {
        try {
          const content = fs.readFileSync(PROGRESS_FILE, 'utf-8');
          const lines = content.split('\n');
          let outTimeUs = 0;
          let speed = '0x';
          for (const line of lines) {
            const parts = line.split('=');
            if (parts.length >= 2) {
              const key = parts[0];
              const val = parts[1] || '';
              if (key === 'out_time_us') outTimeUs = parseInt(val, 10) || 0;
              if (key === 'speed') speed = val.trim();
            }
          }
          const outTimeSec = outTimeUs / 1000000;
          if (duration > 0) {
            const progressPercent = Math.min(100, Math.round((outTimeSec / duration) * 100));
            const progressRatio = outTimeSec / duration;
            let etaVal = 'Calculating...';
            const elapsedSec = (Date.now() - startTime) / 1000;
            if (progressPercent >= 2 && progressPercent < 100 && elapsedSec > 5 && progressRatio > 0) {
              const remainingSec = (elapsedSec / progressRatio) - elapsedSec;
              if (remainingSec > 0) {
                const mins = Math.floor(remainingSec / 60);
                const secs = Math.floor(remainingSec % 60);
                etaVal = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
              }
            } else if (progressPercent >= 100) {
              etaVal = 'Finishing...';
            }
            updateStatus({ status: 'encoding', progress: progressPercent, eta: etaVal, speed });
          }
        } catch (e) {
          // Ignore read collisions during concurrent writes
        }
      }
    }, 1000);

    try {
      await execPromise(ffmpegCmd);
      console.log('🎉 Local HLS transcoding completed successfully.');

      // ── Upload remaining segments to Supabase CDN ─────────────────────────
      updateStatus({ status: 'uploading_segments', progress: 100, eta: 'Finishing CDN upload...', speed: '0x' });
      
      // Wait for any pipelined segment uploads that were started during the interval
      await Promise.allSettled(activeUploadPromises);
      
      // Now finalize by rewriting the .m3u8 playlist and uploading it
      const supabaseStreamUrl = await finalizeSupabaseUpload(fileId, allSegmentsIdentified);

      updateStatus({
        status: 'complete',
        progress: 100,
        eta: '0s',
        speed: '0x',
        // If Supabase upload succeeded, provide the persistent CDN URL.
        // If not, the player will fall back to the Railway local URL it already has.
        streamUrl: supabaseStreamUrl || null,
      });

    } finally {
      // ── Guaranteed interval cleanup ───────────────────────────────────────
      clearInterval(interval);
      if (fs.existsSync(PROGRESS_FILE)) {
        try { fs.unlinkSync(PROGRESS_FILE); } catch (e) {}
      }
    }

  } catch (error: any) {
    console.error('❌ Pipeline processing failed:', error);
    try {
      const errLogPath = path.join(OUTPUT_DIR, 'transcoder.log');
      fs.writeFileSync(errLogPath, '❌ Pipeline processing failed: ' + (error?.stack || error) + '\n', { flag: 'a' });
    } catch (e) {}
    try {
      updateStatus({ status: 'failed', progress: 0, eta: 'Failed', speed: '0x' });
    } catch (e) {}
  }
}

runPipeline();