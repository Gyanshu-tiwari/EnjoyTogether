import React from 'react';
import { motion } from 'framer-motion';

export const TrustBar: React.FC = () => {
  // Array of items to duplicate for the marquee effect
  const items = Array.from({ length: 8 }).map((_, i) => (
    <div key={i} className="flex items-center gap-8 md:gap-16 mx-4 md:mx-8">
      <span className="text-4xl md:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-linear-to-b from-white/30 to-white/5 uppercase tracking-tighter shrink-0">
        enjoy together
      </span>
      <span className="text-brand/40 text-2xl md:text-4xl shrink-0">✦</span>
    </div>
  ));

  return (
    <section className="w-full py-16 md:py-24 flex flex-col items-center justify-center border-y border-white/5 bg-black overflow-hidden relative">
      <div className="absolute inset-y-0 left-0 w-32 bg-linear-to-r from-black to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 bg-linear-to-l from-black to-transparent z-10 pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8 }}
        className="w-full flex"
      >
        <div className="flex w-max animate-marquee items-center will-change-transform">
          {items}
          {items} {/* Duplicated for seamless loop */}
        </div>
      </motion.div>
    </section>
  );
};
