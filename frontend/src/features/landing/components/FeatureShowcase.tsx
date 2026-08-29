import React from 'react';
import { motion } from 'framer-motion';
import { Clock, MessageSquare, ShieldCheck, Video } from 'lucide-react';

const features = [
  {
    title: 'Synced Playback',
    description: 'When anyone pauses or seeks, it happens for everyone instantly. Perfect synchronization with no countdowns needed.',
    icon: <Clock className="w-6 h-6 text-brand" />
  },
  {
    title: 'Real-time Audio & Video',
    description: 'Keep your camera on or just use your mic. Talk through the movie naturally like you are sitting on the same couch.',
    icon: <Video className="w-6 h-6 text-brand" />
  },
  {
    title: 'Floating Reactions',
    description: 'Spam emojis that float across the screen to react to crazy moments without talking over the movie.',
    icon: <MessageSquare className="w-6 h-6 text-brand" />
  },
  {
    title: 'Secure Rooms',
    description: 'Private rooms with host-approval workflows. Nobody gets in unless you let them in.',
    icon: <ShieldCheck className="w-6 h-6 text-brand" />
  }
];

export const FeatureShowcase: React.FC = () => {
  return (
    <section id="features" className="w-full py-32 px-6 flex flex-col items-center">
      <div className="max-w-6xl w-full">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-brand font-bold tracking-widest text-xs uppercase mb-4 block">The Ultimate Toolkit</span>
          <h2 className="text-4xl md:text-5xl font-extrabold font-heading text-white tracking-tight">
            Everything you need for movie night.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group p-8 rounded-[2rem] bg-bg-card border border-white/5 hover:border-white/10 transition-colors shadow-xl"
            >
              <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold text-white mb-3 font-heading">{feature.title}</h3>
              <p className="text-text-secondary leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
