import React from 'react';
import { motion } from 'framer-motion';

export const TrustBar: React.FC = () => {
  // Array of items to duplicate for the marquee effect
  const items = Array.from({ length: 8 }).map((_, i) => (
    <div key={i} className="flex items-center gap-8 md:gap-16 mx-4 md:mx-8 shrink-0">
      <span className="text-lg md:text-2xl font-black text-transparent bg-clip-text bg-linear-to-b from-white/60 to-white/20 uppercase tracking-tighter shrink-0 whitespace-nowrap">
        enjoy together
      </span>
      <span className="text-brand/60 text-lg md:text-2xl shrink-0">✦</span>
    </div>
  ));

  return (
    <section className="w-full py-12 flex flex-col items-center justify-center overflow-hidden relative">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
        className="w-full overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'
        }}
      >
        <div className="flex w-max animate-marquee items-center will-change-transform">
          {items}
          {items} {/* Duplicated for seamless loop */}
        </div>
      </motion.div>
    </section>
  );
};
