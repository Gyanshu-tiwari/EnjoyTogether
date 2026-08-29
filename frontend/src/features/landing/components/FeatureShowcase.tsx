import React from 'react';
import { motion } from 'framer-motion';
import { Clock, MessageSquare, ShieldCheck, Video, Mic, Lock } from 'lucide-react';

export const FeatureShowcase: React.FC = () => {
  return (
    <section id="features" className="w-full py-24 md:py-32 px-6 flex flex-col items-center">
      <div className="max-w-[1200px] w-full">
        {/* Header Area */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8"
        >
          <div>
            <span className="text-brand font-bold tracking-widest text-xs uppercase mb-4 block">
              The Ultimate Toolkit
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black font-heading text-white tracking-tight uppercase leading-none">
              Everything you need<br />for movie night.
            </h2>
          </div>
          <p className="text-text-secondary max-w-sm text-sm md:text-base leading-relaxed mb-2">
            Experience the difference with powerful tools and features designed specifically to optimize your remote watch parties.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="flex flex-col gap-6">
          
          {/* Top Row: 2 columns on lg (2/3 and 1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Card 1: Synced Playback (Large) */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-2 relative rounded-3xl overflow-hidden group min-h-[400px] flex flex-col justify-between p-8 md:p-10 bg-bg-card border border-white/5 hover:border-white/10 transition-colors shadow-2xl"
            >
              {/* Graphic Background */}
              <div className="absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity duration-700">
                <img src="/hero.avif" alt="Synced Playback" className="w-full h-full object-cover mix-blend-luminosity" />
                <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-bg-card/80 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-bg-card via-bg-card/50 to-transparent" />
              </div>
              
              <div className="relative z-10 max-w-md mt-auto">
                <div className="w-12 h-12 rounded-2xl bg-brand/20 flex items-center justify-center mb-6 text-brand">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold text-white mb-3 font-heading tracking-tight">Synced Playback</h3>
                <p className="text-text-secondary text-base md:text-lg leading-relaxed">
                  When anyone pauses or seeks, it happens for everyone instantly. Perfect synchronization with no countdowns needed.
                </p>
              </div>

              {/* Decorative Sync UI */}
              <div className="absolute top-8 right-8 flex flex-col gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-500 translate-y-4 group-hover:translate-y-0">
                 <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-lg p-3 flex items-center gap-3 shadow-xl">
                    <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand"><Clock className="w-4 h-4" /></div>
                    <div>
                      <div className="text-xs text-white font-bold">Host paused</div>
                      <div className="text-[10px] text-text-secondary">Syncing all peers...</div>
                    </div>
                 </div>
              </div>
            </motion.div>

            {/* Card 2: Floating Reactions */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="lg:col-span-1 rounded-3xl bg-bg-card border border-white/5 hover:border-white/10 transition-colors p-8 flex flex-col relative overflow-hidden min-h-[400px]"
            >
              <div className="w-12 h-12 rounded-2xl bg-pink-500/20 flex items-center justify-center mb-6 text-pink-500 relative z-10">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 font-heading tracking-tight relative z-10">Floating Reactions</h3>
              <p className="text-text-secondary text-sm md:text-base leading-relaxed relative z-10">
                Spam emojis that float across the screen to react to crazy moments without talking over the movie.
              </p>
              
              {/* Graphic */}
              <div className="mt-auto flex justify-center items-end pt-12 pb-4">
                 <div className="relative w-full h-32">
                    <motion.div animate={{ y: [0, -40, 0], opacity: [0, 1, 0] }} transition={{ duration: 2, repeat: Infinity, delay: 0.2 }} className="absolute bottom-0 left-[20%] text-4xl">😂</motion.div>
                    <motion.div animate={{ y: [0, -60, 0], opacity: [0, 1, 0] }} transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }} className="absolute bottom-4 left-[50%] text-5xl">🔥</motion.div>
                    <motion.div animate={{ y: [0, -30, 0], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: 0.8 }} className="absolute bottom-2 right-[20%] text-3xl">❤️</motion.div>
                 </div>
              </div>
              
              {/* Subtle background glow */}
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-pink-500/10 blur-3xl rounded-full pointer-events-none" />
            </motion.div>
          </div>

          {/* Bottom Row: 2 columns on lg (1/2 and 1/2) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Card 3: Real-time Audio & Video */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="rounded-3xl bg-bg-card border border-white/5 hover:border-white/10 transition-colors p-8 md:p-10 flex flex-col sm:flex-row gap-8 relative overflow-hidden min-h-[300px] items-center"
            >
              <div className="flex-1 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-6 text-emerald-400">
                  <Video className="w-6 h-6" />
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 font-heading tracking-tight">Real-time A/V</h3>
                <p className="text-text-secondary text-sm md:text-base leading-relaxed">
                  Keep your camera on or just use your mic. Talk through the movie naturally like you are sitting on the same couch.
                </p>
              </div>

              {/* Graphic */}
              <div className="w-full sm:w-48 h-48 rounded-2xl bg-black/40 border border-white/5 flex flex-col items-center justify-center relative overflow-hidden flex-shrink-0">
                 {/* Audio Visualizer Faux */}
                 <div className="flex items-center gap-1.5 h-16 opacity-80">
                   {[3,5,8,4,9,6,3].map((h, i) => (
                     <motion.div 
                       key={i} 
                       animate={{ height: [`${h*10}%`, `${(h%3 + 2)*10}%`, `${h*10}%`] }}
                       transition={{ duration: 0.5 + (i * 0.1), repeat: Infinity }}
                       className="w-2 bg-emerald-400 rounded-full" 
                     />
                   ))}
                 </div>
                 <div className="absolute bottom-4 flex gap-2">
                   <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-md"><Mic className="w-4 h-4" /></div>
                   <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-md"><Video className="w-4 h-4" /></div>
                 </div>
              </div>
              
              {/* Subtle background glow */}
              <div className="absolute -left-20 top-0 w-64 h-64 bg-emerald-500/10 blur-3xl rounded-full pointer-events-none" />
            </motion.div>

            {/* Card 4: Secure Rooms */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="rounded-3xl bg-bg-card border border-white/5 hover:border-white/10 transition-colors p-8 md:p-10 flex flex-col sm:flex-row-reverse gap-8 relative overflow-hidden min-h-[300px] items-center"
            >
              <div className="flex-1 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center mb-6 text-indigo-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 font-heading tracking-tight">Secure Rooms</h3>
                <p className="text-text-secondary text-sm md:text-base leading-relaxed">
                  Private rooms with host-approval workflows. Nobody gets in unless you let them in.
                </p>
              </div>

              {/* Graphic */}
              <div className="w-full sm:w-48 h-48 rounded-2xl bg-black/40 border border-white/5 flex flex-col items-center justify-center relative overflow-hidden flex-shrink-0">
                 <div className="relative w-24 h-24 flex items-center justify-center">
                   <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full animate-ping" />
                   <div className="absolute inset-2 border-2 border-indigo-500/40 rounded-full" />
                   <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center text-indigo-400 backdrop-blur-md shadow-lg border border-indigo-500/30">
                     <Lock className="w-5 h-5" />
                   </div>
                 </div>
                 <div className="absolute bottom-4 bg-indigo-500/20 text-indigo-300 text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full border border-indigo-500/20">
                   End-to-end Encrypted
                 </div>
              </div>
              
              {/* Subtle background glow */}
              <div className="absolute -right-20 top-0 w-64 h-64 bg-indigo-500/10 blur-3xl rounded-full pointer-events-none" />
            </motion.div>

          </div>
        </div>
      </div>
    </section>
  );
};
