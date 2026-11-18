const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

const PORT = process.env.PORT || 3000;

// Security: In-Memory Active Sessions Token Store
const sessions = new Map();

// Security: Rate Limiting PIN Login Attempts (Mencegah Brute Force)
const pinAttempts = new Map(); // ip -> { count, blockedUntil }

function checkRateLimit(ip) {
  const now = Date.now();
  const attempt = pinAttempts.get(ip);
  if (!attempt) return { allowed: true };

  if (attempt.blockedUntil && now < attempt.blockedUntil) {
    const remainingSecs = Math.ceil((attempt.blockedUntil - now) / 1000);
    return { allowed: false, remainingSecs };
  }

  if (now > attempt.resetAt) {
    pinAttempts.delete(ip);
    return { allowed: true };
  }

  if (attempt.count >= 5) {
    attempt.blockedUntil = now + (2 * 60 * 1000); // Blokir 2 menit
    return { allowed: false, remainingSecs: 120 };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const attempt = pinAttempts.get(ip) || { count: 0, resetAt: now + (5 * 60 * 1000) };
  attempt.count++;
  pinAttempts.set(ip, attempt);
}

function resetAttempts(ip) {
  pinAttempts.delete(ip);
}

// Middleware: Otentikasi Token & Role Keamanan (Anti-Bypass API)
function authenticate(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ error: 'Akses ditolak: Token autentikasi tidak ditemukan.' });
    }

    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const session = sessions.get(token);

    if (!session || Date.now() > session.expiresAt) {
      if (session) sessions.delete(token);
      return res.status(401).json({ error: 'Sesi login telah kedaluwarsa. Silakan login kembali.' });
    }

    // Periksa role jika ditentukan
    if (requiredRoles.length > 0 && !requiredRoles.includes(session.role) && session.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki wewenang untuk tindakan ini.' });
    }

    req.user = session;
    next();
  };
}

app.use(cors());
app.use(express.json({ limit: '5mb' })); // Support base64 image upload QRIS
app.use(express.static(path.join(__dirname, 'public')));

// Shortcut URL langsung untuk Layar TV Pengambilan (Bebas Login)
app.get('/tv', (req, res) => res.redirect('/?mode=display'));
app.get('/pengambilan', (req, res) => res.redirect('/?mode=display'));
app.get('/display', (req, res) => res.redirect('/?mode=display'));

// Helper: Cari IP LAN lokal komputer kasir
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// ==========================================
// AUTHENTICATION & LOGIN APIS (ANTI BRUTE-FORCE)
// ==========================================
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Terlalu banyak percobaan PIN salah. Demi keamanan, coba lagi dalam ${rateCheck.remainingSecs} detik.`
    });
  }

  try {
    const { role, pin } = req.body;
    if (!role || !pin) {
      return res.status(400).json({ error: 'Peran dan PIN wajib diisi.' });
    }

    const user = db.verifyPin(role, String(pin).trim());
    if (!user) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: 'PIN yang Anda masukkan salah. Silakan coba lagi.' });
    }

    // Login sukses: Reset catatan gagal & Buat Secure Session Token
    resetAttempts(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const sessionData = {
      id: user.id,
      role: user.role,
      name: user.name,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // Berlaku 24 jam
    };
    sessions.set(token, sessionData);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Info Server & IP untuk Tablet
app.get('/api/info', (req, res) => {
  const localIp = getLocalIpAddress();
  res.json({
    localIp,
    port: PORT,
    tabletUrl: `http://${localIp}:${PORT}`,
    today: db.getTodayDateString(),
    nextQueue: db.getNextQueueNumber(),
    settings: db.getAllSettings()
  });
});

