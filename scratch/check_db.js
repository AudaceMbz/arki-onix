
const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSettings() {
  try {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'onix_db',
      port: process.env.DB_PORT || 3306,
    };
    const connection = await mysql.createConnection(config);
    const [rows] = await connection.execute('SELECT * FROM settings WHERE setting_key = "hero_video_path"');
    console.log('Hero Video Path:', rows);
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkSettings();
