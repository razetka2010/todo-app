const { initDatabase } = require('./database');
const dotenv = require('dotenv');

dotenv.config();

async function initialize() {
    try {
        console.log('Initializing database...');
        await initDatabase();
        console.log('Database initialized successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

initialize();