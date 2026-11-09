// Development only; the distribution launches the bundled messaging-worker.mjs.
import { register } from 'tsx/esm/api';
register();
await import('./messaging-worker.ts');
