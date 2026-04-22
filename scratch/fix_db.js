
const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixVideoPath() {
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
    if (rows.length > 0) {
      const currentVal = rows[0].setting_value;
      if (currentVal.startsWith('/images/1776881356541')) {
        const newVal = currentVal.replace('/images/', '/uploads/');
        await connection.execute('UPDATE settings SET setting_value = ? WHERE setting_key = "hero_video_path"', [newVal]);
        console.log('Updated video path to:', newVal);
      } else {
        console.log('Current video path does not match fix pattern:', currentVal);
      }
    } else {
      console.log('No hero_video_path found in settings');
    }
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fixVideoPath();
