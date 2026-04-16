const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkProjects() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'onix_db'
  });

  try {
    const [rows] = await connection.execute('SELECT * FROM projects');
    console.log('--- PROJECTS IN DATABASE ---');
    console.log(JSON.stringify(rows, null, 2));
    console.log('----------------------------');
  } catch (err) {
    console.error('❌ Error fetching projects:', err.message);
  } finally {
    await connection.end();
  }
}

checkProjects();
