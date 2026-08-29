import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

export const FinalCTA: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section className="w-full py-32 px-6 flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="w-full max-w-5xl bg-gradient-to-br from-brand/20 via-bg-card to-indigo-900/20 border border-brand/20 rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden flex flex-col items-center shadow-2xl"
      >
        {/* Decorative background blur */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-brand/30 blur-[120px] rounded-full pointer-events-none -z-10" />

        <h2 className="text-4xl md:text-6xl font-extrabold font-heading text-white tracking-tight mb-6">
          Ready for movie night?
        </h2>
        <p className="text-lg md:text-xl text-indigo-200 max-w-2xl mb-10 leading-relaxed">
          Start your first watch party in seconds. No credit card required.
        </p>
        
        <Button
          onClick={() => navigate('/dashboard')}
          variant="brand"
          className="px-10 py-5 text-lg font-bold shadow-2xl shadow-brand/40 scale-100 hover:scale-105 transition-transform duration-300"
        >
          <span className="flex items-center gap-2">
            <Play className="w-6 h-6" fill="currentColor" />
            Create a Room Now
          </span>
        </Button>
      </motion.div>
    </section>
  );
};