// Settings Endpoints
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authenticate(['admin']), (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    io.emit('settings_updated', updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/users', authenticate(['admin']), (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/users/:role', authenticate(['admin']), (req, res) => {
  try {
    const { role } = req.params;
    const { pin, name } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ error: 'PIN minimal harus 4 digit angka.' });
    }
    const updated = db.updatePin(role, String(pin), name);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Menu Endpoints
app.get('/api/menus', (req, res) => {
  try {
    const menus = db.getAllMenus();
    res.json(menus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/menus', authenticate(['admin']), (req, res) => {
  try {
    const { name, price, category, icon } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: 'Nama dan harga menu wajib diisi.' });
    }
    const newMenu = db.addMenu(name, parseInt(price, 10), category || 'Makanan', icon || '🍽️');
    io.emit('menu_updated', db.getAllMenus());
    res.json(newMenu);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/menus/:id', authenticate(['admin']), (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category, icon } = req.body;
    const updated = db.updateMenu(id, name, parseInt(price, 10), category, icon);
    io.emit('menu_updated', db.getAllMenus());
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/menus/:id/availability', authenticate(['kasir', 'admin']), (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;
    const updated = db.toggleMenuAvailability(id, isAvailable);
    io.emit('menu_updated', db.getAllMenus());
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/menus/:id', authenticate(['admin']), (req, res) => {
  try {
    const { id } = req.params;
    db.deleteMenu(id);
    io.emit('menu_updated', db.getAllMenus());
    res.json({ success: true, message: 'Menu berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order Endpoints
app.get('/api/orders/today', (req, res) => {
  try {
    const orders = db.getTodayOrders();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/last', (req, res) => {
  try {
    const lastOrder = db.getLastOrder();
    res.json(lastOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/next-queue', (req, res) => {
  try {
    const nextQueue = db.getNextQueueNumber();
    res.json({ nextQueue, formatted: String(nextQueue).padStart(3, '0') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', (req, res) => {
  try {
    const { items, totalAmount, paymentMethod, amountPaid, changeDue, cashierName, orderNotes } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Daftar item pesanan kosong.' });
    }

    const order = db.createOrder({
      items,
      totalAmount,
      paymentMethod: paymentMethod || 'Tunai',
      amountPaid: amountPaid || totalAmount,
      changeDue: changeDue || 0,
      cashierName: cashierName || 'Kasir',
      orderNotes: orderNotes || ''
    });

    // Broadcast ke Tablet 2 (Dapur) & Kasir secara real-time
    io.emit('order_created', order);
    io.emit('next_queue_updated', {
      nextQueue: db.getNextQueueNumber(),
      formatted: String(db.getNextQueueNumber()).padStart(3, '0')
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updatedOrder = db.updateOrderStatus(id, status);
    
    // Broadcast status change ke semua tablet
    io.emit('order_status_changed', updatedOrder);
    res.json(updatedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint Panggil Suara
app.post('/api/orders/:id/call', (req, res) => {
  try {
    const { id } = req.params;
    const order = db.updateOrderStatus(id, 'ready');

    const payload = {
      orderId: order.id,
      queueNumber: order.queue_number,
      queueFormatted: order.queue_formatted,
      items: order.items,
      itemsSummary: order.items.map(i => `${i.qty}x ${i.menu_name}`).join(', '),
      calledAt: order.called_at
    };

    // Broadcast perintah panggil suara ke SEMUA tablet / TV display yang terhubung
    io.emit('order_called', payload);
    io.emit('order_status_changed', order);

    res.json({ success: true, payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint Hapus / Clear Semua Log Pencatatan & Reset Antrean (Hanya Admin)
app.post('/api/orders/clear-all', (req, res) => {
  try {
    const { pin } = req.body;
    const adminUser = db.verifyPin('admin', String(pin || '').trim());
    if (!adminUser) {
      return res.status(401).json({ error: 'PIN Admin salah. Masukkan PIN Admin untuk menghapus log pencatatan.' });
    }

    db.clearAllOrders();

    io.emit('orders_cleared');
    io.emit('next_queue_updated', {
      nextQueue: 1,
      formatted: '001'
    });

    res.json({ success: true, message: 'Semua log pencatatan berhasil dibersihkan.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Laporan & Rekap Penjualan
app.get('/api/reports/summary', (req, res) => {
  try {
    const summary = db.getSalesSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/history', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const history = db.getHistoryOrders(startDate, endDate);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EKSPOR KE FORMAT ASLI MICROSOFT EXCEL (.XLSX)
app.get('/api/reports/export-excel', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const orders = db.getHistoryOrders(startDate, endDate);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KantinPintar POS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Laporan Penjualan', {
      views: [{ showGridLines: true }]
    });

    worksheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'order_date', width: 14 },
      { header: 'Waktu', key: 'time', width: 12 },
      { header: 'No Antrean', key: 'queue_formatted', width: 14 },
      { header: 'Kasir', key: 'cashier_name', width: 20 },
      { header: 'Menu Pesanan', key: 'items', width: 38 },
      { header: 'Catatan', key: 'order_notes', width: 20 },
      { header: 'Total Belanja (Rp)', key: 'total_amount', width: 20 },
      { header: 'Metode Bayar', key: 'payment_method', width: 16 },
      { header: 'Status', key: 'status', width: 14 }
    ];

    // Styling Header Baris 1
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Navy Slate
      };
      cell.font = {
        name: 'Segoe UI',
        color: { argb: 'FFFFFFFF' },
        bold: true,
        size: 11
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    let totalRevenue = 0;

    orders.forEach((ord, index) => {
      const itemsStr = ord.items.map(i => `${i.qty}x ${i.menu_name}`).join(', ');
      const timeStr = ord.created_at ? ord.created_at.split(' ')[1] || '' : '';
      totalRevenue += Number(ord.total_amount) || 0;

      const row = worksheet.addRow({
        no: index + 1,
        order_date: ord.order_date,
        time: timeStr,
        queue_formatted: '#' + ord.queue_formatted,
        cashier_name: ord.cashier_name || 'Kasir',
        items: itemsStr,
        order_notes: ord.order_notes || '-',
        total_amount: Number(ord.total_amount) || 0,
        payment_method: ord.payment_method || 'Tunai',
        status: ord.status === 'completed' ? 'Selesai' : (ord.status === 'ready' ? 'Siap' : 'Disiapkan')
      });

      row.height = 22;
      row.getCell('no').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('order_date').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('time').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('queue_formatted').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('cashier_name').alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell('items').alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell('order_notes').alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell('payment_method').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' };

      const totalCell = row.getCell('total_amount');
      totalCell.numFmt = '#,##0';
      totalCell.alignment = { vertical: 'middle', horizontal: 'right' };

      if (index % 2 === 1) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        });
      }
    });

    // Baris Total Omzet
    const totalRow = worksheet.addRow({
      no: '',
      order_date: '',
      time: '',
      queue_formatted: '',
      cashier_name: '',
      items: 'TOTAL KESELURUHAN',
      order_notes: '',
      total_amount: totalRevenue,
      payment_method: '',
      status: ''
    });

    totalRow.height = 26;
    totalRow.getCell('items').font = { bold: true, size: 11 };
    totalRow.getCell('items').alignment = { vertical: 'middle', horizontal: 'right' };
    const grandTotalCell = totalRow.getCell('total_amount');
    grandTotalCell.font = { bold: true, size: 12, color: { argb: 'FFEA580C' } };
    grandTotalCell.numFmt = '#,##0';
    grandTotalCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const filename = `Laporan_Kantin_${startDate || 'all'}_sd_${endDate || 'all'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).send('Gagal mengekspor data: ' + err.message);
  }
});

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================
io.on('connection', (socket) => {
  socket.emit('init_data', {
    menus: db.getAllMenus(),
    todayOrders: db.getTodayOrders(),
    nextQueue: db.getNextQueueNumber(),
    nextFormatted: String(db.getNextQueueNumber()).padStart(3, '0'),
    settings: db.getAllSettings()
  });
});

// Jalankan Server
server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`\n======================================================`);
  console.log(`🚀 SISTEM POS KANTIN 2 TABLET AKTIF & AMAN`);
  console.log(`======================================================`);
  console.log(`💻 Buka di Komputer Kasir : http://localhost:${PORT}`);
  console.log(`📱 Buka di Tablet 1 (Kasir) : http://${localIp}:${PORT}?mode=kasir`);
  console.log(`📢 Buka di Tablet 2 (Dapur) : http://${localIp}:${PORT}?mode=panggilan`);
  console.log(`📺 Buka di Layar TV / Murid : http://${localIp}:${PORT}?mode=display`);
  console.log(`======================================================\n`);
});
