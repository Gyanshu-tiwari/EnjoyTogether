import React from 'react';
import { motion } from 'framer-motion';
import { Hand, Mic, VideoOff, User } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

export const ProductShowcase: React.FC = () => {
  return (
    <section id="why-enjoytogether" className="w-full py-24 md:py-32 px-6 flex flex-col items-center bg-[#0a0a0a]">
      <div className="max-w-[1000px] w-full flex flex-col gap-32">
        
        {/* Section Header */}
        <div className="flex flex-col items-center text-center">
          <span className="text-[#C0C0C0] font-semibold tracking-widest text-sm uppercase mb-8 block">
           // Why EnjoyTogether
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-normal font-heading text-white tracking-tight">
            Built for a perfect viewing <br />experience.
          </h2>
        </div>

        {/* Showcase 1: Green Room / Lobby */}
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-24">
          <motion.div 
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full md:w-1/2 flex flex-col gap-4"
          >
            <span className="text-[#5c6bc0] font-bold tracking-[0.2em] text-xs uppercase">Pre-Join Lobby</span>
            <h2 className="text-3xl md:text-4xl font-normal text-white tracking-tight">
              Get ready before you enter.
            </h2>
            <p className="text-[#888] text-base leading-relaxed mt-2">
              Check your camera and microphone settings in the green room before knocking. Make sure you look your best before the party starts.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full md:w-1/2 relative"
          >
            <div className="bg-[#161618] border border-white/5 rounded-3xl p-8 aspect-[3/2] flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
              <div className="w-20 h-20 rounded-full bg-black flex items-center justify-center text-[#555] mb-8">
                <User className="w-10 h-10" />
              </div>
              <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-6">
                <div className="w-12 h-12 rounded-full bg-black hover:bg-[#222] transition-colors flex items-center justify-center text-white cursor-pointer shadow-lg">
                  <Mic className="w-5 h-5" />
                </div>
                <div className="w-12 h-12 rounded-full bg-[#4a1c1c] hover:bg-[#5a2020] transition-colors flex items-center justify-center text-[#ff8a8a] cursor-pointer shadow-lg">
                  <VideoOff className="w-5 h-5" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Showcase 2: Host Controls */}
        <div className="flex flex-col md:flex-row-reverse items-center gap-12 md:gap-24">
          <motion.div 
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full md:w-1/2 flex flex-col gap-4"
          >
            <span className="text-[#5c6bc0] font-bold tracking-[0.2em] text-xs uppercase">Host Controls</span>
            <h2 className="text-3xl md:text-4xl font-normal text-white tracking-tight">
              Total control over your room.
            </h2>
            <p className="text-[#888] text-base leading-relaxed mt-2">
              When guests arrive, they knock to request entry. As the host, you review every request and can accept or deny them, keeping your watch party private and secure.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="w-full md:w-1/2 relative flex justify-center lg:justify-start"
          >
            
            <div className="w-[340px] bg-[#1a1a1c] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 relative z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#202030] flex items-center justify-center text-[#7c8fff]">
                  <Hand className="w-6 h-6" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-white">Join Request</span>
                  <span className="text-sm text-[#7c8fff] font-mono">@movie_buff</span>
                </div>
              </div>
              <p className="text-sm text-[#888]">wants to join your party</p>
              <div className="flex gap-3 justify-end mt-2">
                <Button variant="secondary" className="px-5 py-2 text-sm font-semibold bg-[#222] text-[#ff8a8a] border-none hover:bg-[#2a2a2a] rounded-xl">
                  Reject
                </Button>
                <Button variant="brand" className="px-5 py-2 text-sm font-semibold bg-[#2c377a] text-white border-none hover:bg-[#344299] rounded-xl shadow-none">
                  Accept
                </Button>
              </div>
            </div>

          </motion.div>
        </div>

      </div>
    </section>
  );
};
