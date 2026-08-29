import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { supabase } from './src/config/supabase.js';

async function checkEmail(email: string) {
  if (!supabase) {
    console.error("Supabase not initialized");
    return;
  }
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
  });
  console.log("Email:", email, "Data:", !!data, "Error:", error?.message);
}

checkEmail('fake-email-not-in-db-123456@example.com');
checkEmail('name@example.com');
