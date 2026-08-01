import { supabase } from './src/config/supabase.js';
async function run() {
  const { data, error } = await supabase.auth.admin.listUsers();
  console.log('Users:', data.users.map(u => ({ email: u.email, meta: u.user_metadata })));
  process.exit(0);
}
run();
