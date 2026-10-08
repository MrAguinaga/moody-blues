import { dirname } from 'node:path';

export function findNearestExistingPath(path: string, exists: (path: string) => boolean): string {
  let current = path;
  while (!exists(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
  return current;
}
