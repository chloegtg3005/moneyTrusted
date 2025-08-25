const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// 🔗 ganti dengan connection string MongoDB Atlas kamu
mongoose.connect("mongodb+srv://<USER>:<PASSWORD>@cluster0.mongodb.net/moneytrusted", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// 📌 Model User
const userSchema = new mongoose.Schema({
  identifier: { type: String, unique: true }, // bisa email atau no HP
  password: String,
  invite: String,
  balance: { type: Number, default: 0 },
  invitationCode: { type: String, unique: true },
});

const User = mongoose.model("User", userSchema);

// 📌 Middleware Auth
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token tidak ada" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, "SECRET_KEY", (err, decoded) => {
    if (err) return res.status(403).json({ message: "Token tidak valid" });
    req.user = decoded;
    next();
  });
};

// ====================== ROUTES ======================

// 📌 Register
app.post("/auth/register", async (req, res) => {
  try {
    const { identifier, password, invite } = req.body;

    const existingUser = await User.findOne({ identifier });
    if (existingUser) return res.status(400).json({ message: "User sudah terdaftar" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      identifier,
      password: hashedPassword,
      invite,
      invitationCode: uuidv4().slice(0, 6).toUpperCase(),
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, "SECRET_KEY", { expiresIn: "1d" });

    res.json({ message: "Registrasi berhasil", token });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// 📌 Login
app.post("/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const user = await User.findOne({ identifier });
    if (!user) return res.status(400).json({ message: "User tidak ditemukan" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ message: "Password salah" });

    const token = jwt.sign({ id: user._id }, "SECRET_KEY", { expiresIn: "1d" });

    res.json({ message: "Login berhasil", token });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// 📌 Get Profile
app.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// 📌 Top Up
app.post("/wallet/topup", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount <= 0) return res.status(400).json({ message: "Jumlah tidak valid" });

    const user = await User.findById(req.user.id);
    user.balance += amount;
    await user.save();

    res.json({ message: "Top up berhasil", balance: user.balance });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// 📌 Withdraw
app.post("/wallet/withdraw", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.id);

    if (amount <= 0 || amount > user.balance)
      return res.status(400).json({ message: "Saldo tidak mencukupi" });

    user.balance -= amount;
    await user.save();

    res.json({ message: "Withdraw berhasil", balance: user.balance });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// 📌 Daily Claim (bonus harian)
app.post("/wallet/claim", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // misal klaim harian = Rp1.000
    user.balance += 1000;
    await user.save();

    res.json({ message: "Klaim harian berhasil", balance: user.balance });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan", error: err.message });
  }
});

// ====================== RUN ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
