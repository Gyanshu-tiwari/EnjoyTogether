import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data, error } = await supabase.auth.admin.listUsers();
  console.log('Users Data:', data.users.map(u => ({ id: u.id, meta: u.user_metadata })));
  process.exit(0);
}
run();
