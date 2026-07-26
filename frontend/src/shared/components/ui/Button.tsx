import React from 'react';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'emerald' | 'brand';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'primary',
  ...props
}) => {
  return (
    <button
      className={cn(
        "px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer active:scale-95 duration-200 flex items-center justify-center gap-2",
        variant === 'primary' && "bg-brand hover:bg-brand-hover text-white shadow-lg shadow-brand/10",
        variant === 'secondary' && "bg-white/5 hover:bg-white/10 border border-white/5 text-neutral-300",
        variant === 'ghost' && "bg-transparent hover:bg-white/5 text-neutral-400 hover:text-neutral-200",
        variant === 'emerald' && "bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400",
        variant === 'brand' && "bg-brand-muted hover:bg-brand/20 border border-brand-border text-indigo-400",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
