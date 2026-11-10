// Development only; the distribution launches the bundled kernel-worker.mjs.
import { register } from 'tsx/esm/api';
register();
await import('./kernel-worker.ts');
