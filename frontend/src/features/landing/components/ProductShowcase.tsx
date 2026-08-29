import React from 'react';
import { motion } from 'framer-motion';
import { Hand, Mic, Video, User } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

export const ProductShowcase: React.FC = () => {
  return (
    <section className="w-full py-32 px-6 flex flex-col items-center overflow-hidden">
      <div className="max-w-6xl w-full flex flex-col gap-32">
        
        {/* Showcase 1: Green Room / Lobby */}
        <div className="flex flex-col lg:flex-row items-center gap-16">
          <motion.div 
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full lg:w-1/2 flex flex-col gap-6"
          >
            <span className="text-brand font-bold tracking-widest text-xs uppercase">Pre-Join Lobby</span>
            <h2 className="text-4xl md:text-5xl font-extrabold font-heading text-white tracking-tight">
              Get ready before you enter.
            </h2>
            <p className="text-lg text-text-secondary leading-relaxed">
              Check your camera and microphone settings in the green room before knocking. Make sure you look your best before the party starts.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full lg:w-1/2 relative"
          >
            <div className="absolute inset-0 bg-brand/10 blur-[80px] rounded-full pointer-events-none -z-10" />
            <div className="bg-bg-card border border-white/10 rounded-[2rem] p-4 shadow-2xl aspect-video flex flex-col items-center justify-center relative overflow-hidden group">
              <div className="w-20 h-20 rounded-full bg-bg-primary border border-white/5 flex items-center justify-center text-text-secondary group-hover:scale-110 transition-transform duration-500">
                <User className="w-10 h-10" />
              </div>
              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
                <div className="w-12 h-12 rounded-full bg-bg-primary border border-white/5 flex items-center justify-center text-white shadow-lg">
                  <Mic className="w-5 h-5" />
                </div>
                <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/20 flex items-center justify-center text-red-300 shadow-lg">
                  <Video className="w-5 h-5" />
                  <div className="absolute w-6 h-0.5 bg-red-400 rotate-45" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Showcase 2: Host Controls */}
        <div className="flex flex-col lg:flex-row-reverse items-center gap-16">
          <motion.div 
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full lg:w-1/2 flex flex-col gap-6"
          >
            <span className="text-emerald-400 font-bold tracking-widest text-xs uppercase">Host Controls</span>
            <h2 className="text-4xl md:text-5xl font-extrabold font-heading text-white tracking-tight">
              Total control over your room.
            </h2>
            <p className="text-lg text-text-secondary leading-relaxed">
              When guests arrive, they knock to request entry. As the host, you review every request and can accept or deny them, keeping your watch party private and secure.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full lg:w-1/2 relative flex justify-center"
          >
            <div className="absolute inset-0 bg-emerald-500/10 blur-[80px] rounded-full pointer-events-none -z-10" />
            
            <div className="w-80 bg-bg-card border border-white/10 rounded-[2rem] p-6 shadow-2xl backdrop-blur-md flex flex-col gap-4 relative">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Hand className="w-5 h-5 text-indigo-400 animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white">Join Request</span>
                  <span className="text-xs text-indigo-400 font-mono">@movie_buff</span>
                </div>
              </div>
              <p className="text-xs text-text-secondary">wants to join your party</p>
              <div className="flex gap-2 justify-end mt-2">
                <Button variant="secondary" className="px-4 py-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                  Reject
                </Button>
                <Button variant="brand" className="px-4 py-1.5 text-xs shadow-lg shadow-brand/20">
                  Accept
                </Button>
              </div>
            </div>

            {/* Faded background requests */}
            <div className="absolute -bottom-8 -right-4 w-72 bg-bg-card/40 border border-white/5 rounded-[2rem] p-6 shadow-xl backdrop-blur-sm flex flex-col gap-4 -z-10 scale-95 opacity-50">
               <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center" />
                <div className="flex flex-col gap-2 w-full">
                  <div className="h-4 w-1/2 bg-white/10 rounded" />
                  <div className="h-3 w-1/3 bg-white/5 rounded" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

      </div>
    </section>
  );
};
