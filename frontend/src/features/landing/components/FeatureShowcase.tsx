import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Link as LinkIcon, Chrome, Safari, Edge } from 'lucide-react';

export const FeatureShowcase: React.FC = () => {
  return (
    <section id="features" className="w-full py-24 md:py-32 px-6 flex flex-col items-center">
      <div className="max-w-[1200px] w-full">
        {/* Header Area */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-16 gap-8">
          <div>
            <span className="text-[#C0C0C0] font-semibold tracking-widest text-xs uppercase mb-3 block">
              The Advantage
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-black font-heading text-white tracking-tight uppercase leading-none">
              Built For<br />Watch Parties
            </h2>
          </div>
          <p className="text-text-secondary max-w-sm text-sm md:text-base leading-relaxed md:pt-6">
            Experience the difference with powerful tools and features designed to optimize your remote movie nights.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1: Synced Playback (Col span 2) */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="md:col-span-2 lg:col-span-2 relative rounded-3xl overflow-hidden group min-h-[450px] flex flex-col justify-end p-8 md:p-10 border border-white/5 bg-[#1A1A1D]"
          >
            <img src="/hero.avif" alt="Synced Playback" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
            
            <div className="relative z-10 flex flex-col items-start">
              <h3 className="text-3xl md:text-4xl font-bold text-white mb-3 uppercase font-heading tracking-tight">Expand Your Reach</h3>
              <p className="text-gray-300 max-w-sm mb-8 text-sm md:text-base">
                When anyone pauses or seeks, it happens for everyone instantly. Perfect synchronization in local markets.
              </p>
              <button className="bg-white text-black font-bold py-3 px-8 rounded-full text-sm hover:scale-105 transition-transform uppercase tracking-wider">
                Start Now
              </button>
            </div>
          </motion.div>

          {/* Card 2: Real-time Audio (Teal) */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-3xl bg-[#094F45] p-8 flex flex-col relative overflow-hidden min-h-[450px]"
          >
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 uppercase font-heading tracking-tight">Maximize ROI</h3>
            <p className="text-[#A2CFC6] text-sm md:text-base leading-relaxed">
              Leverage real-time voice chat to continuously improve your movie experience.
            </p>
            
            <div className="mt-auto flex justify-center items-end pt-12 relative z-10">
               {/* Faux Chart */}
               <div className="flex items-end gap-1.5 md:gap-2 h-40 w-full justify-between opacity-90">
                 {[4,5,6,9,10,7,8,4,2].map((h, i) => (
                   <motion.div 
                     key={i} 
                     initial={{ height: 0 }}
                     whileInView={{ height: `${h * 10}%` }}
                     transition={{ duration: 0.8, delay: 0.2 + (i * 0.05) }}
                     className="w-full bg-[#F47B62] rounded-t-full" 
                   />
                 ))}
               </div>
            </div>
          </motion.div>

          {/* Card 3: Floating Reactions (Mint) */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="rounded-3xl bg-[#76F6D6] p-8 flex flex-col relative overflow-hidden min-h-[450px]"
          >
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 uppercase font-heading tracking-tight">Save Time</h3>
            <p className="text-gray-800 text-sm md:text-base leading-relaxed">
              Automate floating emoji reactions and focus on enjoying the movie.
            </p>
            
            <div className="mt-auto w-full flex flex-col items-center pt-8">
               <div className="bg-white/80 rounded-2xl p-4 w-full shadow-xl shadow-black/5">
                 <div className="flex items-center justify-between mb-4">
                   <span className="text-xs font-bold text-gray-500 uppercase">Clicks</span>
                   <span className="text-sm font-black text-gray-900">306</span>
                 </div>
                 <div className="flex items-center justify-between mb-4">
                   <span className="text-xs font-bold text-gray-500 uppercase">Impressions</span>
                   <span className="text-sm font-black text-gray-900">59,382</span>
                 </div>
                 <div className="flex items-center justify-between mb-2">
                   <span className="text-xs font-bold text-gray-500 uppercase">CTR</span>
                   <span className="text-sm font-black text-gray-900">0.40%</span>
                 </div>
               </div>
               <div className="bg-[#094F45] text-white text-xs font-bold uppercase tracking-wider py-2.5 px-6 rounded-full -mt-4 shadow-lg hover:scale-105 transition-transform cursor-pointer">
                 Create Now
               </div>
            </div>
          </motion.div>

          {/* Card 4: Secure Rooms (Yellow) */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="rounded-3xl bg-[#F4F878] p-8 flex flex-col relative overflow-hidden min-h-[450px]"
          >
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 uppercase font-heading tracking-tight">Channel Flexibility</h3>
            <p className="text-gray-800 text-sm md:text-base leading-relaxed">
              Recognized by major partners, to increase your visibility and attract new friends.
            </p>
            
            <div className="mt-auto flex justify-center items-center py-10 relative">
               <div className="absolute inset-0 rounded-full border border-yellow-400/30 scale-75" />
               <div className="absolute inset-0 rounded-full border border-yellow-400/20 scale-100" />
               <div className="relative w-full aspect-square max-w-[200px]">
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-500"><Chrome className="w-6 h-6" /></div>
                 <div className="absolute bottom-4 left-4 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-600"><Edge className="w-6 h-6" /></div>
                 <div className="absolute bottom-4 right-4 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg text-blue-400"><Safari className="w-6 h-6" /></div>
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg text-pink-500 font-black text-xl">♥</div>
               </div>
            </div>
          </motion.div>

          {/* Card 5: No Downloads (Purple) */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="rounded-3xl bg-[#D4ACFF] p-8 flex flex-col relative overflow-hidden min-h-[450px]"
          >
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 uppercase font-heading tracking-tight">Dedicated Support</h3>
            <p className="text-gray-800 text-sm md:text-base leading-relaxed">
              24/7 host controls, dedicated room links, and more - whenever you need it.
            </p>
            
            <div className="mt-auto flex flex-col items-center pt-8 relative">
               <div className="w-16 h-16 bg-[#A855F7] rounded-full z-10 flex items-center justify-center shadow-xl shadow-purple-500/30 text-white mb-8">
                 <ShieldCheck className="w-8 h-8" />
               </div>
               
               {/* Connecting lines */}
               <svg className="absolute bottom-12 w-full h-24 pointer-events-none" preserveAspectRatio="none">
                 <path d="M50 0 C 50 40, 20 60, 20 100" stroke="#A855F7" strokeWidth="1" fill="none" opacity="0.4"/>
                 <path d="M50 0 C 50 40, 50 60, 50 100" stroke="#A855F7" strokeWidth="1" fill="none" opacity="0.4"/>
                 <path d="M50 0 C 50 40, 80 60, 80 100" stroke="#A855F7" strokeWidth="1" fill="none" opacity="0.4"/>
               </svg>
               
               <div className="w-full flex justify-center gap-2 relative z-10">
                 <div className="w-12 h-12 bg-white rounded-full border-2 border-white shadow-md overflow-hidden"><img src="https://i.pravatar.cc/150?img=68" alt="User" /></div>
                 <div className="w-12 h-12 bg-white rounded-full border-2 border-white shadow-md overflow-hidden"><img src="https://i.pravatar.cc/150?img=11" alt="User" /></div>
                 <div className="w-12 h-12 bg-white rounded-full border-2 border-white shadow-md overflow-hidden"><img src="https://i.pravatar.cc/150?img=5" alt="User" /></div>
                 <div className="w-12 h-12 bg-white rounded-full border-2 border-white shadow-md overflow-hidden"><img src="https://i.pravatar.cc/150?img=9" alt="User" /></div>
               </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
};
