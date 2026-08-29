import React from 'react';
import { Hero } from '@/features/landing/components/Hero';
import { TrustBar } from '@/features/landing/components/TrustBar';
import { HowItWorks } from '@/features/landing/components/HowItWorks';
import { FeatureShowcase } from '@/features/landing/components/FeatureShowcase';
import { ProductShowcase } from '@/features/landing/components/ProductShowcase';
import { FAQ } from '@/features/landing/components/FAQ';
import { FinalCTA } from '@/features/landing/components/FinalCTA';
import { Footer } from '@/features/landing/components/Footer';
import { SmoothScroll } from '@/features/landing/components/SmoothScroll';

export const Landing: React.FC = () => {
  return (
    <SmoothScroll>
      <div className="w-full flex flex-col items-center selection:bg-brand/25 overflow-hidden">
        <Hero />
        <TrustBar />
        <HowItWorks />
        <ProductShowcase />
        <FeatureShowcase />
        <FAQ />
        <FinalCTA />
        <Footer />
      </div>
    </SmoothScroll>
  );
};

export default Landing;
