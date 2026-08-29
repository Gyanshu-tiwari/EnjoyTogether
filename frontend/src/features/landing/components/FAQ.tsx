import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    question: "Do my friends need an account to join?",
    answer: "No! Guests can join your room instantly via the invite link without creating an account. They just need to enter a display name."
  },
  {
    question: "Is it really free?",
    answer: "Yes, EnjoyTogether is completely free to use. There are no hidden fees or premium tiers."
  },
  {
    question: "What kind of video links are supported?",
    answer: "You can paste direct MP4 links, HLS (.m3u8) streams, and standard web video URLs. Video platform support (like YouTube) depends on their embedding policies."
  },
  {
    question: "How many people can join a room?",
    answer: "Our rooms are optimized for small to medium groups, typically up to 20 people, to ensure the best real-time audio and video quality for everyone."
  }
];

export const FAQ: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="w-full py-32 px-6 flex flex-col items-center">
      <div className="max-w-3xl w-full">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl font-extrabold font-heading text-white tracking-tight mb-4">
            Common Questions
          </h2>
          <p className="text-text-secondary">Everything you need to know about EnjoyTogether.</p>
        </motion.div>

        <div className="flex flex-col gap-4">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                key={index} 
                className={`border rounded-2xl overflow-hidden transition-colors duration-300 ${isOpen ? 'bg-white/5 border-white/10' : 'bg-bg-card border-white/5 hover:border-white/10'}`}
              >
                <button
                  className="w-full px-6 py-5 flex items-center justify-between text-left cursor-pointer"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                >
                  <span className="font-bold text-white pr-4">{faq.question}</span>
                  <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-white/5 text-neutral-400"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                      <div className="px-6 pb-5 text-text-secondary leading-relaxed">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
