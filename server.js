// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// ---------- Middlewares ----------
app.use(express.json());

// CORS
const allowed = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin), false);
  },
  credentials: true
}));

// ---------- DB ----------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI belum diset di .env');
  process.exit(1);
}
mongoose.connect(MONGO_URI).then(() => {
  console.log('✅ MongoDB connected');
  seedProductsIfEmpty();
}).catch(err => {
  console.error('❌ MongoDB error:', err);
});

// ---------- Schemas ----------
const RekeningSchema = new mongoose.Schema({
  type: { type: String, enum: ['bank', 'ewallet'], default: 'bank' },
  number: String,
  name: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
  identifier: { type: String, unique: true }, // email / phone
  password: String,
  inviteCode: String,
  saldo: { type: Number, default: 0 },
  rekening: RekeningSchema
}, { timestamps: true });

const ProductSchema = new mongoose.Schema({
  name: String,
  price: Number,
  dailyIncome: Number,
  cycleDays: Number,
  totalIncome: Number,
  image: String
}, { timestamps: true });

const InvestmentSchema = new mongoose.Schema({
  userId: mongoose.Types.ObjectId,
  productId: mongoose.Types.ObjectId,
  startAt: Date,
  daysPaid: { type: Number, default: 0 }, // sudah berapa hari dibayar
  nextPayoutAt: Date, // jadwal payout berikutnya
  finished: { type: Boolean, default: false }
}, { timestamps: true });

