import { getDatabase } from './index.js';
const database = getDatabase();
console.log(`SQLite ready: ${database.path}`);
database.sqlite.close();
