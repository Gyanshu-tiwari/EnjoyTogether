import React, { useState } from 'react';
import { cn } from '../../utils/cn';

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  fallback: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  fallback,
  alt = 'Avatar',
  size = 'md',
  className,
  ...props
}) => {
  const [error, setError] = useState(false);

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-16 h-16 text-lg",
    xl: "w-24 h-24 text-2xl",
  };

  const showFallback = !src || error;

  return (
    <div
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full border border-neutral-800 bg-neutral-900 justify-center items-center font-bold font-mono text-indigo-400 select-none",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {showFallback ? (
        <span>{fallback.charAt(0).toUpperCase()}</span>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setError(true)}
          className="h-full w-full aspect-square object-cover"
        />
      )}
    </div>
  );
};
