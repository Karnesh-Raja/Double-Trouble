import { initDb, closeDb } from '../src/database/db.js';
import { seedDemo } from '../src/services/seedService.js';
initDb();
console.log((await seedDemo()) ? 'Seeded SHP-001 with a NORMAL reading.' : 'SHP-001 already exists. Delete data/agrosense.db to start fresh.');
closeDb();
