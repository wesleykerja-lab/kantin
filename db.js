const { createClient } = require('@libsql/client');

// Credentials Turso Cloud Database
const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://kantin-wesleykerja-lab.aws-ap-southeast-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTUwNzA3MjAsImlkIjoiMDFhMWYyODgtN2UwMS03YzJiLWJkOTgtZTU3ZDA1M2U2MWE3Iiwia2lkIjoiTC1EcE5TRzhRRHluaTk3bnVwNDN1Rko5V0xSMTczM0FNbERKZGtzdGZuWSIsInJpZCI6IjA1ZDgzNTRiLTc3Y2MtNDU3ZS04OTUwLTI2NTAzMDI1YWVmNiJ9.FKuclo6Z38dTjINkm3zGvoTto3aoD2KBQK4FMx6PlVWZWvLPB-qhjtHWqPp4TOsaEU1yvdNZMKjGMmuEHhcpAw';

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
});

// Helper: Ubah ResultSet dari libSQL menjadi array of plain objects
function rowsToObjects(res) {
  if (!res || !res.rows) return [];
  return res.rows.map(row => {
    const obj = {};
    if (res.columns) {
      res.columns.forEach((col, idx) => {
        obj[col] = row[col] !== undefined ? row[col] : row[idx];
      });
    } else {
      Object.assign(obj, row);
    }
    return obj;
  });
}

function firstRowToObject(res) {
  const list = rowsToObjects(res);
  return list.length > 0 ? list[0] : null;
}

