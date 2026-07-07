import React from 'react';
import { cn } from '../../utils/cn';

export interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const Spinner: React.FC<SpinnerProps> = ({ className, size = 'md' }) => {
  return (
    <div
      className={cn(
        "border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin",
        size === 'sm' && "w-6 h-6 border-2",
        size === 'md' && "w-10 h-10 border-4",
        size === 'lg' && "w-16 h-16 border-4",
        className
      )}
    />
  );
};
