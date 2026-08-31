import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  startUpload,
  uploadChunk,
  getTranscodeStatus,
} from '../api/theaterApi';
import { AlertTriangle, Film, UploadCloud, Play, CheckCircle2, Lock, Link as LinkIcon, Trash2, Users, Video, X } from 'lucide-react';
import { FriendsTab } from '@/features/friends/components/FriendsTab';

interface UploadDashboardProps {
  onUploadSuccess: (streamUrl: string) => void;
}

export const UploadDashboard: React.FC<UploadDashboardProps> = ({ onUploadSuccess }) => {
  const location = useLocation();
  const isFriendsTab = location.search.includes('tab=friends');
  
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [, setProcessingPhase] = useState<'idle' | 'uploading' | 'transcoding' | 'complete'>('idle');
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState('');
  const [fileId, setFileId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [, setUploadSpeed] = useState<string>('');
  const [eta, setEta] = useState<string>('');
  const startTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

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
      const CHUNK_SIZE = 25 * 1024 * 1024;
      const PARALLEL_UPLOADS = 3;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const newFileId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      setFileId(newFileId);

      try {
        await startUpload(newFileId);
      } catch (err) {
        console.warn("Failed to update global status to uploading, continuing...", err);
      }

      let lastResponseData: { success?: boolean; fileId?: string; streamUrl?: string } | null = null;
      const chunkLoadedMap = new Map<number, number>();
      
      const getChunkProgress = () => {
        let loaded = 0;
        chunkLoadedMap.forEach(v => loaded += v);
        return loaded;
      };

      const uploadSingleChunk = async (chunkIndex: number): Promise<void> => {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        chunkLoadedMap.set(chunkIndex, 0);

        let attempt = 0;
        const MAX_RETRIES = 3;
        while (attempt < MAX_RETRIES) {
          try {
            const result = await uploadChunk({
              chunk: chunkBlob,
              fileName: file.name,
              fileId: newFileId,
              chunkIndex,
              totalChunks,
              onProgress: (progressEvent: import('axios').AxiosProgressEvent) => {
                chunkLoadedMap.set(chunkIndex, progressEvent.loaded);
                const currentTotalLoaded = getChunkProgress();
                const percentCompleted = Math.round((currentTotalLoaded * 100) / file.size);
                setProgress(percentCompleted);

                const elapsedMs = Date.now() - startTimeRef.current;
                if (elapsedMs > 1000) {
                  const elapsedSec = elapsedMs / 1000;
                  const bytesPerSec = currentTotalLoaded / elapsedSec;
                  const remainingBytes = file.size - currentTotalLoaded;
                  const remainingSec = bytesPerSec > 0 ? remainingBytes / bytesPerSec : 0;
                  setUploadSpeed(`${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`);
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
            lastResponseData = result;
            chunkLoadedMap.set(chunkIndex, chunkBlob.size);
            return;
          } catch (chunkErr) {
            attempt++;
            if (attempt >= MAX_RETRIES) {
              throw new Error(`Upload failed after ${MAX_RETRIES} retries on chunk ${chunkIndex + 1}.`, { cause: chunkErr });
            }
            await new Promise(r => setTimeout(r, attempt * 2000));
          }
        }
      };

      for (let i = 0; i < totalChunks; i += PARALLEL_UPLOADS) {
        const batch = [];
        for (let j = i; j < Math.min(i + PARALLEL_UPLOADS, totalChunks); j++) {
          batch.push(uploadSingleChunk(j));
        }
        await Promise.all(batch);
      }

      const response = lastResponseData as { success?: boolean; fileId?: string; streamUrl?: string } | null;
      if (response?.success) {
        let streamUrl = response?.streamUrl || '';
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
          try {
            const statusRes = await getTranscodeStatus(newFileId);
            const { status: tStatus, progress: tProgress, eta: tEta, speed: tSpeed, streamUrl: cdnUrl } = statusRes as import('../api/theaterApi').TranscodeStatus & { streamUrl?: string };
            consecutiveErrors = 0;

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
              if (cdnUrl) setResolvedStreamUrl(cdnUrl);
              setProcessingPhase('complete');
              setUploading(false);
              setUploadComplete(true);
              isUploadingRef.current = false;
            } else if (tStatus === 'failed') {
              clearInterval(pollIntervalRef.current!);
              pollIntervalRef.current = null;
              setError('Transcoding pipeline failed on backend. Check logs.');
              setUploading(false);
              setProcessingPhase('idle');
              isUploadingRef.current = false;
            }
          } catch (err) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              clearInterval(pollIntervalRef.current!);
              pollIntervalRef.current = null;
              setError(err instanceof Error ? err.message : 'Lost connection to backend.');
              setUploading(false);
              setProcessingPhase('idle');
              isUploadingRef.current = false;
            }
          }
        }, 1500);

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

  useEffect(() => {
    if (file && !uploading && !uploadComplete && !isUploadingRef.current) {
      handleActualUpload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (isFriendsTab) {
    return <FriendsTab />;
  }

  return (
    <div className="w-full max-w-6xl animate-fade-in grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start mx-auto mt-4">
      {/* Left Column: Upload Area */}
      <div className="bg-[#111214] border border-white/5 rounded-[24px] p-8 shadow-2xl flex flex-col min-h-150">
        <h2 className="text-2xl font-bold mb-1 text-white tracking-tight">Upload a video</h2>
        <p className="text-sm text-neutral-400 mb-8 flex items-center gap-2">
          Start a watch party by uploading your video <span className="text-blue-400 text-lg leading-none mt-[-2px]">✨</span>
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-450 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-neutral-400 hover:text-white transition-all cursor-pointer font-bold px-2 py-1">
              Dismiss
            </button>
          </div>
        )}

        {/* File upload block based on state */}
        {!uploading && !uploadComplete && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border border-dashed rounded-[20px] p-10 flex flex-col items-center justify-center transition-all min-h-[280px] ${
              isDragging ? 'border-brand bg-brand/5' : 'border-neutral-800 bg-neutral-900/50'
            }`}
          >
            <input type="file" accept="video/*" ref={fileInputRef} onChange={(e) => {
              if (e.target.files) {
                setFile(e.target.files[0]);
              }
            }} className="hidden" />
            <UploadCloud className="w-12 h-12 text-brand mb-4" strokeWidth={1.5} />
            <h3 className="text-base font-semibold text-white mb-2">Drag & drop your video here</h3>
            <p className="text-sm text-neutral-500 mb-6">or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-2.5 bg-brand hover:bg-brand-hover rounded-lg text-sm font-semibold transition-all cursor-pointer text-white flex items-center gap-2 mb-8"
            >
              <Film className="w-4 h-4" />
              Browse files
            </button>
            
            <div className="flex flex-col items-center gap-1.5 mt-auto">
               <p className="text-[11px] text-neutral-500 font-medium">Supports: MP4, WebM, MOV, MKV</p>
               <p className="text-[11px] text-neutral-500 font-medium">Max file size: <span className="text-brand">10 GB</span></p>
            </div>
          </div>
        )}

        {uploading && (
          <div className="flex flex-col gap-4">
            {/* Active Upload Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-[16px] p-5 flex flex-col gap-3">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-brand/20 flex items-center justify-center shrink-0">
                    <Video className="w-6 h-6 text-brand" fill="currentColor" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold text-white truncate">{file?.name}</span>
                    <span className="text-xs text-neutral-400 mt-1">{progress}% of {file ? (file.size / (1024 * 1024)).toFixed(0) + ' MB' : 'Total'}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-end">
                       <span className="text-sm font-bold text-white">{progress}%</span>
                       <span className="text-xs text-brand font-medium">{eta || 'Calculating...'} left</span>
                    </div>
                    <button className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white transition-colors ml-2 cursor-pointer">
                       <X className="w-4 h-4" />
                    </button>
                  </div>
               </div>
               {/* Progress bar */}
               <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden mt-1">
                 <div className="h-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} />
               </div>
            </div>
            
            {/* Disabled drag and drop */}
              <div className="border-2 border-dashed border-white/10 rounded-[20px] bg-white/[0.02] flex flex-col items-center justify-center min-h-[280px] relative">
               <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center mb-4">
                  <Lock className="w-5 h-5 text-brand" />
               </div>
               <h3 className="text-sm font-semibold text-white mb-2">Upload in progress...</h3>
               <p className="text-xs text-neutral-400 mb-1">Please wait until the current upload is complete.</p>
               <p className="text-xs text-neutral-400">You can only upload one video at a time.</p>
            </div>
          </div>
        )}

        {uploadComplete && (
          <div className="flex flex-col gap-4">
             {/* Completed Upload Card */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-[16px] p-5 flex items-center gap-4">
               <div className="w-12 h-12 rounded-xl bg-brand/20 flex items-center justify-center shrink-0">
                 <Video className="w-6 h-6 text-brand" fill="currentColor" />
               </div>
               <div className="flex flex-col flex-1 min-w-0">
                 <span className="text-sm font-semibold text-white truncate">{file?.name}</span>
                 <span className="text-xs text-neutral-400 mt-1">{file ? (file.size / (1024 * 1024)).toFixed(0) + ' MB' : 'Format'} - MP4</span>
               </div>
               <div className="flex items-center gap-4 shrink-0">
                 <div className="flex flex-col items-end">
                    <span className="text-sm font-medium text-green-500 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Upload complete!</span>
                    <span className="text-[11px] text-neutral-400 mt-0.5">Ready to start your watch party</span>
                 </div>
                 <button onClick={() => { setUploadComplete(false); setFile(null); }} className="w-8 h-8 rounded-lg border border-neutral-700 flex items-center justify-center text-neutral-400 hover:text-red-400 transition-colors ml-2 cursor-pointer bg-neutral-900">
                    <Trash2 className="w-4 h-4" />
                 </button>
               </div>
            </div>
            
            <button
                onClick={() => {
                  const finalUrl = resolvedStreamUrl || `http://${window.location.hostname}:5000/api/video/hls-local/${fileId}.m3u8`;
                  onUploadSuccess(finalUrl);
                }}
                className="w-full py-4 mt-2 bg-brand hover:bg-brand-hover rounded-xl text-sm font-semibold text-white transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand/20"
              >
                <Play className="w-4 h-4" fill="currentColor" />
                Start the watch party
            </button>

            <div className="flex items-center gap-4 my-2">
               <div className="flex-1 h-px bg-white/5"></div>
               <span className="text-xs text-neutral-500 font-medium px-2 bg-[#111214] rounded-full border border-white/5">or</span>
               <div className="flex-1 h-px bg-white/5"></div>
            </div>

            {/* Small drag and drop */}
            <div 
              className="relative border border-dashed border-neutral-800 rounded-[20px] p-6 flex flex-col items-center justify-center min-h-[140px] bg-neutral-900/50 cursor-pointer hover:border-white/10 hover:bg-neutral-900 transition-all"
              onClick={() => fileInputRef.current?.click()}
            >
               <UploadCloud className="w-8 h-8 text-brand mb-3" />
               <h3 className="text-sm font-semibold text-white mb-1">Upload other video</h3>
               <p className="text-xs text-neutral-400 mb-3 flex items-center gap-1.5">Drag & drop your video here or <span className="text-brand border border-brand/30 px-3 py-1 rounded-md bg-brand/5">Choose files</span></p>
               <p className="text-[10px] text-neutral-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Uploading a new video will replace the current one.</p>
            </div>
          </div>
        )}

        {/* Paste URL block (shown in all states) */}
        {!uploadComplete && (
          <div className="flex items-center gap-4 my-6">
             <div className="flex-1 h-px bg-white/5"></div>
             <span className="text-xs text-neutral-500 font-medium px-2 bg-[#111214] rounded-full border border-white/5">or</span>
             <div className="flex-1 h-px bg-white/5"></div>
          </div>
        )}
        
        <div className={`bg-neutral-900/50 border border-neutral-800 rounded-[16px] p-5 ${uploadComplete ? 'mt-6' : ''}`}>
           <h3 className="text-sm font-semibold text-white mb-1">Paste video URL</h3>
           <p className="text-[11px] text-neutral-400 mb-4">We support YouTube, Vimeo and other direct video links.</p>
           <div className="flex gap-2">
             <div className="relative flex-1">
               <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
               <input type="text" placeholder="https://youtube.com/watch?v=example" className="w-full pl-10 pr-4 h-10 bg-[#0a0a0a] border border-neutral-800 rounded-lg text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-brand/50 transition-all" />
             </div>
             <button className="px-5 h-10 bg-transparent border border-brand text-brand hover:bg-brand/10 rounded-lg text-sm font-semibold transition-all cursor-pointer">
                Add
             </button>
           </div>
        </div>
      </div>

      {/* Right Column: Friends Panel */}
        <div className="bg-[#111214] border border-white/5 rounded-[24px] p-6 shadow-2xl flex flex-col min-h-[400px] sticky top-24">
         <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-brand" />
              friends
            </h3>
            <span className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-300">1</span>
         </div>

         {/* Friend items list */}
         <div className="flex flex-col gap-2">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-800 transition-colors">
              <div className="relative shrink-0">
                 <div className="border border-white/10 rounded-[20px] bg-white/[0.02] flex flex-col items-center justify-center min-h-[40px] w-10 overflow-hidden">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=sam`} alt="sam" className="w-full h-full object-cover" />
                 </div>
                 <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-neutral-900 rounded-full"></div>
              </div>
              <div className="flex flex-col min-w-0">
                 <span className="text-sm font-bold text-white truncate">sam</span>
                 <span className="text-[11px] text-green-500 font-medium">Online</span>
              </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default UploadDashboard;
