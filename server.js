'use strict';
// ═══════════════════════════════════════════════════════════════
//  ONIX ARCHITECTURE — Multi-DB Backend (MySQL + PostgreSQL)
//  Automatically detects environment (Render PG vs AlwaysData MySQL)
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
  secret: 'onix_robust_secret_2026',
  resave: true,
  saveUninitialized: true,
  cookie: {
    secure: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ─── Database Abstraction Layer ───────────────────────────────────────────────
let pool;
let dbType = 'mysql'; 

async function connectDB() {
  try {
    if (process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres') {
      dbType = 'postgres';
      console.log('🔌 Detected PostgreSQL environment');
      const config = process.env.DATABASE_URL 
        ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
        : {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'onix_db',
            port: process.env.DB_PORT || 5432,
          };
      pool = new Pool(config);
      await pool.query('SELECT 1');
      console.log('✅ PostgreSQL connected');
    } else {
      dbType = 'mysql';
      console.log(`🔌 Detected MySQL environment (${process.env.DB_HOST || 'localhost'})`);
      const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'onix_db',
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
      };
      pool = mysql.createPool(config);
      await pool.query('SELECT 1');
      console.log('✅ MySQL connected');
    }
    await initSchema();
    await seedAdmin();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    pool = null;
  }
}

async function query(sql, params = []) {
  if (!pool) throw new Error('Database not connected');
  if (dbType === 'postgres') {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const res = await pool.query(pgSql, params);
    return [res.rows, res]; 
  } else {
    return await pool.query(sql, params);
  }
}

