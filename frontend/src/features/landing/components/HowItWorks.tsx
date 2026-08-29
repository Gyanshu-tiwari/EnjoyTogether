import React from 'react';
import { motion } from 'framer-motion';
import { Link, Users, Popcorn } from 'lucide-react';

const steps = [
  {
    num: "01",
    title: "Create a Room",
    description: "Paste any supported video link (mp4, m3u8) into the dashboard. We'll spin up a private theater room instantly.",
    icon: <Link className="w-6 h-6 text-indigo-400" />
  },
  {
    num: "02",
    title: "Invite Friends",
    description: "Share the unique room link. Your friends can knock to request entry, and you have full control over who joins.",
    icon: <Users className="w-6 h-6 text-indigo-400" />
  },
  {
    num: "03",
    title: "Enjoy Together",
    description: "The video plays in perfect sync for everyone. Use the built-in voice chat and floating emojis to share reactions.",
    icon: <Popcorn className="w-6 h-6 text-indigo-400" />
  }
];

export const HowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="w-full py-32 px-6 flex flex-col items-center relative">
      <div className="max-w-5xl w-full">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="text-brand font-bold tracking-widest text-xs uppercase mb-4 block">Workflow</span>
          <h2 className="text-4xl md:text-5xl font-extrabold font-heading text-white tracking-tight">
            From link to watch party in seconds.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, delay: i * 0.2 }}
              className="flex flex-col items-center text-center relative z-10 group"
            >
              <div className="w-24 h-24 rounded-3xl bg-bg-card border border-white/5 shadow-2xl flex items-center justify-center mb-8 relative group-hover:-translate-y-2 transition-transform duration-300">
                <div className="absolute inset-0 bg-brand/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                {step.icon}
                <div className="absolute -top-3 -right-3 text-xs font-black font-mono text-neutral-600 bg-bg-primary border border-white/5 w-8 h-8 rounded-full flex items-center justify-center shadow-lg">
                  {step.num}
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4 font-heading">{step.title}</h3>
              <p className="text-text-secondary leading-relaxed max-w-xs">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
