import { RedisLock } from '../lib/lock.js';

async function main() {
  const redisUrl = process.env.REDIS_URL || null;
  if (!redisUrl) {
    console.log('REDIS_URL not set. To run this test, set REDIS_URL (eg. redis://127.0.0.1:6379)');
    return;
  }

  const lock = new RedisLock(redisUrl);
  console.log('Acquiring lock key=test_lock');
  const token = await lock.acquire('test_lock', 5000);
  if (!token) {
    console.error('Failed to acquire lock');
    await lock.quit();
    return;
  }
  console.log('Acquired token:', token);

  console.log('Attempting to acquire lock again (should fail)');
  const token2 = await lock.acquire('test_lock', 5000);
  console.log('Second acquire result (null expected):', token2);

  console.log('Releasing lock');
  const released = await lock.release('test_lock', token);
  console.log('Release returned:', released);

  console.log('Acquiring lock after release (should succeed)');
  const token3 = await lock.acquire('test_lock', 5000);
  console.log('Third acquire token:', token3);

  await lock.release('test_lock', token3);
  await lock.quit();
  console.log('Lock test complete');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
