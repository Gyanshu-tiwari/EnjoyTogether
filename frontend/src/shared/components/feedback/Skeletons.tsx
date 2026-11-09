import React from 'react';

export const ShimmerBlock: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`animate-shimmer rounded-xl ${className}`} />
  );
};

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-4xl bg-neutral-900/60 border border-white/5 rounded-3xl p-8 backdrop-blur-2xl shadow-2xl animate-fade-in flex flex-col">
      {/* Header with Title and Friend Code badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-white/5">
        <div className="flex flex-col gap-2">
          <ShimmerBlock className="h-7 w-56 rounded-xl" />
          <ShimmerBlock className="h-3.5 w-80 rounded-lg" />
        </div>
        <ShimmerBlock className="h-12 w-44 rounded-2xl shrink-0" />
      </div>

      {/* Grid container layout matching LocalFilePicker */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
        {/* Left: File dropzone & capabilities */}
        <div className="flex flex-col gap-5">
          {/* Dropzone */}
          <div className="border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[180px] gap-3 bg-neutral-950/20">
            <ShimmerBlock className="w-10 h-10 rounded-xl" />
            <ShimmerBlock className="h-4 w-40 rounded-lg" />
            <ShimmerBlock className="h-3 w-56 rounded-md" />
          </div>

          {/* Capability pills */}
          <div className="flex flex-wrap gap-2 mt-1">
            <ShimmerBlock className="h-5 w-24 rounded-full" />
            <ShimmerBlock className="h-5 w-20 rounded-full" />
            <ShimmerBlock className="h-5 w-20 rounded-full" />
          </div>

          {/* Local-first info banner */}
          <ShimmerBlock className="h-14 w-full rounded-xl" />
        </div>

        {/* Right: Metadata preview card */}
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 min-h-[300px] p-6 flex flex-col justify-center gap-5">
          <div className="flex items-center gap-3">
            <ShimmerBlock className="w-10 h-10 rounded-xl shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1">
              <ShimmerBlock className="h-4 w-44 rounded-lg" />
              <ShimmerBlock className="h-3 w-28 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <ShimmerBlock className="h-16 w-full rounded-xl" />
            <ShimmerBlock className="h-16 w-full rounded-xl" />
            <ShimmerBlock className="h-16 w-full rounded-xl" />
            <ShimmerBlock className="h-16 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
};

export const TheaterSkeleton: React.FC = () => {
  return (
    <div className="w-full h-screen max-h-screen bg-[#0a0a0a] flex flex-col p-3 md:p-4 overflow-hidden relative font-sans animate-fade-in text-white z-50">
      {/* Top Bar Header */}
      <header className="w-full flex items-center justify-between mb-3 px-2 shrink-0 h-10">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <ShimmerBlock className="h-4 w-36 rounded-md" />
            <ShimmerBlock className="h-2.5 w-24 rounded-sm" />
          </div>
        </div>
        <ShimmerBlock className="h-4 w-16 rounded-md absolute left-1/2 -translate-x-1/2" />
        <ShimmerBlock className="h-9 w-24 rounded-full" />
      </header>

      {/* Main Body Area: Video + Sidebar */}
      <div className="flex-1 flex gap-4 min-h-0 min-w-0 relative w-full overflow-hidden pb-20">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:flex-row gap-4">
          {/* Synced Video Player Box */}
          <div className="flex-1 min-h-0 min-w-0 bg-black rounded-2xl overflow-hidden shadow-2xl relative flex items-center justify-center border border-white/5">
            <ShimmerBlock className="w-full h-full rounded-2xl" />
          </div>
        </div>
      </div>

      {/* Bottom Floating Control Dock */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-neutral-900/90 border border-white/10 rounded-full px-5 py-2.5 shadow-2xl backdrop-blur-xl z-50">
        <ShimmerBlock className="w-10 h-10 rounded-full" />
        <ShimmerBlock className="w-10 h-10 rounded-full" />
        <ShimmerBlock className="w-10 h-10 rounded-full" />
        <div className="w-px h-6 bg-white/10" />
        <ShimmerBlock className="w-10 h-10 rounded-full" />
        <ShimmerBlock className="w-10 h-10 rounded-full" />
      </div>
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-md p-10 rounded-3xl bg-neutral-900/60 border border-white/5 shadow-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center gap-6">
      <ShimmerBlock className="w-20 h-20 rounded-2xl" />
      <ShimmerBlock className="h-8 w-48 rounded-xl" />
      <div className="flex flex-col gap-2 w-full items-center">
        <ShimmerBlock className="h-4 w-full rounded-lg" />
        <ShimmerBlock className="h-4 w-5/6 rounded-lg" />
      </div>
      <ShimmerBlock className="w-full h-12 rounded-xl" />
    </div>
  );
};

export const LobbySkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto py-6 sm:py-10 px-4 flex flex-col lg:flex-row gap-8 lg:gap-10 items-stretch justify-center animate-fade-in">
      {/* Left side: Simulated Local Video Preview Card */}
      <div className="w-full lg:w-7/12 bg-neutral-900/80 border border-white/10 rounded-3xl aspect-video relative flex flex-col items-center justify-center shadow-2xl shrink-0">
        {/* User profile avatar shape placeholder */}
        <div className="w-20 h-20 rounded-full bg-neutral-800/80 border border-white/10 flex items-center justify-center shadow-inner animate-pulse" />

        {/* Bottom controls buttons */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
          <ShimmerBlock className="w-12 h-12 rounded-full" />
          <ShimmerBlock className="w-12 h-12 rounded-full" />
        </div>
      </div>

      {/* Right side: Action card */}
      <div className="w-full lg:w-5/12 bg-neutral-900/60 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl flex flex-col justify-center text-left gap-6">
        <ShimmerBlock className="h-8 w-56 rounded-xl" />
        <div className="flex flex-col gap-2.5">
          <ShimmerBlock className="h-4 w-full rounded-lg" />
          <ShimmerBlock className="h-4 w-11/12 rounded-lg" />
          <ShimmerBlock className="h-4 w-5/6 rounded-lg" />
        </div>
        <div className="pt-2 flex flex-col gap-3">
          <ShimmerBlock className="h-12 w-full rounded-2xl" />
          <ShimmerBlock className="h-10 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
};
