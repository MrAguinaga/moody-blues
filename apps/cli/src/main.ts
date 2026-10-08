import { main } from './cli';

void main().catch((err: unknown) => {
  console.error('Fatal error running Moody Blues:', err);
  process.exit(1);
});
