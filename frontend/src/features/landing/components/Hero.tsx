import React from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
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
      <div className="absolute inset-0 -z-10 w-full h-full pointer-events-none">
        <div className="w-full h-full">
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
          className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-md"
        >
          <span className="flex px-2 py-0 text-xs rounded-xl bg-brand ">New</span>
          <span className="text-xs font-semibold text-neutral-300 tracking-tight">
            EnjoyTogether 2.0 is live
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="text-5xl md:text-7xl font-semibold tracking-tight text-white mb-6 leading-tight font-heading"
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
          className="text-lg md:text-md text-text-secondary max-w-2xl mb-10 leading-relaxed"
        >
          The premium movie room with Real-time chat, crystal clear video, and perfectly synced playback for you and your friends.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
          className="flex flex-col bg-brand overflow-hidden backdrop-blur-md rounded-full sm:flex-row gap-4 justify-between items-center"
        >
          <Button
            onClick={() => navigate('/dashboard')}
            variant="brand"
            className="py-2 px-2 pr-6 font-bold shadow-xl rounded-full shadow-brand/20 w-full sm:w-auto"
          >
            <span className="flex text-sm items-center text-white gap-3">
              <span className='h-10 w-10 flex items-center justify-center rounded-full text-brand bg-white'><Play className="w-5 h-5 ml-1" fill="currentColor" /></span>
              Start a Watch Party
            </span>
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
        <img 
          src="/hero.avif" 
          alt="App Mockup" 
          fetchPriority="high"
          loading="eager"
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700 ease-out"
        />
      </motion.div>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 w-full h-40 bg-linear-to-t from-bg-primary to-transparent pointer-events-none z-30" />
    </section>
  );
};
