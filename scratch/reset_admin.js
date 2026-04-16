const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'onix2026';
  
  console.log(`Resetting admin "${username}" with password from .env...`);
  
  const hash = await bcrypt.hash(password, 10);
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'onix_db'
  });

  try {
    await connection.execute(
      'INSERT INTO admins (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = ?',
      [username, hash, hash]
    );
    console.log('✅ Admin password updated successfully!');
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
  } catch (err) {
    console.error('❌ Error updating admin:', err.message);
  } finally {
    await connection.end();
  }
}

resetAdmin();
