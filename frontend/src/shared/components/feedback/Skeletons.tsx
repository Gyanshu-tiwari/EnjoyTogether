import React from 'react';

export const ShimmerBlock: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`animate-shimmer rounded-xl ${className}`} />
  );
};

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-4xl bg-bg-card border border-white/5 rounded-3xl p-8 shadow-2xl animate-fade-in flex flex-col gap-6">
      {/* Title & Subtitle skeleton */}
      <div className="flex flex-col gap-2">
        <ShimmerBlock className="h-8 w-64" />
        <ShimmerBlock className="h-4 w-96" />
      </div>

      {/* Grid container layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        {/* Left Form controls */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <ShimmerBlock className="h-4 w-28" />
            <ShimmerBlock className="h-11 w-full rounded-2xl" />
          </div>
          <ShimmerBlock className="h-45 w-full rounded-2xl" />
          {/* Upload button placeholder */}
          <ShimmerBlock className="h-12 w-full rounded-2xl" />
        </div>

        {/* Right Preview Banner panel */}
        <ShimmerBlock className="h-75 w-full rounded-2xl" />
      </div>
    </div>
  );
};

export const TheaterSkeleton: React.FC = () => {
  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      {/* Main player + sidebar row */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-stretch min-h-0 justify-center">
        {/* Main Video player block */}
        <div className="flex-1 max-w-300 w-full aspect-video">
          <ShimmerBlock className="w-full h-full rounded-2xl" />
        </div>

        {/* Right Sidebar panel */}
        <div className="w-full lg:w-[320px] h-112.5 lg:h-auto">
          <ShimmerBlock className="w-full h-full rounded-2xl" />
        </div>
      </div>

      {/* Bottom control dock bar */}
      <div className="w-full bg-bg-card border border-white/5 rounded-2xl px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Left session details info */}
        <div className="flex flex-col gap-2">
          <ShimmerBlock className="h-4 w-36" />
          <ShimmerBlock className="h-3 w-56" />
        </div>

        {/* Center circle mic/camera control buttons */}
        <div className="flex items-center gap-3">
          <ShimmerBlock className="w-11 h-11 rounded-full" />
          <ShimmerBlock className="w-11 h-11 rounded-full" />
          <ShimmerBlock className="w-11 h-11 rounded-full" />
          <ShimmerBlock className="w-24 h-11 rounded-full" />
          <ShimmerBlock className="w-11 h-11 rounded-full" />
        </div>

        {/* Right Exit / End session button */}
        <ShimmerBlock className="w-20 h-10 rounded-xl" />
      </div>
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-md p-10 rounded-3xl bg-bg-card border border-white/5 shadow-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center gap-6">
      <ShimmerBlock className="w-20 h-20 rounded-2xl" />
      <ShimmerBlock className="h-8 w-48" />
      <div className="flex flex-col gap-2 w-full items-center">
        <ShimmerBlock className="h-4 w-full" />
        <ShimmerBlock className="h-4 w-5/6" />
      </div>
      <ShimmerBlock className="w-full h-12 rounded-xl" />
    </div>
  );
};
