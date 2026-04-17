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
    secure: false, // Compatibility for testing
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

    console.log('🔌 Connecting to PostgreSQL...');
    db = new Pool(connectionConfig);
    await db.query('SELECT 1');
    console.log('✅ PostgreSQL connected');
    
    await initSchema();
    await seedAdmin();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    db = null;
  }
}

// ─── Initialize Database Schema & Migrations ──────────────────────────────────
async function initSchema() {
  console.log('🗂️ Verifying database schema...');
  try {
    // 1. Create Tables
    await db.query(`CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, setting_key VARCHAR(100) NOT NULL UNIQUE, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), description TEXT, image_path VARCHAR(500), display_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS services (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, icon VARCHAR(100), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`);
    await db.query(`CREATE TABLE IF NOT EXISTS team_photos (id SERIAL PRIMARY KEY, name VARCHAR(255), role VARCHAR(255), image_path VARCHAR(500), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`);
    await db.query(`CREATE TABLE IF NOT EXISTS workshops (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, learn_more TEXT, our_speakers TEXT, business_knowledge TEXT, date_label VARCHAR(100), display_order INT DEFAULT 0, is_active SMALLINT DEFAULT 1)`);
    await db.query(`CREATE TABLE IF NOT EXISTS about_content (id SERIAL PRIMARY KEY, content_key VARCHAR(100) NOT NULL UNIQUE, content_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    // 2. MIGRATIONS: Add missing columns if they don't exist
    const migrateColumns = [
      { table: 'projects', column: 'target_page', type: "VARCHAR(20) DEFAULT 'both'" },
      { table: 'projects', column: 'is_active', type: 'SMALLINT DEFAULT 1' }
    ];

    for (const m of migrateColumns) {
      const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [m.table, m.column]);
      if (rows.length === 0) {
        console.log(`🚀 Migrating: Adding ${m.column} to ${m.table}...`);
        await db.query(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
      }
    }

    console.log('✅ Database schema verified');

    // Seed defaults
    await db.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('site_name','Onix Studio'),('hero_title','Architecture is Experience'),('hero_video_path',''),('footer_text','© 2026 Onix Studio') ON CONFLICT (setting_key) DO NOTHING`);
  } catch (err) {
    console.error('❌ Schema Verification Error:', err.message);
  }
}

async function seedAdmin() {
  try {
    const { rows } = await db.query('SELECT id FROM admins LIMIT 1');
    if (!rows.length) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'onix2026', 10);
      await db.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [process.env.ADMIN_USERNAME || 'admin', hash]);
      console.log('✅ Default admin created');
    }
  } catch (err) { console.error('Seed error:', err.message); }
}

// ─── Multer & Cloudinary ──────────────────────────────────────────────────────
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
}

const storage = process.env.CLOUDINARY_URL 
  ? new CloudinaryStorage({ cloudinary, params: { folder: 'onix_uploads', resource_type: 'auto', allowed_formats: ['jpeg','jpg','png','gif','webp','mp4','mov','avi','svg'] } })
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const dest = { project: 'public/images/projects', team: 'public/images/team' }[req.body.upload_type] || 'public/uploads';
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
    });

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Routes ──────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireDB(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Database not connected' });
  next();
}

// Admin Auth
app.post('/api/admin/login', requireDB, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM admins WHERE username = $1', [req.body.username]);
    if (rows.length && await bcrypt.compare(req.body.password, rows[0].password_hash)) {
      req.session.adminId = rows[0].id;
      req.session.username = rows[0].username;
      return res.json({ success: true, username: rows[0].username });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/admin/check', (req, res) => res.json({ loggedIn: !!(req.session && req.session.adminId), username: req.session ? req.session.username : '' }));

// API
app.get('/api/settings', requireDB, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM settings');
  const s = {}; rows.forEach(r => s[r.setting_key] = r.setting_value);
  res.json(s);
});

app.post('/api/admin/settings', requireAuth, requireDB, upload.single('file'), async (req, res) => {
  try {
    let val = req.body.setting_value;
    if (req.file) val = req.file.path.startsWith('http') ? req.file.path : '/images/' + req.file.filename;
    await db.query('INSERT INTO settings (setting_key, setting_value) VALUES ($1,$2) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value', [req.body.setting_key, val]);
    res.json({ success: true, value: val });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects', requireDB, async (req, res) => {
  const { page } = req.query;
  let sql = 'SELECT * FROM projects WHERE is_active = 1';
  if (page === 'home') sql += " AND (target_page = 'home' OR target_page = 'both')";
  else if (page === 'work') sql += " AND (target_page = 'work' OR target_page = 'both')";
  sql += ' ORDER BY display_order ASC, created_at DESC LIMIT 100';
  const { rows } = await db.query(sql); res.json(rows);
});

app.post('/api/admin/projects', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { title, category, description, display_order, target_page } = req.body;
    const img = req.file ? (req.file.path.startsWith('http') ? req.file.path : '/images/projects/' + req.file.filename) : '';
    const { rows } = await db.query(
      'INSERT INTO projects (title, category, description, image_path, display_order, target_page) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [title, category || '', description || '', img, parseInt(display_order) || 0, target_page || 'both']
    );
    res.status(201).json({ success: true, id: rows[0].id, image_path: img });
  } catch (err) { 
    console.error('❌ Project save error:', err.message);
    res.status(500).json({ error: err.message }); 
  }
});

app.put('/api/admin/projects/:id', requireAuth, requireDB, upload.single('image'), async (req, res) => {
  try {
    const { title, category, description, display_order, is_active, target_page } = req.body;
    const upd = { title, category, description, target_page, display_order: parseInt(display_order) || 0, is_active: parseInt(is_active) || 1 };
    if (req.file) upd.image_path = req.file.path.startsWith('http') ? req.file.path : '/images/projects/' + req.file.filename;
    const keys = Object.keys(upd);
    const set = keys.map((k, i) => `${k}=$${i+1}`).join(', ');
    await db.query(`UPDATE projects SET ${set} WHERE id=$${keys.length+1}`, [...keys.map(k=>upd[k]), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/projects/:id', requireAuth, requireDB, async (req, res) => {
  await db.query('UPDATE projects SET is_active=0 WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Generic routes for others
app.get('/api/services', requireDB, async (req,res) => { const { rows } = await db.query('SELECT * FROM services WHERE is_active=1 ORDER BY display_order'); res.json(rows); });
app.get('/api/team', requireDB, async (req,res) => { const { rows } = await db.query('SELECT * FROM team_photos WHERE is_active=1 ORDER BY display_order'); res.json(rows); });
app.get('/api/about', requireDB, async (req,res) => { 
  const { rows } = await db.query('SELECT * FROM about_content'); 
  const o = {}; rows.forEach(r => o[r.content_key] = r.content_value); res.json(o); 
});
app.post('/api/admin/about', requireAuth, requireDB, async (req,res) => {
  await db.query('INSERT INTO about_content (content_key, content_value) VALUES ($1,$2) ON CONFLICT (content_key) DO UPDATE SET content_value=EXCLUDED.content_value', [req.body.content_key, req.body.content_value]);
  res.json({ success: true });
});

// ─── ERROR HANDLER (CRITICAL) ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('💥 GLOBAL ERROR:', err);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack 
  });
});

// ─── SPA Static ──────────────────────────────────────────────────────────────
const pub = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get(['/admin','/admin/*splat'], pub('admin.html'));
app.get(['/about','/about.html'], pub('about.html'));
app.get(['/work','/work.html'], pub('work.html'));
app.get(['/','/index.html','/*splat'], pub('index.html'));

connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Onix server at port ${PORT}`));
});
