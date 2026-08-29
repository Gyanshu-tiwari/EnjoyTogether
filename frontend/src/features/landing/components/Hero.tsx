import React from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Users, Smile } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Plasma } from './Plasma';

export const Hero: React.FC = () => {
  const navigate = useNavigate();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 150]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);

  return (
    <section className="relative isolate w-full min-h-screen flex flex-col items-center pt-32 pb-20 px-6 overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute inset-0 -z-10 w-full h-full flex items-center justify-center pointer-events-none">
        <div style={{ width: '1080px', height: '1080px', position: 'relative' }}>
          <Plasma
            color="#5e53eb"
            speed={1}
            direction="forward"
            scale={1}
            opacity={1}
            mouseInteractive
            iterations={60}
            renderScale={0.55}
            targetFps={60}
            maxDpr={1.5}
          />
        </div>
      </div>

      {/* Hero Content */}
      <div className="flex flex-col items-center text-center max-w-4xl z-10 mb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-md"
        >
          <span className="flex h-2 w-2 rounded-full bg-brand animate-pulse" />
          <span className="text-xs font-semibold text-neutral-300 tracking-wide">
            EnjoyTogether 2.0 is live
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-tight font-heading"
        >
          Watch together, <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-linear-to-r from-brand to-indigo-400">
            feel closer.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
          className="text-lg md:text-xl text-text-secondary max-w-2xl mb-10 leading-relaxed"
        >
          The premium synchronized movie room that brings the theater experience to your browser. Real-time chat, crystal clear video, and perfectly synced playback for you and your friends.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
          className="flex flex-col sm:flex-row gap-4 items-center"
        >
          <Button
            onClick={() => navigate('/dashboard')}
            variant="brand"
            className="px-8 py-4 text-base font-bold shadow-xl shadow-brand/20 w-full sm:w-auto"
          >
            <span className="flex items-center gap-2">
              <Play className="w-5 h-5" fill="currentColor" />
              Start a Watch Party
            </span>
          </Button>
          <Button
            onClick={() => {
              const works = document.getElementById('how-it-works');
              works?.scrollIntoView({ behavior: 'smooth' });
            }}
            variant="secondary"
            className="px-8 py-4 text-base font-semibold w-full sm:w-auto"
          >
            See how it works
          </Button>
        </motion.div>
      </div>

      {/* High-Fidelity Mockup */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
        style={{ y, opacity }}
        className="relative w-full max-w-5xl aspect-video rounded-2xl md:rounded-[2rem] border border-white/10 bg-bg-card shadow-2xl shadow-black/50 overflow-hidden flex flex-col group z-20"
      >
        {/* Mockup Top Bar */}
        <div className="h-12 w-full border-b border-white/5 bg-white/2 flex items-center px-4 justify-between backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className="flex bg-black/40 border border-white/5 px-4 py-1.5 rounded-full text-xs text-neutral-400 font-mono items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            <span>Room: movie-night-42</span>
          </div>
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <span className="text-[10px] text-indigo-300">P1</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center -ml-3">
              <span className="text-[10px] text-emerald-300">P2</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center -ml-3 z-10">
              <span className="text-[10px] text-neutral-300">+3</span>
            </div>
          </div>
        </div>

        {/* Mockup Video Area */}
        <div className="relative flex-1 bg-black/80 flex items-center justify-center overflow-hidden">
          {/* Faux Video Content */}
          <div className="absolute inset-0 bg-linear-to-br from-indigo-900/40 via-purple-900/20 to-black pointer-events-none" />
          
          <div className="w-20 h-20 rounded-full bg-brand/20 border border-brand-border flex items-center justify-center shadow-2xl shadow-brand/20 backdrop-blur-xl group-hover:scale-110 transition-transform duration-500">
            <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
          </div>

          {/* Floating Emojis Simulation */}
          <div className="absolute bottom-4 left-[20%] text-2xl animate-emoji-float opacity-0 delay-100">😂</div>
          <div className="absolute bottom-4 left-[50%] text-3xl animate-emoji-float opacity-0 delay-300" style={{ animationDelay: '1s' }}>🔥</div>
          <div className="absolute bottom-4 left-[75%] text-2xl animate-emoji-float opacity-0 delay-500" style={{ animationDelay: '2.5s' }}>🍿</div>
          <div className="absolute bottom-4 left-[35%] text-2xl animate-emoji-float opacity-0 delay-700" style={{ animationDelay: '1.5s' }}>❤️</div>

          {/* Control Bar Overlay */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-bg-card/80 backdrop-blur-xl border border-white/10 px-6 py-3 rounded-full shadow-2xl">
            <Play className="w-5 h-5 text-white" fill="currentColor" />
            <div className="w-48 sm:w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="w-1/3 h-full bg-brand rounded-full" />
            </div>
            <span className="text-xs text-white font-mono">01:24:10</span>
            <div className="w-px h-5 bg-white/10 mx-2" />
            <Smile className="w-5 h-5 text-neutral-400" />
          </div>
        </div>
      </motion.div>
    </section>
  );
};