async function initSchema() {
  console.log(`🗂️ Verifying ${dbType} schema...`);
  try {
    const isPG = dbType === 'postgres';
    const tables = [
      { name: 'admins', sql: isPG 
        ? `CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
        : `CREATE TABLE IF NOT EXISTS admins (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB` 
      },
      { name: 'settings', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, setting_key VARCHAR(100) NOT NULL UNIQUE, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
        : `CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) NOT NULL UNIQUE, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`
      },
      { name: 'projects', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), description TEXT, image_path VARCHAR(500), display_order INT DEFAULT 0, target_page VARCHAR(20) DEFAULT 'both', is_active SMALLINT DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
        : `CREATE TABLE IF NOT EXISTS projects (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), description TEXT, image_path VARCHAR(500), display_order INT DEFAULT 0, target_page VARCHAR(20) DEFAULT 'both', is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`
      },
      { name: 'services', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS services (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, icon VARCHAR(100), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`
        : `CREATE TABLE IF NOT EXISTS services (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, icon VARCHAR(100), display_order INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1) ENGINE=InnoDB`
      },
      { name: 'team_photos', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS team_photos (id SERIAL PRIMARY KEY, name VARCHAR(255), role VARCHAR(255), image_path VARCHAR(500), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`
        : `CREATE TABLE IF NOT EXISTS team_photos (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), role VARCHAR(255), image_path VARCHAR(500), display_order INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1) ENGINE=InnoDB`
      },
      { name: 'workshops', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS workshops (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, learn_more TEXT, our_speakers TEXT, business_knowledge TEXT, date_label VARCHAR(100), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`
        : `CREATE TABLE IF NOT EXISTS workshops (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, learn_more TEXT, our_speakers TEXT, business_knowledge TEXT, date_label VARCHAR(100), display_order INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1) ENGINE=InnoDB`
      },
      { name: 'about_content', sql: isPG
        ? `CREATE TABLE IF NOT EXISTS about_content (id SERIAL PRIMARY KEY, content_key VARCHAR(100) NOT NULL UNIQUE, content_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
        : `CREATE TABLE IF NOT EXISTS about_content (id INT AUTO_INCREMENT PRIMARY KEY, content_key VARCHAR(100) NOT NULL UNIQUE, content_value LONGTEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB`
      }
    ];
    for (const t of tables) await query(t.sql);
    console.log('✅ Database schema verified');

    const seedSql = isPG
      ? `INSERT INTO settings (setting_key, setting_value) VALUES ($1,$2) ON CONFLICT (setting_key) DO NOTHING`
      : `INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?,?)`;
    const defaults = [['site_name','Onix Studio'], ['hero_title','Architecture is Experience'], ['hero_video_path',''], ['footer_text','© 2026 Onix Studio']];
    for (const d of defaults) await (isPG ? pool.query(seedSql, d) : pool.query(seedSql, d));
  } catch (err) { console.error('❌ Schema Verification Error:', err.message); }
}

async function seedAdmin() {
  try {
    const [rows] = await query('SELECT id FROM admins LIMIT 1');
    if (!rows.length) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'onix2026', 10);
      await query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [process.env.ADMIN_USERNAME || 'admin', hash]);
      console.log('✅ Default admin created');
    }
  } catch (err) { console.error('Seed error:', err.message); }
}

if (process.env.CLOUDINARY_URL) cloudinary.config({ secure: true });
const storage = process.env.CLOUDINARY_URL
  ? new CloudinaryStorage({ cloudinary, params: { folder: 'onix_uploads', resource_type: 'auto', allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'svg'] } })
  : multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = { project: 'public/images/projects', team: 'public/images/team' }[req.body.upload_type] || 'public/uploads';
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  });
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function requireDB(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Database not connected' });
  next();
}

app.post('/api/admin/login', requireDB, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const [rows] = await query('SELECT * FROM admins WHERE LOWER(username) = LOWER(?)', [username]);
    if (rows.length && await bcrypt.compare(password, rows[0].password_hash)) {
      req.session.adminId = rows[0].id;
      req.session.username = rows[0].username;
      return res.json({ success: true, username: rows[0].username });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/admin/check', (req, res) => res.json({ loggedIn: !!(req.session && req.session.adminId), username: req.session ? req.session.username : '' }));

app.get('/api/settings', requireDB, async (req, res) => {
  try {
    const [rows] = await query('SELECT * FROM settings');
    const s = {}; rows.forEach(r => s[r.setting_key] = r.setting_value);
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/settings', requireAuth, requireDB, upload.single('file'), async (req, res) => {
  try {
    let val = req.body.setting_value;
    if (req.file) {
      if (req.file.path.startsWith('http')) {
        val = req.file.path;
      } else {
        const relPath = req.file.path.replace(/\\/g, '/');
        val = '/' + relPath.replace(/^public\//, '');
      }
    }
    const sql = dbType === 'postgres'
      ? 'INSERT INTO settings (setting_key, setting_value) VALUES ($1,$2) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value'
      : 'INSERT INTO settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)';
    await (dbType === 'postgres' ? pool.query(sql, [req.body.setting_key, val]) : query(sql, [req.body.setting_key, val]));
    res.json({ success: true, value: val });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects', requireDB, async (req, res) => {
  try {
    const { page } = req.query;
    let sql = 'SELECT * FROM projects WHERE is_active = 1';
    if (page === 'home') sql += " AND (target_page = 'home' OR target_page = 'both')";
    else if (page === 'work') sql += " AND (target_page = 'work' OR target_page = 'both')";
    sql += ' ORDER BY display_order ASC, created_at DESC LIMIT 100';
    const [rows] = await query(sql); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/projects', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { title, category, description, display_order, target_page } = req.body;
    const img = req.file ? (req.file.path.startsWith('http') ? req.file.path : '/' + req.file.path.replace(/\\/g, '/').replace(/^public\//, '')) : '';
    const sql = dbType === 'postgres'
      ? 'INSERT INTO projects (title, category, description, image_path, display_order, target_page) VALUES (?,?,?,?,?,?) RETURNING id'
      : 'INSERT INTO projects (title, category, description, image_path, display_order, target_page) VALUES (?,?,?,?,?,?)';
    const [rows, result] = await query(sql, [title, category || '', description || '', img, parseInt(display_order) || 0, target_page || 'both']);
    const id = dbType === 'postgres' ? rows[0].id : result.insertId;
    res.status(201).json({ success: true, id, image_path: img });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/projects/:id', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { title, category, description, display_order, is_active, target_page } = req.body;
    const upd = { title, category, description, target_page, display_order: parseInt(display_order) || 0, is_active: parseInt(is_active) || 1 };
    if (req.file) upd.image_path = req.file.path.startsWith('http') ? req.file.path : '/' + req.file.path.replace(/\\/g, '/').replace(/^public\//, '');
    const keys = Object.keys(upd);
    const set = keys.map(k => `${k}=?`).join(', ');
    await query(`UPDATE projects SET ${set} WHERE id=?`, [...keys.map(k => upd[k]), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/projects/:id', requireAuth, requireDB, async (req, res) => {
  try {
    await query('UPDATE projects SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/services', requireDB, async (req, res) => { try { const [rows] = await query('SELECT * FROM services WHERE is_active=1 ORDER BY display_order'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/team', requireDB, async (req, res) => { try { const [rows] = await query('SELECT * FROM team_photos WHERE is_active=1 ORDER BY display_order'); res.json(rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/about', requireDB, async (req, res) => {
  try {
    const [rows] = await query('SELECT * FROM about_content');
    const o = {}; rows.forEach(r => o[r.content_key] = r.content_value); res.json(o);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin/about', requireAuth, requireDB, async (req, res) => {
  try {
    const sql = dbType === 'postgres'
      ? 'INSERT INTO about_content (content_key, content_value) VALUES ($1,$2) ON CONFLICT (content_key) DO UPDATE SET content_value=EXCLUDED.content_value'
      : 'INSERT INTO about_content (content_key, content_value) VALUES (?,?) ON DUPLICATE KEY UPDATE content_value=VALUES(content_value)';
    await (dbType === 'postgres' ? pool.query(sql, [req.body.content_key, req.body.content_value]) : query(sql, [req.body.content_key, req.body.content_value]));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use((err, req, res, next) => {
  console.error('💥 GLOBAL ERROR:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const pub = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get(['/admin', '/admin/*splat'], pub('admin.html'));
app.get(['/about', '/about.html'], pub('about.html'));
app.get(['/work', '/work.html'], pub('work.html'));
app.get(['/', '/index.html', '/*splat'], pub('index.html'));

connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Onix server at port ${PORT} [${dbType.toUpperCase()}]`));
});
