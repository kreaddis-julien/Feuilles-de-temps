import path from 'path';
import { createApp } from './app.js';

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const DATA_DIR = getArg('--data-dir') ?? path.join(import.meta.dirname, '../../data');
const STATIC_DIR = getArg('--static-dir');
const app = createApp(DATA_DIR, { staticDir: STATIC_DIR });

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
