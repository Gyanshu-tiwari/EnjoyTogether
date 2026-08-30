import React, { useEffect, useState } from 'react';
import { motion, animate } from 'framer-motion';

export const GlobalLoader: React.FC = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Animate progress number from 0 to 100 with an easeOut curve over 2 seconds
    const controls = animate(0, 100, {
      duration: 2,
      ease: [0.25, 1, 0.5, 1], // easeOutQuart-ish curve
      onUpdate: (value) => {
        setProgress(Math.round(value));
      }
    });
    return () => controls.stop();
  }, []);

  return (
    <motion.div 
      className="fixed inset-0 z-[100] flex flex-col justify-between p-6 md:p-12 bg-[#0a0a0a] text-white overflow-hidden origin-top"
      initial={{ y: 0 }}
      exit={{ 
        y: '-100%',
        borderBottomLeftRadius: ['0%', '50%'],
        borderBottomRightRadius: ['0%', '50%'],
        transition: { duration: 0.6, ease: [0.76, 0, 0.24, 1] } 
      }}
    >
      {/* Top Left Text */}
      <div className="flex justify-start">
        <span className="text-sm font-medium tracking-tight">EnjoyTogether®</span>
      </div>

      {/* Center Progress Line */}
      <div className="absolute top-1/2 left-6 right-6 md:left-12 md:right-12 -translate-y-1/2">
        <div className="w-full h-[1px] bg-white/10 relative overflow-hidden">
          <motion.div 
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 2, ease: [0.25, 1, 0.5, 1] }}
            className="h-full bg-white absolute top-0 left-0 origin-left"
          />
        </div>
      </div>

      {/* Bottom Right Counter */}
      <div className="flex justify-end items-end">
        <div className="flex items-baseline text-white">
          <span className="text-8xl md:text-[12rem] font-light tracking-tighter tabular-nums leading-none">
            {progress}
          </span>
          <span className="text-3xl md:text-5xl font-light leading-none mb-2 md:mb-6">%</span>
        </div>
      </div>
    </motion.div>
  );
};
