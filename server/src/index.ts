import path from 'path';
import { createApp } from './app.js';

const DATA_DIR = path.join(import.meta.dirname, '../../data');
const app = createApp(DATA_DIR);

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
