import React from 'react';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'emerald' | 'cyan';
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
        variant === 'primary' && "bg-linear-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white shadow-lg shadow-black/20",
        variant === 'secondary' && "bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300",
        variant === 'ghost' && "bg-transparent hover:bg-white/5 text-neutral-400 hover:text-neutral-200",
        variant === 'emerald' && "bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400",
        variant === 'cyan' && "bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