// Inisialisasi Database Tables & Default Data
async function initDb() {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS menus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        category TEXT DEFAULT 'Makanan',
        icon TEXT DEFAULT '🍚',
        is_active INTEGER DEFAULT 1,
        is_available INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    await client.execute(`
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
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_id INTEGER,
        menu_name TEXT NOT NULL,
        price INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        subtotal INTEGER NOT NULL,
        notes TEXT DEFAULT ''
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Inisialisasi Akun Pengguna Default
    const uCount = await client.execute('SELECT COUNT(*) as c FROM users');
    if (Number(uCount.rows[0].c) === 0) {
      await client.execute({ sql: 'INSERT INTO users (role, name, pin) VALUES (?, ?, ?)', args: ['kasir', 'Kasir Kantin', '1234'] });
      await client.execute({ sql: 'INSERT INTO users (role, name, pin) VALUES (?, ?, ?)', args: ['dapur', 'Petugas Dapur', '2222'] });
      await client.execute({ sql: 'INSERT INTO users (role, name, pin) VALUES (?, ?, ?)', args: ['admin', 'Pemilik / Admin', '9999'] });
    }

    // Inisialisasi Pengaturan Default
    const sCount = await client.execute('SELECT COUNT(*) as c FROM settings');
    if (Number(sCount.rows[0].c) === 0) {
      const defaults = {
        canteen_name: 'KANTIN KITA',
        canteen_tagline: 'Sajian Lezat & Hangat',
        canteen_address: 'Area Kantin Utama',
        canteen_phone: '0812-3456-7890',
        canteen_email: '',
        canteen_website: '',
        qris_image: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=KANTIN-KITA-POS',
        bank_name: 'BCA',
        bank_number: '8830-1234-5678',
        bank_holder: 'Kantin Kita',
        receipt_header1: 'KANTIN KITA',
        receipt_header2: 'Sajian Lezat & Hangat',
        receipt_header3: '',
        receipt_footer: 'Terima kasih telah berbelanja di Kantin Kita!',
        receipt_footer2: 'Simpan struk ini sebagai bukti pembayaran.',
        receipt_show_logo: '1',
        receipt_show_date: '1',
        receipt_show_cashier: '1',
        receipt_show_queue: '1',
        receipt_show_price: '1',
        receipt_show_change: '1'
      };
      for (const [k, v] of Object.entries(defaults)) {
        await client.execute({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?)', args: [k, v] });
      }
    } else {
      // Tambah field baru kalau belum ada (untuk upgrade)
      const newFields = {
        canteen_tagline: 'Sajian Lezat & Hangat',
        canteen_email: '',
        canteen_website: '',
        receipt_header1: '',
        receipt_header2: '',
        receipt_header3: '',
        receipt_footer2: 'Simpan struk ini sebagai bukti pembayaran.',
        receipt_show_logo: '1',
        receipt_show_date: '1',
        receipt_show_cashier: '1',
        receipt_show_queue: '1',
        receipt_show_price: '1',
        receipt_show_change: '1'
      };
      for (const [k, v] of Object.entries(newFields)) {
        try {
          await client.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: [k, v] });
        } catch (e) {}
      }
    }

    // Inisialisasi Menu Awal jika kosong
    const mCount = await client.execute('SELECT COUNT(*) as c FROM menus');
    if (Number(mCount.rows[0].c) === 0) {
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
        await client.execute({ sql: 'INSERT INTO menus (name, price, category, icon, is_available) VALUES (?, ?, ?, ?, 1)', args: item });
      }
    }

    console.log('✅ Turso Database Siap Digunakan.');
  } catch (err) {
    console.error('❌ Error inisialisasi Turso:', err.message);
  }
}

// Jalankan inisialisasi awal
initDb();

// Helper Tanggal Hari Ini (YYYY-MM-DD)
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- SETTINGS ---
async function getAllSettings() {
  const res = await client.execute('SELECT key, value FROM settings');
  const rows = rowsToObjects(res);
  const result = {};
  for (const r of rows) {
    result[r.key] = r.value;
  }
  return result;
}

async function updateSettings(settingsObj) {
  for (const [k, v] of Object.entries(settingsObj)) {
    await client.execute({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [k, String(v)]
    });
  }
  return getAllSettings();
}

// --- USER & AUTH ---
async function verifyPin(role, pin) {
  const res = await client.execute({
    sql: 'SELECT id, role, name, pin FROM users WHERE role = ? AND pin = ?',
    args: [role, pin]
  });
  const user = firstRowToObject(res);
  if (!user) return null;
  return { id: user.id, role: user.role, name: user.name };
}

async function getAllUsers() {
  const res = await client.execute('SELECT id, role, name, pin FROM users');
  return rowsToObjects(res);
}

async function updatePin(role, newPin, newName) {
  if (newName) {
    await client.execute({
      sql: "UPDATE users SET pin = ?, name = ?, updated_at = datetime('now', 'localtime') WHERE role = ?",
      args: [newPin, newName, role]
    });
  } else {
    await client.execute({
      sql: "UPDATE users SET pin = ?, updated_at = datetime('now', 'localtime') WHERE role = ?",
      args: [newPin, role]
    });
  }
  const res = await client.execute({
    sql: 'SELECT id, role, name FROM users WHERE role = ?',
    args: [role]
  });
  return firstRowToObject(res);
}

// --- QUEUE & ORDERS ---
async function getNextQueueNumber(dateStr) {
  const targetDate = dateStr || getTodayDateString();
  const res = await client.execute({
    sql: 'SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue FROM orders WHERE order_date = ?',
    args: [targetDate]
  });
  const row = firstRowToObject(res);
  return row ? Number(row.next_queue) : 1;
}

async function getAllMenus() {
  const res = await client.execute('SELECT * FROM menus WHERE is_active = 1 ORDER BY category ASC, name ASC');
  return rowsToObjects(res);
}

async function addMenu(name, price, category = 'Makanan', icon = '🍽️') {
  const res = await client.execute({
    sql: 'INSERT INTO menus (name, price, category, icon, is_available) VALUES (?, ?, ?, ?, 1)',
    args: [name, price, category, icon]
  });
  const newId = res.lastInsertRowid;
  const item = await client.execute({ sql: 'SELECT * FROM menus WHERE id = ?', args: [newId] });
  return firstRowToObject(item);
}

async function updateMenu(id, name, price, category, icon) {
  await client.execute({
    sql: 'UPDATE menus SET name = ?, price = ?, category = ?, icon = ? WHERE id = ?',
    args: [name, price, category, icon, id]
  });
  const item = await client.execute({ sql: 'SELECT * FROM menus WHERE id = ?', args: [id] });
  return firstRowToObject(item);
}

async function toggleMenuAvailability(id, isAvailable) {
  await client.execute({
    sql: 'UPDATE menus SET is_available = ? WHERE id = ?',
    args: [isAvailable ? 1 : 0, id]
  });
  const item = await client.execute({ sql: 'SELECT * FROM menus WHERE id = ?', args: [id] });
  return firstRowToObject(item);
}

async function deleteMenu(id) {
  return client.execute({ sql: 'DELETE FROM menus WHERE id = ?', args: [id] });
}

async function createOrder({ items, totalAmount, paymentMethod = 'Tunai', amountPaid = 0, changeDue = 0, cashierName = 'Kasir', orderNotes = '' }) {
  const todayStr = getTodayDateString();
  const queueNum = await getNextQueueNumber(todayStr);
  const queueFormatted = String(queueNum).padStart(3, '0');

  const orderRes = await client.execute({
    sql: `INSERT INTO orders (order_date, queue_number, queue_formatted, total_amount, payment_method, amount_paid, change_due, cashier_name, order_notes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing')`,
    args: [todayStr, queueNum, queueFormatted, totalAmount, paymentMethod, amountPaid, changeDue, cashierName, orderNotes]
  });
  const orderId = orderRes.lastInsertRowid;

  for (const item of items) {
    await client.execute({
      sql: `INSERT INTO order_items (order_id, menu_id, menu_name, price, qty, subtotal, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [orderId, item.id || null, item.name, item.price, item.qty, item.price * item.qty, item.notes || '']
    });
  }

  return getOrderById(orderId);
}

async function getOrderById(id) {
  const orderRes = await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
  const order = firstRowToObject(orderRes);
  if (!order) return null;

  const itemsRes = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [id] });
  const items = rowsToObjects(itemsRes);
  return { ...order, items };
}

async function getLastOrder() {
  const orderRes = await client.execute('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
  const order = firstRowToObject(orderRes);
  if (!order) return null;

  const itemsRes = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [order.id] });
  const items = rowsToObjects(itemsRes);
  return { ...order, items };
}

async function getTodayOrders() {
  const todayStr = getTodayDateString();
  const ordersRes = await client.execute({
    sql: 'SELECT * FROM orders WHERE order_date = ? ORDER BY id ASC',
    args: [todayStr]
  });
  const orders = rowsToObjects(ordersRes);

  const result = [];
  for (const order of orders) {
    const itemsRes = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [order.id] });
    result.push({ ...order, items: rowsToObjects(itemsRes) });
  }
  return result;
}

async function updateOrderStatus(id, status) {
  if (status === 'ready') {
    await client.execute({
      sql: "UPDATE orders SET status = ?, called_at = datetime('now', 'localtime') WHERE id = ?",
      args: [status, id]
    });
  } else if (status === 'completed') {
    await client.execute({
      sql: "UPDATE orders SET status = ?, completed_at = datetime('now', 'localtime') WHERE id = ?",
      args: [status, id]
    });
  } else {
    await client.execute({
      sql: 'UPDATE orders SET status = ? WHERE id = ?',
      args: [status, id]
    });
  }
  return getOrderById(id);
}

async function getHistoryOrders(startDate, endDate) {
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

  const ordersRes = await client.execute({ sql: query, args: params });
  const orders = rowsToObjects(ordersRes);

  const result = [];
  for (const order of orders) {
    const itemsRes = await client.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [order.id] });
    result.push({ ...order, items: rowsToObjects(itemsRes) });
  }
  return result;
}

async function getSalesSummary() {
  const todayStr = getTodayDateString();

  const todayStatsRes = await client.execute({
    sql: "SELECT COUNT(*) AS total_transactions, COALESCE(SUM(total_amount), 0) AS total_revenue FROM orders WHERE order_date = ? AND status != 'cancelled'",
    args: [todayStr]
  });
  const todayStats = firstRowToObject(todayStatsRes) || { total_transactions: 0, total_revenue: 0 };

  const monthStr = todayStr.slice(0, 7) + '%';
  const monthStatsRes = await client.execute({
    sql: "SELECT COUNT(*) AS total_transactions, COALESCE(SUM(total_amount), 0) AS total_revenue FROM orders WHERE order_date LIKE ? AND status != 'cancelled'",
    args: [monthStr]
  });
  const monthStats = firstRowToObject(monthStatsRes) || { total_transactions: 0, total_revenue: 0 };

  const topItemsRes = await client.execute(`
    SELECT oi.menu_name, SUM(oi.qty) AS total_sold, SUM(oi.subtotal) AS total_sales
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY oi.menu_name
    ORDER BY total_sold DESC
    LIMIT 5
  `);
  const topItems = rowsToObjects(topItemsRes);

  return {
    today: todayStats,
    month: monthStats,
    topItems
  };
}

async function clearAllOrders() {
  await client.execute('DELETE FROM order_items');
  await client.execute('DELETE FROM orders');
  return { success: true };
}

module.exports = {
  client,
  initDb,
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
