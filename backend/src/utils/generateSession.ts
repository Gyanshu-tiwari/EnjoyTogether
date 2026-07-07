import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js"; 
import dotenv from 'dotenv';
import path from 'path'; 
import { fileURLToPath } from 'url'; // 🎯 1. Import fileURLToPath from the built-in 'url' module
import readline from "readline";

// 🎯 2. Re-create __dirname manually for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🎯 3. Now this works perfectly with absolute safety!
dotenv.config({ path: path.resolve(__dirname, "../../.env") }); 

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH || "";

// 🛡️ Explicit safety check to halt execution if environment variables failed to load
if (!apiId || !apiHash) {
  console.error("🔴 Environment Load Failed! Your keys are empty inside process.env.");
  console.error("Please verify that your .env file exists in the backend root directory.");
  process.exit(1);
}

const stringSession = new StringSession(""); 

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  console.log("🚀 Initializing temporary Telegram auth client...");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => new Promise((resolve) => rl.question("📱 Enter your phone number (with country code, e.g., +91...): ", resolve)),
    password: async () => new Promise((resolve) => rl.question("🔒 Enter your 2FA Password (if enabled, else press Enter): ", resolve)),
    phoneCode: async () => new Promise((resolve) => rl.question("💬 Enter the 5-digit Telegram verification code you received: ", resolve)),
    onError: (err) => console.error("🔴 Auth Error:", err),
  });

  console.log("\n✨ SUCCESS! Connected smoothly to Telegram infrastructure.");
  console.log("\n🔑 YOUR TELEGRAM_SESSION STRING (Copy everything below):\n");
  console.log(client.session.save() as unknown as string); 
  console.log("\n-------------------------------------\n");

  rl.close();
  await client.disconnect();
})();