const TxSchema = new mongoose.Schema({
  userId: mongoose.Types.ObjectId,
  type: { type: String, enum: ['topup', 'withdraw', 'buy', 'payout'] },
  amount: Number,
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  note: String
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Investment = mongoose.model('Investment', InvestmentSchema);
const Tx = mongoose.model('Tx', TxSchema);

// ---------- Helpers ----------
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
function makeToken(user) {
  return jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(t, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}
function adminGuard(req, res, next) {
  if ((req.headers['x-admin-key'] || '') !== (process.env.ADMIN_KEY || '')) {
    return res.status(401).json({ message: 'Invalid admin key' });
  }
  next();
}

async function seedProductsIfEmpty() {
  const count = await Product.countDocuments();
  if (count > 0) return;
  const list = [
    { name: 'Paket A', price: 100000, dailyIncome: 3000, cycleDays: 30 },
    { name: 'Paket B', price: 150000, dailyIncome: 4700, cycleDays: 30 },
    { name: 'Paket C', price: 200000, dailyIncome: 6500, cycleDays: 30 },
    { name: 'Paket D', price: 250000, dailyIncome: 8200, cycleDays: 30 },
    { name: 'Paket E', price: 300000, dailyIncome: 10000, cycleDays: 30 },
    { name: 'Paket F', price: 350000, dailyIncome: 11700, cycleDays: 30 },
    { name: 'Paket G', price: 500000, dailyIncome: 17000, cycleDays: 30 },
    { name: 'Paket H', price: 1000000, dailyIncome: 35000, cycleDays: 30 },
    { name: 'Paket I', price: 1500000, dailyIncome: 53000, cycleDays: 30 },
    { name: 'Paket J', price: 2000000, dailyIncome: 72000, cycleDays: 30 },
    { name: 'Paket K', price: 3000000, dailyIncome: 110000, cycleDays: 30 }
  ].map(p => ({ ...p, totalIncome: p.dailyIncome * p.cycleDays }));
  await Product.insertMany(list);
  console.log('🌱 Products seeded');
}

// Hitung & klaim payout harian (tanpa cron)
async function claimDailyPayouts(userId) {
  const now = new Date();
  const invs = await Investment.find({ userId, finished: false });
  let totalPaid = 0;

  for (const inv of invs) {
    const prod = await Product.findById(inv.productId);
    if (!prod) continue;

    // Set default nextPayoutAt saat pertama kali
    if (!inv.nextPayoutAt) {
      inv.nextPayoutAt = new Date(inv.startAt);
      inv.nextPayoutAt.setDate(inv.nextPayoutAt.getDate() + 1);
    }

    // Bayar untuk setiap hari yang sudah terlewati
    while (!inv.finished && inv.nextPayoutAt <= now) {
      await Tx.create({ userId, type: 'payout', amount: prod.dailyIncome, status: 'success', note: `Payout ${prod.name}` });
      totalPaid += prod.dailyIncome;
      inv.daysPaid += 1;

      if (inv.daysPaid >= prod.cycleDays) {
        inv.finished = true;
      } else {
        inv.nextPayoutAt.setDate(inv.nextPayoutAt.getDate() + 1);
      }
    }
    await inv.save();
  }

  if (totalPaid > 0) {
    await User.updateOne({ _id: userId }, { $inc: { saldo: totalPaid } });
  }
  return totalPaid;
}

// ---------- Routes ----------

// test
app.get('/', (req, res) => res.send('🚀 MoneyTrust API Ready'));

// Auth: register
app.post('/api/register', async (req, res) => {
  try {
    const { identifier, password, invite } = req.body;
    if (!identifier || !password) return res.status(400).json({ message: 'identifier & password required' });

    const exist = await User.findOne({ identifier });
    if (exist) return res.status(400).json({ message: 'Akun sudah terdaftar' });

    const hash = await bcrypt.hash(password, 10);
    const code = 'INV-' + uuidv4().slice(0, 6).toUpperCase();

    const user = await User.create({ identifier, password: hash, inviteCode: code, saldo: 0 });
    const token = makeToken(user);

    await Tx.create({ userId: user._id, type: 'buy', amount: 0, status: 'success', note: `Register (invite ${invite || '-'})` });

    res.json({ message: 'Registrasi berhasil', token, inviteCode: code });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
});

// Auth: login
app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await User.findOne({ identifier });
    if (!user) return res.status(400).json({ message: 'Akun tidak ditemukan, silakan daftar dulu.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: 'Password salah' });

    const token = makeToken(user);
    res.json({ message: 'Login berhasil', token });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
});

// Auth: me
app.get('/api/auth/me', auth, async (req, res) => {
  const u = await User.findById(req.userId).lean();
  if (!u) return res.status(404).json({ message: 'User not found' });
  res.json({
    identifier: u.identifier,
    inviteCode: u.inviteCode,
    saldo: u.saldo,
    rekening: u.rekening || null
  });
});

// Auth: rekening
app.post('/api/auth/rekening', auth, async (req, res) => {
  const { type, number, name } = req.body;
  if (!type || !number || !name) return res.status(400).json({ message: 'Lengkapi data rekening' });
  await User.updateOne({ _id: req.userId }, { $set: { rekening: { type, number, name } } });
  res.json({ message: 'Rekening tersimpan' });
});

// Auth: change password
app.post('/api/auth/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const u = await User.findById(req.userId);
  const ok = await bcrypt.compare(oldPassword, u.password);
  if (!ok) return res.status(400).json({ message: 'Sandi lama salah' });
  u.password = await bcrypt.hash(newPassword, 10);
  await u.save();
  res.json({ message: 'Sandi berhasil diganti' });
});

// Auth: forgot (mock)
app.post('/api/auth/forgot', async (req, res) => {
  res.json({ message: 'Verifikasi terkirim (simulasi)' });
});

// Products
app.get('/api/products', async (req, res) => {
  const list = await Product.find().lean();
  res.json(list);
});

app.post('/api/products/buy', auth, async (req, res) => {
  const { productId } = req.body;
  const prod = await Product.findById(productId);
  const user = await User.findById(req.userId);
  if (!prod) return res.status(404).json({ message: 'Produk tidak ditemukan' });
  if (user.saldo < prod.price) return res.status(400).json({ message: 'Saldo tidak cukup' });

  user.saldo -= prod.price;
  await user.save();

  await Investment.create({
    userId: user._id,
    productId: prod._id,
    startAt: new Date(),
    daysPaid: 0,
    nextPayoutAt: null,
    finished: false
  });

  await Tx.create({ userId: user._id, type: 'buy', amount: prod.price, status: 'success', note: `Beli ${prod.name}` });

  res.json({ message: 'Pembelian berhasil: pendapatan harian akan dihitung otomatis setiap 24 jam saat Anda membuka aplikasi.' });
});

// Wallet
app.post('/api/wallet/topup', auth, async (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount < 100000) return res.status(400).json({ message: 'Minimal top-up Rp100.000' });
  const tx = await Tx.create({
    userId: req.userId,
    type: 'topup',
    amount,
    status: 'pending',
    note: `Metode: ${method || 'seabank'}`
  });
  res.json({
    message: 'Top-up dibuat. Bayar ke VA SeaBank 9015 0033 5473 lalu tunggu konfirmasi admin.',
    txId: tx._id
  });
});

app.post('/api/wallet/withdraw', auth, async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.userId);
  if (!user.rekening) return res.status(400).json({ message: 'Tambahkan rekening terlebih dahulu' });
  if (!amount || amount < 100000) return res.status(400).json({ message: 'Minimal penarikan Rp100.000' });
  if (user.saldo < amount) return res.status(400).json({ message: 'Saldo tidak cukup' });

  // saldo akan dikurangi saat admin konfirmasi (biar aman dari pending gagal)
  const tx = await Tx.create({
    userId: req.userId, type: 'withdraw', amount, status: 'pending',
    note: `Tarik ke ${user.rekening.type} • ${user.rekening.number} • ${user.rekening.name}`
  });
  res.json({ message: 'Penarikan diproses (maks 24 jam). Menunggu konfirmasi admin.', txId: tx._id });
});

