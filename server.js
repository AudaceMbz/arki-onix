'use strict';
// ═══════════════════════════════════════════════════════════════
//  ONIX ARCHITECTURE — Node.js Backend Server (PostgreSQL Version)
//  Language : JavaScript (Node.js)
//  Database : PostgreSQL (via pg)
//  Auth     : express-session + bcryptjs
//  Uploads  : multer + cloudinary
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();

const express    = require('express');
const { Pool }   = require('pg');
const multer     = require('multer');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'onix_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// ─── PostgreSQL Connection Pool ───────────────────────────────────────────────
let db;

async function connectDB() {
  try {
    const connectionConfig = process.env.DATABASE_URL 
      ? { 
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false } 
        }
      : {
          host     : process.env.DB_HOST     || 'localhost',
          user     : process.env.DB_USER     || 'postgres',
          password : process.env.DB_PASSWORD || '',
          database : process.env.DB_NAME     || 'onix_db',
          port     : process.env.DB_PORT     || 5432,
        };

    console.log('🔌  Attempting to connect to PostgreSQL...');
    db = new Pool(connectionConfig);
    
    // Test connection
    await db.query('SELECT 1');
    console.log('✅  PostgreSQL connected');
    
    // AUTO-INIT: Create tables if they don't exist
    await initSchema();
    await seedAdmin();
  } catch (err) {
    console.error('❌  PostgreSQL connection failed:', err.message);
    db = null;
  }
}

// ─── Initialize Database Schema ────────────────────────────────────────────────
async function initSchema() {
  console.log('🗂️  Initializing database schema...');
  const tableQueries = [
    `CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      description TEXT,
      image_path VARCHAR(500),
      display_order INT DEFAULT 0,
      target_page VARCHAR(20) DEFAULT 'both',
      is_active SMALLINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      icon VARCHAR(100),
      display_order INT DEFAULT 0,
      is_active SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS team_photos (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      role VARCHAR(255),
      image_path VARCHAR(500),
      display_order INT DEFAULT 0,
      is_active SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS workshops (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      learn_more TEXT,
      our_speakers TEXT,
      business_knowledge TEXT,
      date_label VARCHAR(100),
      display_order INT DEFAULT 0,
      is_active SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS about_content (
      id SERIAL PRIMARY KEY,
      content_key VARCHAR(100) NOT NULL UNIQUE,
      content_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  try {
    for (const query of tableQueries) {
      await db.query(query);
    }
    console.log('✅  Database schema initialized / verified');

    // Default settings seed
    await db.query(`
      INSERT INTO settings (setting_key, setting_value) 
      VALUES 
        ('site_name', 'Onix Studio'),
        ('hero_title', 'Architecture is Experience'),
        ('hero_video_path', ''),
        ('footer_text', '© 2026 Onix Studio. All rights reserved.')
      ON CONFLICT (setting_key) DO NOTHING
    `);
  } catch (err) {
    console.error('❌ Schema Init Error:', err.message);
  }
}

// ─── Seed Default Admin ───────────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const { rows } = await db.query('SELECT id FROM admins LIMIT 1');
    if (rows.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'onix2026', 10);
      await db.query(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
        [process.env.ADMIN_USERNAME || 'admin', hash]
      );
      console.log('✅  Default admin account created');
    }
  } catch (err) {
    console.error('Seed admin error:', err.message);
  }
}

// ─── Multer — File Upload Setup ───────────────────────────────────────────────
let storage;
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'onix_uploads',
      resource_type: 'auto',
      allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'svg']
    }
  });
  console.log('☁️  Cloudinary storage ready');
} else {
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const typeMap = { project: 'public/images/projects', team: 'public/images/team', video: 'public/videos', logo: 'public/images' };
      const dest = typeMap[req.body.upload_type] || 'public/uploads';
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1000)}${ext}`);
    }
  });
}

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireDB(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Database not connected' });
  next();
}

// ═══════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════

