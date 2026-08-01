import { supabase } from './src/config/supabase.js';
async function run() {
  const { data, error } = await supabase.from('profiles').select('*');
  console.log('Profiles:', data, error);
  process.exit(0);
}
run();
