import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { supabase } from './src/config/supabase.js';

async function check(email: string) {
  if (!supabase) return;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: 'wrongpassword' });
  console.log("Email:", email, "Error:", error?.message);
}
check('fake12345@example.com');
check('name@example.com');
