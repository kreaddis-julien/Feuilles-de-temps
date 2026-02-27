import path from 'path';
import { createApp } from './app.js';

const dataDirIndex = process.argv.indexOf('--data-dir');
const DATA_DIR = (dataDirIndex !== -1 && process.argv[dataDirIndex + 1])
  ? process.argv[dataDirIndex + 1]
  : path.join(import.meta.dirname, '../../data');
const app = createApp(DATA_DIR);

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
