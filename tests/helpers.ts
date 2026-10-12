import { openStore, type Store } from '@notify-hub/store';

export function testStore(): Store {
  const s = openStore(':memory:');
  s.migrate();
  return s;
}
