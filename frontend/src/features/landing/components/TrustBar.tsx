import React from 'react';
import { motion } from 'framer-motion';

export const TrustBar: React.FC = () => {
  return (
    <section className="w-full py-12 px-6 flex flex-col items-center justify-center border-y border-white/5 bg-white/1">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.6 }}
        className="flex flex-col items-center gap-6"
      >
        <p className="text-sm font-semibold text-text-secondary tracking-widest uppercase">
          Trusted for movie nights across the globe
        </p>
        
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale">
          {/* Abstract geometric shapes or placeholder logos to represent different user bases */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-neutral-400" />
            <span className="font-bold text-neutral-400 text-lg tracking-tight">Remote Teams</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-neutral-400" />
            <span className="font-bold text-neutral-400 text-lg tracking-tight">Long Distance</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rotate-45 bg-neutral-400" />
            <span className="font-bold text-neutral-400 text-lg tracking-tight">Watch Parties</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-t-full bg-neutral-400" />
            <span className="font-bold text-neutral-400 text-lg tracking-tight">Study Groups</span>
          </div>
        </div>
      </motion.div>
    </section>
  );
};
