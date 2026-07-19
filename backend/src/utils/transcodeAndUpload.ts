import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';

const execPromise = util.promisify(exec);
const BACKEND_ROOT = process.cwd();
const inputPath = process.argv[2];
const fileId = process.argv[3] || 'master_party';
const INPUT_MOVIE = inputPath ? path.resolve(inputPath) : path.join(BACKEND_ROOT, 'sample.mp4');
const OUTPUT_DIR = path.join(BACKEND_ROOT, 'output_hls');
const OUTPUT_M3U8 = path.join(OUTPUT_DIR, `${fileId}.m3u8`);

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

async function runPipeline() {
  try {
    if (!fs.existsSync(INPUT_MOVIE)) {
      console.error(`🔴 Source asset file not found at: ${INPUT_MOVIE}`);
      process.exit(1);
    }

    if (fs.existsSync(OUTPUT_DIR)) {
      const files = fs.readdirSync(OUTPUT_DIR);
      for (const file of files) {
        fs.rmSync(path.join(OUTPUT_DIR, file), { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('🔍 Inspecting incoming video attributes with ffprobe...');
    const { duration, videoCodec, audioCodec } = await getVideoMetadata(INPUT_MOVIE);
    console.log(`📊 Detected duration: ${duration}s, Video Codec: ${videoCodec}, Audio Codec: ${audioCodec}`);

    const PROGRESS_FILE = path.join(BACKEND_ROOT, 'transcode_progress.txt');
    const STATUS_FILE = path.join(BACKEND_ROOT, 'transcode_status.json');

    const updateStatus = (data: any) => {
      fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
    };

    updateStatus({
      status: 'starting',
      progress: 0,
      eta: 'Calculating...',
      speed: '0x'
    });

    const SUPPORTED_VIDEO_CODECS = ['h264', 'vp9', 'av1'];
    const SUPPORTED_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

    const videoSupported = SUPPORTED_VIDEO_CODECS.includes(videoCodec.toLowerCase());
    const audioSupported = SUPPORTED_AUDIO_CODECS.includes(audioCodec.toLowerCase());

    const videoFlag = videoSupported ? '-c:v copy' : '-c:v libx264 -preset ultrafast -threads 0';
    const audioFlag = audioSupported ? '-c:a copy' : '-c:a aac -ac 2 -ar 48000 -aac_coder fast';

    console.log(`🎬 Configured mapping -> Video: ${videoFlag}, Audio: ${audioFlag}`);
    console.log('🎬 Starting adaptive keyframe-aligned HLS stream copy/transcode pipeline...');

    const ffmpegCmd = `ffmpeg -loglevel error -y -progress "${PROGRESS_FILE}" -i "${INPUT_MOVIE}" ${videoFlag} ${audioFlag} -map 0:v:0 -map 0:a:0 -sn -dn -start_number 0 -hls_time 10 -hls_list_size 0 -f hls "${OUTPUT_M3U8}"`;
    
    // ── Progress polling interval ─────────────────────────────────────────────
    // Stored at the outer scope so the finally block can always clear it,
    // regardless of whether ffmpeg succeeds or fails. This prevents memory
    // leaks on Railway in failure scenarios.
    const startTime = Date.now();
    const interval = setInterval(() => {
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
              if (key === 'out_time_us') {
                outTimeUs = parseInt(val, 10) || 0;
              }
              if (key === 'speed') {
                speed = val.trim();
              }
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
            
            updateStatus({
              status: 'encoding',
              progress: progressPercent,
              eta: etaVal,
              speed: speed
            });
          }
        } catch (e) {
          // Ignore read collisions during concurrent write
        }
      }
    }, 1000);

    try {
      await execPromise(ffmpegCmd);
      console.log('🎉 Local HLS Master generated successfully.');
      updateStatus({ status: 'complete', progress: 100, eta: '0s', speed: '0x' });
    } finally {
      // ── Guaranteed cleanup ──────────────────────────────────────────────────
      // Always clear the interval and delete the progress file — whether ffmpeg
      // succeeded, failed, or was killed. This prevents Railway memory leaks.
      clearInterval(interval);
      if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    }

  } catch (error: any) {
    console.error('❌ Pipeline processing failed:', error);
    try {
      const errLogPath = path.join(OUTPUT_DIR, 'transcoder.log');
      fs.writeFileSync(errLogPath, '❌ Pipeline processing failed: ' + (error?.stack || error) + '\n', { flag: 'a' });
    } catch (e) {}

    try {
      fs.writeFileSync(path.join(BACKEND_ROOT, 'transcode_status.json'), JSON.stringify({
        status: 'failed',
        progress: 0,
        eta: 'Failed',
        speed: '0x'
      }, null, 2));
    } catch (e) {}
  }
}

runPipeline();