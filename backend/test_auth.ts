import { supabase } from './src/config/supabase.js';
async function run() {
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  console.log('Auth Users:', users?.map(u => ({ id: u.id, metadata: u.user_metadata })));
  process.exit(0);
}
run();
