import { UserRepository } from './src/repositories/user.repository.js';
import { FriendRepository } from './src/repositories/friend.repository.js';

async function run() {
  const userId = '123e4567-e89b-12d3-a456-426614174000'; // Fake UUID
  
  // 1. Sync profile
  console.log('Syncing profile...');
  await UserRepository.syncProfile(userId, { username: 'testuser' });
  
  // 2. Fetch profile
  console.log('Fetching profile...');
  const profile = await UserRepository.getProfile(userId);
  console.log('Profile:', profile);
  
  // 3. Search user
  console.log('Searching for "test"...');
  const results = await FriendRepository.searchUsers('test', 'other-user');
  console.log('Search Results:', results);
  
  process.exit(0);
}
run();
