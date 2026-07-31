import React, { useState, useRef, useEffect } from 'react';
import { useDebounce } from '@/shared/hooks/useDebounce';
import {
  fetchMovieMetadata,
  startUpload,
  uploadChunk,
  getTranscodeStatus,
  type MovieMetadata
} from '../api/theaterApi';
import { AlertTriangle, Film, UploadCloud, Cpu, Zap, Play } from 'lucide-react';

interface UploadDashboardProps {
  onUploadSuccess: (streamUrl: string) => void;
}

export const UploadDashboard: React.FC<UploadDashboardProps> = ({ onUploadSuccess }) => {
  const [movieTitle, setMovieTitle] = useState('');
  const [metadata, setMetadata] = useState<MovieMetadata | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<'idle' | 'uploading' | 'transcoding' | 'complete'>('idle');
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState('');
  const [fileId, setFileId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadSpeed, setUploadSpeed] = useState<string>('');
  const [eta, setEta] = useState<string>('');
  const startTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling interval on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Debounce TMDB API lookup requests using useDebounce hook
  const debouncedMovieTitle = useDebounce(movieTitle, 600);

  useEffect(() => {
    const lookupMetadata = async () => {
      if (debouncedMovieTitle.length > 2) {
        const data = await fetchMovieMetadata(debouncedMovieTitle);
        if (data) setMetadata(data);
      }
    };
    lookupMetadata();
  }, [debouncedMovieTitle]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleActualUpload = async () => {
    if (!file || uploading || isUploadingRef.current) return;

    isUploadingRef.current = true;
    setError(null);
    setProcessingPhase('uploading');
    setUploading(true);
    setProgress(0);
    setUploadComplete(false);
    setUploadSpeed('');
    setEta('');
    startTimeRef.current = Date.now();

    try {
      console.log("📤 Dispatching sequential chunk network requests to backend...");

      const CHUNK_SIZE = 15 * 1024 * 1024; // 15MB chunks to minimize HTTP request overhead and significantly speed up upload
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const newFileId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      setFileId(newFileId);

      try {
        await startUpload(newFileId);
      } catch (err) {
        console.warn("Failed to update global status to uploading, continuing...", err);
      }

      let lastResponseData: { success?: boolean; fileId?: string; streamUrl?: string } | null = null;
      let totalLoaded = 0;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        console.log(`Uploading chunk ${chunkIndex + 1}/${totalChunks}`);

        let chunkSuccess = false;
        let attempt = 0;
        const MAX_RETRIES = 3;

        while (!chunkSuccess && attempt < MAX_RETRIES) {
          try {
            lastResponseData = await uploadChunk({
              chunk: chunkBlob,
              fileName: file.name,
              fileId: newFileId,
              chunkIndex,
              totalChunks,
              onProgress: (progressEvent: import('axios').AxiosProgressEvent) => {
                const chunkLoaded = progressEvent.loaded;
                const currentTotalLoaded = totalLoaded + chunkLoaded;
                const percentCompleted = Math.round((currentTotalLoaded * 100) / file.size);
                setProgress(percentCompleted);

                const elapsedMs = Date.now() - startTimeRef.current;
                if (elapsedMs > 1000) {
                  const elapsedSec = elapsedMs / 1000;
                  const bytesPerSec = currentTotalLoaded / elapsedSec;
                  const remainingBytes = file.size - currentTotalLoaded;
                  const remainingSec = bytesPerSec > 0 ? remainingBytes / bytesPerSec : 0;

                  const speedMBps = bytesPerSec / (1024 * 1024);
                  setUploadSpeed(`${speedMBps.toFixed(2)} MB/s`);

                  if (remainingSec > 0) {
                    const mins = Math.floor(remainingSec / 60);
                    const secs = Math.floor(remainingSec % 60);
                    setEta(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
                  } else {
                    setEta('Almost done...');
                  }
                }
              }
            });
            chunkSuccess = true;
          } catch (chunkErr) {
            attempt++;
            console.warn(`⚠️ Chunk ${chunkIndex + 1} upload failed (attempt ${attempt}/${MAX_RETRIES}). Retrying...`, chunkErr);
            if (attempt >= MAX_RETRIES) {
              throw new Error(`Upload failed after 3 retries on chunk ${chunkIndex + 1}. Network instability detected.`, { cause: chunkErr });
            }
            // Exponential backoff before retry (2s, 4s)
            await new Promise(r => setTimeout(r, attempt * 2000));
          }
        }
        
        totalLoaded += chunkBlob.size;
      }

      if (lastResponseData?.success) {
        console.log("Uploaded successfully! File Identifier Map reference:", lastResponseData.fileId);
        
        let streamUrl = lastResponseData.streamUrl || '';
        if (!streamUrl) {
          const backendBase = import.meta.env.VITE_BACKEND_URL
            ? (import.meta.env.VITE_BACKEND_URL.startsWith('http') ? import.meta.env.VITE_BACKEND_URL : `https://${import.meta.env.VITE_BACKEND_URL}`)
            : `http://${window.location.hostname}:5000`;
          streamUrl = `${backendBase}/api/video/hls-local/${newFileId}.m3u8`;
        }
        if (streamUrl.startsWith('/')) {
          let backendUrl = import.meta.env.VITE_BACKEND_URL || '';
          if (backendUrl && !backendUrl.startsWith('http')) {
            backendUrl = `https://${backendUrl}`;
          }
          streamUrl = `${backendUrl}${streamUrl}`;
        } else if (!streamUrl.startsWith('http')) {
          streamUrl = `https://${streamUrl}`;
        }
        setResolvedStreamUrl(streamUrl);
        
        setProcessingPhase('transcoding');
        setProgress(0);
        setUploadSpeed('Calculating...');
        setEta('Calculating...');

        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 5;

        pollIntervalRef.current = setInterval(async () => {
          const poll = async () => {
            try {
              const statusRes = await getTranscodeStatus(newFileId);
              const { status: tStatus, progress: tProgress, eta: tEta, speed: tSpeed, streamUrl: cdnUrl } = statusRes as import('../api/theaterApi').TranscodeStatus & { streamUrl?: string };
              consecutiveErrors = 0; // reset on success

              if (tStatus === 'encoding' || tStatus === 'starting') {
                setProgress(tProgress ?? 0);
                setUploadSpeed(tSpeed ?? 'Calculating...');
                setEta(tEta ?? 'Calculating...');
              } else if (tStatus === 'uploading_segments' || tStatus === 'uploading') {
                setProgress(100);
                setUploadSpeed('Uploading to CDN...');
                setEta(tEta ?? 'Almost done...');
              } else if (tStatus === 'complete') {
                clearInterval(pollIntervalRef.current!);
                pollIntervalRef.current = null;
                setProgress(100);
                // If the transcoder uploaded to Supabase CDN, switch to the persistent URL
                if (cdnUrl) {
                  setResolvedStreamUrl(cdnUrl);
                }
                setProcessingPhase('complete');
                setUploading(false);
                setUploadComplete(true);
                isUploadingRef.current = false;
              } else if (tStatus === 'failed') {
                clearInterval(pollIntervalRef.current!);
                pollIntervalRef.current = null;
                setError("Transcoding pipeline failed on backend. Check ffmpeg logs.");
                setUploading(false);
                setProcessingPhase('idle');
                isUploadingRef.current = false;
              }
              // 'idle' status means the transcoder hasn't written its status file yet — keep polling
            } catch (err) {
              consecutiveErrors++;
              console.error(`Failed to poll transcode status (attempt ${consecutiveErrors}):`, err);
              if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                clearInterval(pollIntervalRef.current!);
                pollIntervalRef.current = null;
                const errMsg = err instanceof Error ? err.message : "Lost connection to the transcoder backend server.";
                setError(errMsg);
                setUploading(false);
                setProcessingPhase('idle');
                isUploadingRef.current = false;
              }
            }
          };
          
          poll();
        }, 1500); // Poll every 1.5s for snappy completion detection
      }
    } catch (err) {
      console.error("🔴 Network upload pipeline transmission failed:", err);
      const errMsg = err instanceof Error ? err.message : "Network transmission failed. Verify backend server is alive.";
      setError(errMsg);
      setUploading(false);
      setProcessingPhase('idle');
      isUploadingRef.current = false;
    }
  };

  return (
    <div className="w-full max-w-4xl bg-bg-card border border-white/5 rounded-3xl p-8 shadow-2xl text-white animate-fade-in">
      <h2 className="text-2xl font-black mb-1 text-indigo-400 tracking-tight">
        Deploy New Theater Session
      </h2>
      <p className="text-xs text-text-secondary mb-6">
        Select a movie track and search for its details to begin.
      </p>

      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-450 shrink-0" />
            <span>{error}</span>
          </div>
          <button 
            onClick={() => setError(null)} 
            className="text-neutral-400 hover:text-white transition-all cursor-pointer font-bold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-2">
        {/* Left Input Matrix Controls */}
        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-[10px] font-bold text-text-secondary mb-2 tracking-wider uppercase">Movie Title Lookup</label>
            <input
              type="text"
              value={movieTitle}
              onChange={(e) => setMovieTitle(e.target.value)}
              placeholder="Search movie details..."
              className="w-full px-4 py-3 bg-bg-transparent rounded-2xl border border-white/5 focus:outline-none focus:border-brand/40 text-sm transition-all text-neutral-200 placeholder-neutral-500"
            />
          </div>

          {/* Drag and Drop Zone Canvas Box */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-45 ${
              isDragging ? 'border-brand bg-brand-muted' : 'border-white/5 hover:border-white/10 bg-bg-primary/50'
            } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input type="file" accept="video/*" ref={fileInputRef} onChange={(e) => e.target.files && setFile(e.target.files[0])} className="hidden" disabled={uploading} />
            <Film className="w-8 h-8 text-text-secondary mb-2" />
            <p className="text-sm font-bold text-neutral-200">
              {file ? file.name : 'Upload movie file'}
            </p>
            <p className="text-xs text-text-secondary mt-1">Drag & drop or browse locally</p>
          </div>

          {file && !uploading && !uploadComplete && (
            <button
              onClick={handleActualUpload}
              className="w-full py-3.5 bg-brand hover:bg-brand-hover rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-brand/10 active:scale-95"
            >
              <span className="flex items-center justify-center gap-2">
                <UploadCloud className="w-4 h-4" />
                <span>PROCESS AND TRANSCODE TRACK</span>
              </span>
            </button>
          )}

          {/* Progress Bar Loader */}
          {uploading && (
            <div className="mt-4 animate-fade-in">
              <div className="flex justify-between text-xs text-text-secondary mb-2 font-mono">
                <span className="flex items-center gap-1.5">
                  {processingPhase === 'transcoding' ? (
                    <>
                      {uploadSpeed === 'Uploading to CDN...' ? (
                        <>
                          <UploadCloud className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
                          <span>UPLOADING TO CDN...</span>
                        </>
                      ) : (
                        <>
                          <Cpu className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          <span>TRANSCODING VIDEO (STREAM COPY)...</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                      <span>UPLOADING FILE TO LOCAL SERVER...</span>
                    </>
                  )}
                </span>
                <span className="text-indigo-400 font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-bg-primary rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-brand rounded-full transition-all duration-150 shadow-[0_0_12px_rgba(79,70,229,0.3)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-text-secondary mt-2 font-mono">
                <span>Speed: <span className="text-neutral-300 font-semibold">{uploadSpeed || 'Calculating...'}</span></span>
                <span>ETA: <span className="text-indigo-400 font-semibold">{eta || 'Calculating...'}</span></span>
              </div>
            </div>
          )}

          {/* Action block to enter active stream theater */}
          {uploadComplete && (
            <div className="mt-4 animate-fade-in">
              <button
                onClick={() => {
                  const finalUrl = resolvedStreamUrl || `http://${window.location.hostname}:5000/api/video/hls-local/${fileId}.m3u8`;
                  onUploadSuccess(finalUrl);
                }}
                className="w-full py-4 bg-brand hover:bg-brand-hover shadow-[0_0_20px_rgba(79,70,229,0.15)] hover:shadow-[0_0_30px_rgba(79,70,229,0.3)] hover:scale-[1.01] active:scale-95 rounded-2xl text-xs font-black tracking-widest text-white transition-all duration-300 cursor-pointer border border-brand-border flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 text-white" />
                <span>ENTER ACTIVE STREAM THEATER</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Preview Banner Box Card Matrix */}
        <div className="rounded-2xl overflow-hidden border border-white/5 bg-bg-primary/30 relative flex flex-col justify-end min-h-75">
          {metadata ? (
            <>
              <img src={metadata.bannerUrl} alt="Movie Backdrop" className="absolute inset-0 w-full h-full object-cover opacity-40 animate-fade-in" />
              <div className="absolute inset-0 bg-bg-primary" />
              <div className="relative p-6 z-10">
                <h3 className="text-lg font-black mb-2 tracking-tight text-white">{metadata.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                  {metadata.overview}
                </p>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-text-secondary p-6 text-center">
              <Film className="w-10 h-10 mb-3 opacity-30 text-text-secondary" />
              <p className="text-sm font-semibold text-text-secondary">Metadata Display Panel</p>
              <p className="text-xs text-text-secondary max-w-55 mt-1">Live TMDB details will load here as you search.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadDashboard;