// --- Admin Auth ---
app.post('/api/admin/login', requireDB, async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.adminId = rows[0].id;
    req.session.username = rows[0].username;
    res.json({ success: true, username: rows[0].username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  if (req.session && req.session.adminId) res.json({ loggedIn: true, username: req.session.username });
  else res.json({ loggedIn: false });
});

// --- Settings ---
app.get('/api/settings', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT setting_key, setting_value FROM settings');
    const result = {};
    rows.forEach(r => { result[r.setting_key] = r.setting_value; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/settings', requireAuth, requireDB, upload.single('file'), async (req, res) => {
  try {
    const { setting_key, setting_value, upload_type } = req.body;
    let value = setting_value;
    if (req.file) {
      value = req.file.path.startsWith('http') ? req.file.path : (upload_type === 'video' ? '/videos/' : '/images/') + req.file.filename;
    }
    await db.query(
      'INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
      [setting_key, value]
    );
    res.json({ success: true, value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Projects ---
app.get('/api/projects', requireDB, async (req, res) => {
  try {
    const { page } = req.query;
    let sql = 'SELECT id, title, category, description, image_path, display_order, target_page FROM projects WHERE is_active = 1';
    if (page === 'home') sql += " AND (target_page = 'home' OR target_page = 'both' OR target_page IS NULL)";
    else if (page === 'work') sql += " AND (target_page = 'work' OR target_page = 'both' OR target_page IS NULL)";
    sql += ' ORDER BY display_order ASC, created_at DESC LIMIT 100';
    const { rows } = await db.query(sql);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/projects', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    console.log('[POST] Adding Project:', req.body.title);
    const { title, category, description, display_order, target_page } = req.body;
    const order = parseInt(display_order) || 0;
    const img   = req.file ? (req.file.path.startsWith('http') ? req.file.path : '/images/projects/' + req.file.filename) : '';
    const { rows } = await db.query(
      'INSERT INTO projects (title, category, description, image_path, display_order, target_page) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [title, category || '', description || '', img, order, target_page || 'both']
    );
    console.log('✅ Project saved successfully with ID:', rows[0].id);
    res.status(201).json({ success: true, id: rows[0].id, image_path: img });
  } catch (err) { 
    console.error('❌ Project save error:', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

app.put('/api/admin/projects/:id', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[PUT] Updating Project:', id);
    const { title, category, description, display_order, is_active, target_page } = req.body;
    const updates = { title, category, description, target_page };
    if (display_order !== undefined) updates.display_order = parseInt(display_order) || 0;
    if (is_active !== undefined) updates.is_active = parseInt(is_active) || 1;
    if (req.file) updates.image_path = req.file.path.startsWith('http') ? req.file.path : '/images/projects/' + req.file.filename;

    const keys   = Object.keys(updates).filter(k => updates[k] !== undefined);
    const values = keys.map(k => updates[k]);
    values.push(parseInt(id));

    const setClause = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    await db.query(`UPDATE projects SET ${setClause} WHERE id=$${keys.length + 1}`, values);
    res.json({ success: true });
  } catch (err) { 
    console.error('❌ Project update error:', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

app.delete('/api/admin/projects/:id', requireAuth, requireDB, async (req, res) => {
  try {
    await db.query('UPDATE projects SET is_active = 0 WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Services ---
app.get('/api/services', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM services WHERE is_active=1 ORDER BY display_order ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/services', requireAuth, requireDB, async (req, res) => {
  try {
    const { title, description, icon, display_order } = req.body;
    const { rows } = await db.query(
      'INSERT INTO services (title, description, icon, display_order) VALUES ($1,$2,$3,$4) RETURNING id',
      [title, description || '', icon || 'building', parseInt(display_order) || 0]
    );
    res.status(201).json({ success: true, id: rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/services/:id', requireAuth, requireDB, async (req, res) => {
  try {
    const { title, description, icon, display_order, is_active } = req.body;
    await db.query(
      'UPDATE services SET title=$1, description=$2, icon=$3, display_order=$4, is_active=$5 WHERE id=$6',
      [title, description, icon, parseInt(display_order) || 0, parseInt(is_active) || 1, parseInt(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Team ---
app.get('/api/team', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM team_photos WHERE is_active=1 ORDER BY display_order ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/team', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { name, role, display_order } = req.body;
    const img = req.file ? (req.file.path.startsWith('http') ? req.file.path : '/images/team/' + req.file.filename) : '';
    const { rows } = await db.query(
      'INSERT INTO team_photos (name, role, image_path, display_order) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, role || '', img, parseInt(display_order) || 0]
    );
    res.status(201).json({ success: true, id: rows[0].id, image_path: img });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Workshops ---
app.get('/api/workshops', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM workshops WHERE is_active=1 ORDER BY display_order ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/workshops', requireAuth, requireDB, async (req, res) => {
  try {
    const { title, description, learn_more, our_speakers, business_knowledge, date_label, display_order } = req.body;
    const { rows } = await db.query(
      'INSERT INTO workshops (title, description, learn_more, our_speakers, business_knowledge, date_label, display_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [title, description || '', learn_more || '', our_speakers || '', business_knowledge || '', date_label || '', parseInt(display_order) || 0]
    );
    res.status(201).json({ success: true, id: rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- About ---
app.get('/api/about', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT content_key, content_value FROM about_content');
    const result = {};
    rows.forEach(r => { result[r.content_key] = r.content_value; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/about', requireAuth, requireDB, async (req, res) => {
  try {
    const { content_key, content_value } = req.body;
    await db.query(
      'INSERT INTO about_content (content_key, content_value) VALUES ($1,$2) ON CONFLICT (content_key) DO UPDATE SET content_value = EXCLUDED.content_value',
      [content_key, content_value]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- System ---
app.get('/api/status', (req, res) => {
  res.json({ server: 'running', database: db ? 'connected' : 'disconnected', node: process.version, time: new Date().toISOString() });
});

// --- Static Pages ---
const pub = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get(['/admin', '/admin/*splat'], pub('admin.html'));
app.get(['/about', '/about.html'], pub('about.html'));
app.get(['/services', '/services.html'], pub('services.html'));
app.get(['/training', '/training.html'], pub('training.html'));
app.get(['/work', '/work.html'], pub('work.html'));
app.get(['/contact', '/contact.html'], pub('contact.html'));
app.get(['/', '/home.html', '/index.html', '/{*splat}'], pub('index.html'));

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀  Onix server  →  http://localhost:${PORT}`);
  });
});
