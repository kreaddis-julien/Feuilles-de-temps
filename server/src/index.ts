import path from 'path';
import { createApp } from './app.js';

const DATA_DIR = path.join(import.meta.dirname, '../../data');
const app = createApp(DATA_DIR);

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
