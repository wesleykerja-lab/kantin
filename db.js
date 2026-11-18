const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'kantin.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high performance and concurrent reads
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    category TEXT DEFAULT 'Makanan',
    icon TEXT DEFAULT '🍚',
    is_active INTEGER DEFAULT 1,
    is_available INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_date TEXT NOT NULL,
    queue_number INTEGER NOT NULL,
    queue_formatted TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    payment_method TEXT DEFAULT 'Tunai',
    amount_paid INTEGER DEFAULT 0,
    change_due INTEGER DEFAULT 0,
    cashier_name TEXT DEFAULT 'Kasir',
    order_notes TEXT DEFAULT '',
    status TEXT DEFAULT 'preparing',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    called_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_id INTEGER,
    menu_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    subtotal INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrations if columns don't exist yet
try { db.exec("ALTER TABLE orders ADD COLUMN order_notes TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE menus ADD COLUMN is_available INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE order_items ADD COLUMN notes TEXT DEFAULT '';"); } catch (e) {}

// Inisialisasi Pengaturan Default Toko / Kantin
const defaultSettings = {
  canteen_name: 'KANTIN SEKOLAH',
  canteen_address: 'Area Kantin Utama',
  canteen_phone: '0812-3456-7890',
  qris_image: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=KANTIN-PINTAR-POS',
  bank_name: 'BCA',
  bank_number: '8830-1234-5678',
  bank_holder: 'Kantin Sekolah Pintar',
  receipt_footer: 'Terima kasih atas kunjungan Anda!'
};

const setSelect = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
if (setSelect === 0) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }
}

// Inisialisasi Akun Pengguna Default jika belum ada
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (role, name, pin) VALUES (?, ?, ?)');
  insertUser.run('kasir', 'Kasir Kantin', '1234');
  insertUser.run('dapur', 'Petugas Dapur', '2222');
  insertUser.run('admin', 'Pemilik / Admin', '9999');
  console.log('✅ Akun pengguna kasir, dapur, dan admin berhasil dibuat.');
}

// Inisialisasi Menu Awal jika tabel kosong
const menuCount = db.prepare('SELECT COUNT(*) as count FROM menus').get().count;
if (menuCount === 0) {
  const insertMenu = db.prepare('INSERT INTO menus (name, price, category, icon, is_available) VALUES (?, ?, ?, ?, 1)');
  const defaultItems = [
    ['Nasi Goreng Spesial', 15000, 'Makanan', '🍚'],
    ['Nasi Uduk Komplit', 13000, 'Makanan', '🍚'],
    ['Spageti Bolognese', 16000, 'Makanan', '🍝'],
    ['Ayam Geprek + Nasi', 15000, 'Makanan', '🍗'],
    ['Mie Ayam Bakso', 14000, 'Makanan', '🍜'],
    ['Roti Bakar Cokelat', 10000, 'Snack', '🥪'],
    ['Pisang Goreng Keju', 8000, 'Snack', '🍌'],
    ['Es Teh Manis', 4000, 'Minuman', '🥤'],
    ['Jus Jeruk Segar', 7000, 'Minuman', '🍊'],
    ['Air Mineral Dingin', 3000, 'Minuman', '💧']
  ];
  for (const item of defaultItems) {
    insertMenu.run(...item);
  }
}

// Helpers
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- SETTINGS ---
function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result;
}

function updateSettings(settingsObj) {
  const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settingsObj)) {
    updateStmt.run(k, String(v));
  }
  return getAllSettings();
}

// --- USER & AUTH ---
function verifyPin(role, pin) {
  const user = db.prepare('SELECT id, role, name, pin FROM users WHERE role = ? AND pin = ?').get(role, pin);
  if (!user) return null;
  return { id: user.id, role: user.role, name: user.name };
}

function getAllUsers() {
  return db.prepare('SELECT id, role, name, pin FROM users').all();
}

function updatePin(role, newPin, newName) {
  if (newName) {
    db.prepare("UPDATE users SET pin = ?, name = ?, updated_at = datetime('now', 'localtime') WHERE role = ?").run(newPin, newName, role);
  } else {
    db.prepare("UPDATE users SET pin = ?, updated_at = datetime('now', 'localtime') WHERE role = ?").run(newPin, role);
  }
  return db.prepare('SELECT id, role, name FROM users WHERE role = ?').get(role);
}

// --- QUEUE & ORDERS ---
function getNextQueueNumber(dateStr) {
  const targetDate = dateStr || getTodayDateString();
  const stmt = db.prepare(`
    SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue 
    FROM orders 
    WHERE order_date = ?
  `);
  const row = stmt.get(targetDate);
  return row ? row.next_queue : 1;
}

function getAllMenus() {
  return db.prepare('SELECT * FROM menus WHERE is_active = 1 ORDER BY category ASC, name ASC').all();
}

