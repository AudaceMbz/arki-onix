const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  console.log('Testing connection with:');
  console.log('Host:', process.env.DB_HOST);
  console.log('User:', process.env.DB_USER);
  console.log('Password:', process.env.DB_PASSWORD ? '********' : '(empty)');
  console.log('Database:', process.env.DB_NAME);

  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'onix_db',
      port: process.env.DB_PORT || 3306
    });
    console.log('✅ Connection successful!');
    await db.end();
  } catch (err) {
    console.error('❌ Connection failed:');
    console.error(err);
  }
}

test();
