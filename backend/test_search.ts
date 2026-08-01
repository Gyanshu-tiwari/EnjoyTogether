import { FriendRepository } from './src/repositories/friend.repository.js';
async function run() {
  const res = await FriendRepository.searchUsers('user', 'fake-requester');
  console.log('Search Results:', res);
  process.exit(0);
}
run();
