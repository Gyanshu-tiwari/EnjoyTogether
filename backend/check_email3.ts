import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { supabase } from './src/config/supabase.js';

async function check(email: string) {
  if (!supabase) return;
  const { data, error } = await supabase.auth.signUp({ email, password: 'FakePassword123!' });
  console.log("Email:", email, "Error:", error?.message);
}
check('fake1234567@example.com');
check('name@example.com');
