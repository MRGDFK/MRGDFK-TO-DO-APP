// server.js
const express = require('express');
const path = require('path');
const engine = require('ejs-mate');           // layout engine for EJS
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const dayjs = require('dayjs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-prod';

// --- view engine (EJS + ejs-mate layouts)
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
  })
);

// expose helpers to templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.dayjs = dayjs;
  next();
});

const DEFAULT_BUCKETS = ['Life', 'Work', 'Daily'];

// --- auth guard
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// ---------- AUTH ROUTES ----------
app.get('/register', (req, res) => res.render('register', { title: 'Register', error: null }));

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.render('register', { title: 'Register', error: 'Fill all fields.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (name, email, password_hash) VALUES (?,?,?)`,
      [name, email.toLowerCase(), hash],
      function (err) {
        if (err) return res.render('register', { title: 'Register', error: 'Email already used.' });
        req.session.user = { id: this.lastID, name, email: email.toLowerCase() };
        res.redirect('/');
      }
    );
  } catch {
    res.render('register', { title: 'Register', error: 'Something went wrong.' });
  }
});

app.get('/login', (req, res) => res.render('login', { title: 'Login', error: null }));

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()], async (err, user) => {
    if (err || !user) return res.render('login', { title: 'Login', error: 'Invalid email or password.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render('login', { title: 'Login', error: 'Invalid email or password.' });
    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.redirect('/');
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

const SORT_SQL = (sort) => {
  switch ((sort || '').toLowerCase()) {
    case 'date':     return 'is_done ASC, (due_at IS NULL), due_at ASC, created_at DESC';
    case 'name':     return 'is_done ASC, LOWER(title) ASC';
    case 'priority': // High > Mid > Low
      return `is_done ASC,
              CASE priority WHEN 'High' THEN 1 WHEN 'Mid' THEN 2 ELSE 3 END ASC,
              created_at DESC`;
    case 'tag':      return 'is_done ASC, (tag IS NULL), tag ASC';
    default:         return 'is_done ASC, (due_at IS NULL), due_at ASC, created_at DESC';
  }
};

// ---------- APP ROUTES ----------
app.get('/', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const bucketFilter = req.query.bucket || 'All';
  const sort = req.query.sort || 'none';
  const where = bucketFilter === 'All' ? `WHERE user_id = ?` : `WHERE user_id = ? AND bucket = ?`;
  const params = bucketFilter === 'All' ? [userId] : [userId, bucketFilter];

  db.all(
    `SELECT * FROM tasks ${where}
     ORDER BY ${SORT_SQL(sort)}`,   // <-- use helper here
    params,
    (err, tasks) => {
      if (err) return res.status(500).send('DB error');

      db.all(`SELECT DISTINCT bucket FROM tasks WHERE user_id = ?`, [userId], (e2, rows) => {
        const dynamicBuckets = rows?.map(r => r.bucket) || [];
        const buckets = Array.from(new Set([...DEFAULT_BUCKETS, ...dynamicBuckets]));
        res.render('index', {
          title: 'Fastodo',
          tasks, buckets,
          activeBucket: bucketFilter,
          activeSort: sort
        });
      });
    }
  );
});

// create
app.post('/tasks', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const bucket = (req.body.bucket_custom?.trim() || req.body.bucket || 'Life');
  const { title, description, due_at, priority, tag, reminder_enabled } = req.body;

  db.run(
    `INSERT INTO tasks (user_id, title, description, bucket, due_at, priority, tag, reminder_enabled)
     VALUES (?,?,?,?,?,?,?,?)`,
    [userId, title, description || '', bucket, due_at || null, priority || 'Mid', tag || '', reminder_enabled ? 1 : 0],
    function (err) {
      if (err) return res.status(500).send('Insert error');
      res.redirect('/?bucket=' + encodeURIComponent(bucket));
    }
  );
});

// update
app.post('/tasks/:id', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const { title, description, bucket, due_at, priority, tag, reminder_enabled, is_done } = req.body;
  db.run(
    `UPDATE tasks SET
      title=?, description=?, bucket=?, due_at=?, priority=?, tag=?, reminder_enabled=?, is_done=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND user_id=?`,
    [title, description || '', bucket, due_at || null, priority || 'Mid', tag || '', reminder_enabled ? 1 : 0, is_done ? 1 : 0, req.params.id, userId],
    function (err) {
      if (err) return res.status(500).send('Update error');
      res.redirect('/?bucket=' + encodeURIComponent(bucket));
    }
  );
});

// toggle done (AJAX)
app.post('/tasks/:id/toggle', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  const { is_done } = req.body;
  db.run(
    `UPDATE tasks SET is_done=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
    [is_done ? 1 : 0, req.params.id, userId],
    function (err) {
      if (err) return res.status(500).json({ ok: false });
      res.json({ ok: true });
    }
  );
});

// delete
app.delete('/tasks/:id', requireLogin, (req, res) => {
  const userId = req.session.user.id;
  db.run(`DELETE FROM tasks WHERE id=? AND user_id=?`, [req.params.id, userId], function (err) {
    if (err) return res.status(500).send('Delete error');
    res.redirect('/');
  });
});

app.listen(PORT, () => console.log(`Task Manager running: http://localhost:${PORT}`));