function addMenu(name, price, category = 'Makanan', icon = '🍽️') {
  const stmt = db.prepare('INSERT INTO menus (name, price, category, icon, is_available) VALUES (?, ?, ?, ?, 1)');
  const result = stmt.run(name, price, category, icon);
  return db.prepare('SELECT * FROM menus WHERE id = ?').get(result.lastInsertRowid);
}

function updateMenu(id, name, price, category, icon) {
  const stmt = db.prepare('UPDATE menus SET name = ?, price = ?, category = ?, icon = ? WHERE id = ?');
  stmt.run(name, price, category, icon, id);
  return db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
}

function toggleMenuAvailability(id, isAvailable) {
  const stmt = db.prepare('UPDATE menus SET is_available = ? WHERE id = ?');
  stmt.run(isAvailable ? 1 : 0, id);
  return db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
}

function deleteMenu(id) {
  const stmt = db.prepare('DELETE FROM menus WHERE id = ?');
  return stmt.run(id);
}

function createOrder({ items, totalAmount, paymentMethod = 'Tunai', amountPaid = 0, changeDue = 0, cashierName = 'Kasir', orderNotes = '' }) {
  const todayStr = getTodayDateString();
  const queueNum = getNextQueueNumber(todayStr);
  const queueFormatted = String(queueNum).padStart(3, '0');

  const orderStmt = db.prepare(`
    INSERT INTO orders (order_date, queue_number, queue_formatted, total_amount, payment_method, amount_paid, change_due, cashier_name, order_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing')
  `);
  const orderRes = orderStmt.run(todayStr, queueNum, queueFormatted, totalAmount, paymentMethod, amountPaid, changeDue, cashierName, orderNotes);
  const orderId = orderRes.lastInsertRowid;

  const itemStmt = db.prepare(`
    INSERT INTO order_items (order_id, menu_id, menu_name, price, qty, subtotal, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    itemStmt.run(orderId, item.id || null, item.name, item.price, item.qty, item.price * item.qty, item.notes || '');
  }

  return getOrderById(orderId);
}

function getOrderById(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return { ...order, items };
}

function getLastOrder() {
  const order = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return { ...order, items };
}

function getTodayOrders() {
  const todayStr = getTodayDateString();
  const orders = db.prepare(`
    SELECT * FROM orders 
    WHERE order_date = ? 
    ORDER BY id ASC
  `).all(todayStr);

  return orders.map(order => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return { ...order, items };
  });
}

function updateOrderStatus(id, status) {
  let stmt;
  if (status === 'ready') {
    stmt = db.prepare("UPDATE orders SET status = ?, called_at = datetime('now', 'localtime') WHERE id = ?");
  } else if (status === 'completed') {
    stmt = db.prepare("UPDATE orders SET status = ?, completed_at = datetime('now', 'localtime') WHERE id = ?");
  } else {
    stmt = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
  }
  stmt.run(status, id);
  return getOrderById(id);
}

function getHistoryOrders(startDate, endDate) {
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (startDate) {
    query += ' AND order_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND order_date <= ?';
    params.push(endDate);
  }
  query += ' ORDER BY id DESC';

  const orders = db.prepare(query).all(...params);
  return orders.map(order => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return { ...order, items };
  });
}

function getSalesSummary() {
  const todayStr = getTodayDateString();
  
  const todayStats = db.prepare(`
    SELECT 
      COUNT(*) AS total_transactions,
      COALESCE(SUM(total_amount), 0) AS total_revenue
    FROM orders 
    WHERE order_date = ? AND status != 'cancelled'
  `).get(todayStr);

  const monthStr = todayStr.slice(0, 7);
  const monthStats = db.prepare(`
    SELECT 
      COUNT(*) AS total_transactions,
      COALESCE(SUM(total_amount), 0) AS total_revenue
    FROM orders 
    WHERE order_date LIKE ? AND status != 'cancelled'
  `).get(`${monthStr}%`);

  const topItems = db.prepare(`
    SELECT 
      oi.menu_name,
      SUM(oi.qty) AS total_sold,
      SUM(oi.subtotal) AS total_sales
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY oi.menu_name
    ORDER BY total_sold DESC
    LIMIT 5
  `).all();

  return {
    today: todayStats,
    month: monthStats,
    topItems
  };
}

function clearAllOrders() {
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  return { success: true };
}

module.exports = {
  db,
  getTodayDateString,
  getNextQueueNumber,
  getAllSettings,
  updateSettings,
  verifyPin,
  getAllUsers,
  updatePin,
  getAllMenus,
  addMenu,
  updateMenu,
  toggleMenuAvailability,
  deleteMenu,
  createOrder,
  getOrderById,
  getLastOrder,
  getTodayOrders,
  updateOrderStatus,
  getHistoryOrders,
  getSalesSummary,
  clearAllOrders
};