app.get('/api/wallet/history', auth, async (req, res) => {
  const list = await Tx.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  res.json(list);
});

app.post('/api/wallet/claim', auth, async (req, res) => {
  const total = await claimDailyPayouts(req.userId);
  res.json({ message: 'Payout diklaim', amount: total });
});

// Admin confirm/reject
app.post('/api/admin/topup/:id/confirm', adminGuard, async (req, res) => {
  const tx = await Tx.findById(req.params.id);
  if (!tx || tx.type !== 'topup') return res.status(404).json({ message: 'Tx tidak ditemukan' });
  if (tx.status !== 'pending') return res.status(400).json({ message: 'Tx sudah diproses' });
  await User.updateOne({ _id: tx.userId }, { $inc: { saldo: tx.amount } });
  tx.status = 'success'; tx.note = (tx.note || '') + ' | confirmed';
  await tx.save();
  res.json({ message: 'Top-up confirmed' });
});

app.post('/api/admin/topup/:id/reject', adminGuard, async (req, res) => {
  const tx = await Tx.findById(req.params.id);
  if (!tx || tx.type !== 'topup') return res.status(404).json({ message: 'Tx tidak ditemukan' });
  if (tx.status !== 'pending') return res.status(400).json({ message: 'Tx sudah diproses' });
  tx.status = 'failed'; tx.note = (tx.note || '') + ' | rejected';
  await tx.save();
  res.json({ message: 'Top-up rejected' });
});

app.post('/api/admin/withdraw/:id/confirm', adminGuard, async (req, res) => {
  const tx = await Tx.findById(req.params.id);
  if (!tx || tx.type !== 'withdraw') return res.status(404).json({ message: 'Tx tidak ditemukan' });
  if (tx.status !== 'pending') return res.status(400).json({ message: 'Tx sudah diproses' });
  const user = await User.findById(tx.userId);
  if (user.saldo < tx.amount) return res.status(400).json({ message: 'Saldo user kurang saat konfirmasi' });
  user.saldo -= tx.amount; await user.save();
  tx.status = 'success'; tx.note = (tx.note || '') + ' | paid';
  await tx.save();
  res.json({ message: 'Withdraw paid' });
});

app.post('/api/admin/withdraw/:id/reject', adminGuard, async (req, res) => {
  const tx = await Tx.findById(req.params.id);
  if (!tx || tx.type !== 'withdraw') return res.status(404).json({ message: 'Tx tidak ditemukan' });
  if (tx.status !== 'pending') return res.status(400).json({ message: 'Tx sudah diproses' });
  tx.status = 'failed'; tx.note = (tx.note || '') + ' | rejected';
  await tx.save();
  res.json({ message: 'Withdraw rejected' });
});

// ---------- Start ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ API listening on :${PORT}`));
