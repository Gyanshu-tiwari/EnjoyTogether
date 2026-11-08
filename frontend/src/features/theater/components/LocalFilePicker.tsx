/**
 * LocalFilePicker.tsx
 * ───────────────────
 * The Host's starting point for a local watch party.
 *
 * Allows the host to:
 * 1. Select a local video file (drag/drop or browse)
 * 2. See extracted metadata (name, size, duration, resolution)
 * 3. Check browser capability (captureStream, WebRTC)
 * 4. Create a room and get an invite link
 *
 * IMPORTANT:
 * - NO upload to backend
 * - NO upload to B2 or any cloud
 * - The file stays on the Host's device
 * - Only metadata (name, size, duration) is displayed/shared
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Copy, Check, Hash } from 'lucide-react';
import { detectCapabilities, getCapabilityErrorMessage } from '@/shared/utils/browserCapabilities';
import { useAuthSession } from '@/features/auth';
import { fetchProfile } from '@/features/profile/api/profileApi';
import { LocalMediaSource } from '../media/LocalMediaSource';
import type { MediaSourceDescriptor } from '../media/types';

interface LocalFilePickerProps {
  onFileReady: (file: File, source: LocalMediaSource, descriptor: MediaSourceDescriptor) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const LocalFilePicker: React.FC<LocalFilePickerProps> = ({ onFileReady }) => {
  const { session, isGuest } = useAuthSession();
  const [userFriendCode, setUserFriendCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [descriptor, setDescriptor] = useState<MediaSourceDescriptor | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaSourceRef = useRef<LocalMediaSource | null>(null);

  // Load authoritative user friend code for display
  useEffect(() => {
    let isMounted = true;
    async function loadUserCode() {
      try {
        if (session?.user?.id) {
          const profile = await fetchProfile();
          if (isMounted && profile?.friendCode) {
            setUserFriendCode(profile.friendCode);
            setLoadingCode(false);
            return;
          }
        }
        // Guest or cached fallback
        if (typeof window !== 'undefined') {
          const anonCode = localStorage.getItem('et_anon_friend_code');
          if (isMounted && anonCode) {
            setUserFriendCode(anonCode);
          }
        }
      } catch (err) {
        console.warn('Could not fetch user friend code:', err);
      } finally {
        if (isMounted) setLoadingCode(false);
      }
    }
    loadUserCode();
    return () => { isMounted = false; };
  }, [session, isGuest]);

  const handleCopyCode = async () => {
    if (!userFriendCode) return;
    await navigator.clipboard.writeText(userFriendCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Check capability once on first interaction
  const capabilityReport = detectCapabilities();
  const capabilityError = getCapabilityErrorMessage(capabilityReport);

  const processFile = useCallback(async (file: File) => {
    // Clean up previous source
    if (mediaSourceRef.current) {
      mediaSourceRef.current.destroy();
      mediaSourceRef.current = null;
    }

    setSelectedFile(file);
    setDescriptor(null);
    setMetaError(null);
    setLoadingMeta(true);

    const source = new LocalMediaSource(file);
    mediaSourceRef.current = source;

    try {
      const desc = await source.loadMetadata();
      setDescriptor(desc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not read video metadata.';
      setMetaError(msg);
      setDescriptor({
        type: 'local',
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || 'video/*',
        sizeBytes: file.size,
        durationSeconds: null,
        width: null,
        height: null,
      });
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleConfirm = () => {
    if (!selectedFile || !descriptor || !mediaSourceRef.current) return;
    onFileReady(selectedFile, mediaSourceRef.current, descriptor);
  };

  return (
    <div className="w-full max-w-4xl bg-neutral-900/60 border border-white/5 rounded-3xl p-8 backdrop-blur-2xl shadow-2xl text-white animate-fade-in">
      {/* Header with Title and User Friend Code */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-white/5">
        <div>
          <h2 className="text-2xl font-black mb-1 bg-linear-to-r from-blue-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent tracking-tight">
            Start a Watch Party
          </h2>
          <p className="text-xs text-neutral-400">
            Select a video from your device. <span className="text-cyan-400 font-semibold">It stays on your computer</span> — nothing is uploaded.
          </p>
        </div>

        {/* User's Friend Code Badge */}
        <div className="flex items-center gap-3 bg-neutral-950/70 border border-white/10 rounded-2xl px-4 py-2.5 shrink-0 shadow-inner">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 font-semibold flex items-center gap-1">
              <Hash className="w-3 h-3 text-cyan-400" />
              Your Friend Code
            </span>
            <span className="font-mono text-base font-black tracking-widest text-white">
              {loadingCode ? (
                <span className="text-neutral-500 animate-pulse text-xs">Loading…</span>
              ) : userFriendCode ? (
                userFriendCode
              ) : (
                <span className="text-neutral-500 text-xs">—</span>
              )}
            </span>
          </div>

          {userFriendCode && (
            <button
              onClick={handleCopyCode}
              title={copiedCode ? 'Copied to clipboard!' : 'Copy your code'}
              className={`p-2 rounded-xl transition-all cursor-pointer border ${
                copiedCode
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-neutral-300 hover:text-white'
              }`}
            >
              {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Browser Capability Warning */}
      {!capabilityReport.canDoLocalStream && (
        <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="text-lg shrink-0">🚫</span>
            <div>
              <p className="font-bold mb-1">Browser Not Supported</p>
              <p>{capabilityError}</p>
              <p className="mt-2 text-red-400/70 font-mono text-[10px]">
                Missing: {capabilityReport.missingCapabilities.join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
        {/* Left: File selection */}
        <div className="flex flex-col gap-5">

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[180px] select-none ${
              isDragging
                ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
                : 'border-white/10 hover:border-white/25 bg-neutral-950/20 hover:bg-neutral-950/40'
            }`}
          >
            <input
              type="file"
              accept="video/*"
              ref={fileInputRef}
              onChange={handleFileInput}
              className="hidden"
            />
            <span className="text-4xl mb-3">{selectedFile ? '🎬' : '📁'}</span>
            <p className="text-sm font-bold text-neutral-200 text-center max-w-[240px] truncate">
              {selectedFile ? selectedFile.name : 'Select a video file'}
            </p>
            <p className="text-xs text-neutral-500 mt-1 text-center">
              {selectedFile
                ? formatBytes(selectedFile.size)
                : 'Drag & drop or click to browse your device'}
            </p>
          </div>

          {/* Metadata loading state */}
          {loadingMeta && (
            <div className="flex items-center gap-3 text-xs text-neutral-400 font-mono animate-pulse">
              <span className="text-cyan-400">⏳</span>
              <span>Reading video metadata...</span>
            </div>
          )}

          {/* Metadata error */}
          {metaError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
              <span className="font-bold">⚠️ Metadata Warning: </span>{metaError}
              <p className="mt-1 text-amber-400/70">The file may still be playable. You can continue.</p>
            </div>
          )}

          {/* Start button */}
          {selectedFile && !loadingMeta && capabilityReport.canDoLocalStream && (
            <button
              onClick={handleConfirm}
              className="w-full py-4 bg-linear-to-r from-blue-500 via-indigo-500 to-cyan-500 hover:opacity-95 hover:scale-[1.01] active:scale-95 rounded-2xl text-sm font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
            >
              <span>🎬</span>
              <span>CREATE WATCH ROOM</span>
            </button>
          )}

          {/* Capability pills */}
          <div className="flex flex-wrap gap-2 mt-1">
            {[
              { label: 'captureStream', ok: capabilityReport.captureStream },
              { label: 'WebRTC', ok: capabilityReport.webrtc },
              { label: 'File API', ok: capabilityReport.fileApi },
            ].map(({ label, ok }) => (
              <span
                key={label}
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}
              >
                {ok ? '✓' : '✗'} {label}
              </span>
            ))}
          </div>

          {/* Local-first info banner */}
          <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-blue-300/70 text-[11px] leading-relaxed flex gap-2 items-start">
            <span className="shrink-0 text-base">🔒</span>
            <span>
              Your video <strong className="text-blue-300">never leaves your device</strong>. It streams directly to viewers via WebRTC — no server storage, no upload.
            </span>
          </div>
        </div>

        {/* Right: Metadata preview card */}
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 flex flex-col justify-center min-h-[300px] p-6">
          {descriptor ? (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🎞️</span>
                <div>
                  <p className="text-sm font-black text-white truncate max-w-[220px]" title={descriptor.name}>
                    {descriptor.name}
                  </p>
                  <p className="text-[10px] text-neutral-400 font-mono">{descriptor.mimeType}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Size', value: formatBytes(descriptor.sizeBytes) },
                  {
                    label: 'Duration',
                    value: descriptor.durationSeconds != null
                      ? formatDuration(descriptor.durationSeconds)
                      : '—',
                  },
                  {
                    label: 'Resolution',
                    value: descriptor.width && descriptor.height
                      ? `${descriptor.width}×${descriptor.height}`
                      : '—',
                  },
                  { label: 'Source', value: 'Local Device' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/5 border border-white/5 rounded-xl p-3">
                    <p className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-xs font-mono font-semibold text-neutral-200">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 bg-cyan-500/5 border border-cyan-500/15 rounded-xl px-3 py-2 text-[11px] text-cyan-300/80">
                <span>📡</span>
                <span>Will stream from host device via WebRTC</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-neutral-600 text-center gap-3">
              <span className="text-4xl opacity-30">🎬</span>
              <p className="text-sm font-semibold text-neutral-500">Video Details</p>
              <p className="text-xs text-neutral-600 max-w-[200px]">
                Select a local video file to see its details here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocalFilePicker;
