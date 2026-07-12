import dotenv from 'dotenv';

dotenv.config();

export const livekitConfig = {
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  serverUrl: process.env.LIVEKIT_URL!,
};

if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
  console.warn('⚠️ LiveKit credentials or URL missing. Using local development fallbacks.');
} else {
  console.log('⚡ LiveKit connection configurations loaded successfully.');
}