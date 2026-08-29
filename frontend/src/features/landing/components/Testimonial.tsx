import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const testimonials = [
  {
    id: 1,
    quote: "Before EnjoyTogether, we juggled discord, screen sharing, and counting down '3, 2, 1'. Now it's all in one place. We watched 3 seasons faster this month than ever before.",
    author: "Sofia Delgado",
    role: "Product Manager, NovaTech",
    avatar: "https://i.pravatar.cc/150?img=5"
  },
  {
    id: 2,
    quote: "The synced playback is absolutely flawless. No more pausing and waiting for everyone to catch up. It feels exactly like we're sitting on the same couch.",
    author: "Marcus Chen",
    role: "Community Lead",
    avatar: "https://i.pravatar.cc/150?img=11"
  },
  {
    id: 3,
    quote: "Floating emojis make horror movie nights so much better. The reaction timing is perfect and we never talk over the important dialogues.",
    author: "Emma Watson",
    role: "Remote Student",
    avatar: "https://i.pravatar.cc/150?img=9"
  },
  {
    id: 4,
    quote: "We use this for our weekly team bonding. The host controls keep randoms out and let us focus on having a great time together.",
    author: "David Kim",
    role: "Engineering Manager",
    avatar: "https://i.pravatar.cc/150?img=68"
  },
  {
    id: 5,
    quote: "Easily the best watch party app out there. The audio quality is crystal clear even when the movie gets loud and action-packed.",
    author: "Sarah Jenkins",
    role: "Film Enthusiast",
    avatar: "https://i.pravatar.cc/150?img=1"
  }
];

export const Testimonial: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, 6000); // 6 seconds per testimonial
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="testimonial" className="w-full py-24 md:py-32 px-6 flex flex-col items-center bg-bg-primary border-t border-white/5">
      <div className="max-w-[1000px] w-full grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24 items-start">
        
        {/* Left: Heading */}
        <motion.div 
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="flex flex-col"
        >
          <span className="text-[#C0C0C0] font-semibold tracking-widest text-sm uppercase mb-8 block">
            // Testimonial
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-normal text-white tracking-tight leading-[1.1]">
            Loved by movie buffs, friends
          </h2>
        </motion.div>

        {/* Right: Testimonial Carousel */}
        <motion.div 
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="flex flex-col"
        >
          {/* Avatar Row */}
          <div className="flex items-center mb-8 h-16">
            {testimonials.map((t, i) => {
              const isActive = i === activeIndex;
              return (
                <div 
                  key={t.id}
                  className={`relative cursor-pointer transition-all duration-500 ease-out ${
                    isActive ? 'z-10 scale-125 mx-2' : 'z-0 scale-90 opacity-40 hover:opacity-70 -ml-2'
                  }`}
                  onClick={() => setActiveIndex(i)}
                  style={{ zIndex: isActive ? 10 : 5 - Math.abs(activeIndex - i) }}
                >
                  <div className={`w-12 h-12 rounded-xl overflow-hidden transition-all duration-500 ${
                    isActive ? 'border-[3px] border-[#7c8fff] shadow-[0_0_20px_rgba(124,143,255,0.4)] rotate-3' : 'border border-transparent'
                  }`}>
                    <img src={t.avatar} alt={t.author} className="w-full h-full object-cover" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quote Content */}
          <div className="min-h-[160px] relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 flex flex-col"
              >
                <p className="text-white text-lg md:text-xl font-medium leading-relaxed mb-6">
                  "{testimonials[activeIndex].quote}"
                </p>
                <div className="flex flex-col">
                  <span className="text-sm text-white font-bold">{testimonials[activeIndex].author}</span>
                  <span className="text-xs text-text-secondary">{testimonials[activeIndex].role}</span>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
          
        </motion.div>
      </div>
    </section>
  );
};
