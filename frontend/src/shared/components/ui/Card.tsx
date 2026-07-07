import React from 'react';
import { cn } from '../../utils/cn';

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export const Card: React.FC<CardProps> = ({ children, className, ...props }) => {
  return (
    <div
      className={cn(
        "relative w-full bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl flex flex-col",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
