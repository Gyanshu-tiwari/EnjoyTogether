import React from 'react';
import { motion } from 'framer-motion';

const steps = [
  {
    num: "01",
    title: "Create a Room",
    description: "Paste any supported video link (mp4, m3u8) into the dashboard. We'll spin up a private theater room instantly."
  },
  {
    num: "02",
    title: "Invite Friends",
    description: "Share the unique room link. Your friends can knock to request entry, and you have full control over who joins."
  },
  {
    num: "03",
    title: "Enjoy Together",
    description: "The video plays in perfect sync for everyone. Use the built-in voice chat and floating emojis to share reactions."
  }
];

export const HowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="w-full py-24 md:py-32 px-6 flex flex-col items-center relative overflow-hidden">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
        
        {/* Left Column: Content */}
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="flex flex-col"
        >
          <span className="text-[#C0C0C0] font-semibold tracking-widest text-sm uppercase mb-8 block">
            // How It Works
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-normal font-heading text-white tracking-tight mb-12 lg:mb-16">
            From link to watch party in seconds.
          </h2>

          <div className="flex flex-col gap-10">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="flex gap-6 md:gap-8 group"
              >
                <div className="shrink-0 mt-1 w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center font-semibold text-text-secondary group-hover:text-white group-hover:border-brand/50 transition-colors">
                  {step.num}
                </div>
                <div>
                  <h3 className="text-lg md:text-xl font-semibold text-white mb-3 font-heading">{step.title}</h3>
                  <p className="text-text-secondary leading-normal text-md md:text-lg">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right Column: Visual Mockup */}
        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="w-full lg:h-150 bg-[#121214] border border-white/5 rounded-[2.5rem] p-4 md:p-8 flex flex-col items-center justify-center relative shadow-2xl"
        >
          {/* Faux UI Window */}
          <div className="w-full h-full bg-[#1A1A1D] border border-white/10 rounded-2xl overflow-hidden flex flex-col relative shadow-inner">
            {/* Window Header */}
            <div className="h-12 border-b border-white/5 flex items-center px-4 gap-2 bg-black/20">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <div className="mx-auto text-xs text-text-muted font-medium px-4 py-1 rounded bg-black/40">
                enjoytogether.app/room/xyz
              </div>
            </div>
            
            {/* Video Area */}
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
              <img src="/hero.avif" alt="Watch Party" className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity" />
              
              {/* Fake Play Button */}
              <div className="w-16 h-16 rounded-full bg-brand/90 flex items-center justify-center backdrop-blur-md shadow-lg shadow-brand/20 z-10 hover:scale-105 transition-transform cursor-pointer">
                <div className="w-0 h-0 border-t-8 border-t-transparent border-l-14 border-l-white border-b-8 border-b-transparent ml-1" />
              </div>

              {/* Floating Emojis (Decoration) */}
              <motion.div 
                animate={{ y: [0, -20, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute right-12 bottom-20 text-3xl"
              >😂</motion.div>
              <motion.div 
                animate={{ y: [0, -30, 0], opacity: [0.3, 0.8, 0.3] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute right-24 bottom-12 text-2xl"
              >🔥</motion.div>
            </div>

            {/* Video Controls / Chat Bar Placeholder */}
            <div className="h-16 bg-[#1A1A1D] border-t border-white/5 flex items-center px-6 gap-4">
               <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
               </div>
               <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                 <div className="w-1/3 h-full bg-brand rounded-full" />
               </div>
               <div className="text-xs text-text-secondary font-mono">01:24 / 04:20</div>
            </div>
          </div>

          {/* Bottom subtle text */}
          <div className="mt-8 flex items-center gap-4 text-sm font-semibold text-text-secondary">
            <span>Available on Web, Windows & Mac</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
