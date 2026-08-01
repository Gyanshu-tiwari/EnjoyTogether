import { supabase } from './src/config/supabase.js';
async function run() {
  const { data, error } = await supabase.auth.admin.listUsers();
  console.log('Users Data:', data, 'Error:', error);
  process.exit(0);
}
run();
