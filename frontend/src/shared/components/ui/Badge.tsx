import React from 'react';
import { cn } from '../../utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'default',
  ...props
}) => {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-mono tracking-wider uppercase transition-colors select-none",
        variant === 'default' && "bg-neutral-800 text-neutral-350 border border-neutral-700",
        variant === 'success' && "bg-emerald-950/50 text-emerald-450 border border-emerald-900",
        variant === 'warning' && "bg-amber-950/50 text-amber-450 border border-amber-900",
        variant === 'error' && "bg-red-950/50 text-red-450 border border-red-900",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
