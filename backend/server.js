// backend/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3")

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(bodyParser.json());

// ---------- SQLite SETUP ----------
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
const dbPath = path.join(dataDir, "ambulance.db");
const db = new Database(dbPath);
// ---------- HELPER: distance + ETA (AI-ish model) ----------
function toRad(v) {
  return (v * Math.PI) / 180;
}

// Haversine distance in km
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estimate ETA from distance (km) assuming avg city speed ~25 km/h
function estimateEtaMinutes(km) {
  if (!km || !isFinite(km)) return 5;
  const minutes = (km / 25) * 60;
  return Math.max(2, Math.round(minutes));
}


// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT NOT NULL UNIQUE,
    password TEXT,
    googleId TEXT
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    baseLocation TEXT NOT NULL,
    lat REAL,
    lng REAL
  );

  CREATE TABLE IF NOT EXISTS hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    location TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userEmail TEXT NOT NULL,
    userName TEXT NOT NULL,
    pickup TEXT NOT NULL,
    pickupLat REAL,
    pickupLng REAL,
    emergencyType TEXT NOT NULL,
    driverId INTEGER NOT NULL,
    driverName TEXT NOT NULL,
    driverEmail TEXT NOT NULL,
    driverVehicle TEXT NOT NULL,
    driverLocation TEXT NOT NULL,
    hospitalId INTEGER NOT NULL,
    hospitalName TEXT NOT NULL,
    hospitalEmail TEXT NOT NULL,
    hospitalLocation TEXT NOT NULL,
    eta INTEGER NOT NULL,
    status TEXT NOT NULL,
    driverNote TEXT DEFAULT '',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ---------- SERVE FRONTEND ----------
app.use(express.static(path.join(__dirname, "..", "public")));

// ==================== USER AUTH ====================

// EMAIL SIGNUP
app.post("/api/user/signup", (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const stmt = db.prepare(`
      INSERT INTO users (name, phone, email, password)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(name, phone || "", email, password);

    const user = db.prepare("SELECT id, name, phone, email FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.json({ message: "Signup success", user });
  } catch (err) {
    console.error("User signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// EMAIL LOGIN
app.post("/api/user/login", (req, res) => {
  const { email, password } = req.body;
  try {
    const user = db.prepare(
      "SELECT id, name, phone, email FROM users WHERE email = ? AND password = ?"
    ).get(email, password);

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ message: "Login success", user });
  } catch (err) {
    console.error("User login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GOOGLE LOGIN (simple demo)
app.post("/api/user/google-login", (req, res) => {
  const { name, email, googleId } = req.body;
  if (!email || !googleId) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  try {
    let user = db.prepare(
      "SELECT id, name, phone, email FROM users WHERE email = ?"
    ).get(email);

    if (!user) {
      const stmt = db.prepare(`
        INSERT INTO users (name, phone, email, password, googleId)
        VALUES (?, ?, ?, '', ?)
      `);
      const info = stmt.run(name || "Google User", "", email, googleId);
      user = db.prepare("SELECT id, name, phone, email FROM users WHERE id = ?").get(info.lastInsertRowid);
    }

    res.json({ message: "Google login success", user });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== DRIVER API ====================

// DRIVER SIGNUP
app.post("/api/driver/signup", (req, res) => {
  const { name, email, password, vehicle, baseLocation } = req.body;
  if (!name || !email || !password || !vehicle || !baseLocation) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const existing = db.prepare("SELECT id FROM drivers WHERE email = ?").get(email);
    if (existing) {
      return res.status(400).json({ message: "Driver already exists" });
    }

    const stmt = db.prepare(`
      INSERT INTO drivers (name, email, password, vehicle, baseLocation)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name, email, password, vehicle, baseLocation);

    const driver = db.prepare(
      "SELECT id, name, email, vehicle, baseLocation, lat, lng FROM drivers WHERE id = ?"
    ).get(info.lastInsertRowid);

    res.json({ message: "Driver registered", driver });
  } catch (err) {
    console.error("Driver signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// DRIVER LOGIN
app.post("/api/driver/login", (req, res) => {
  const { email, password } = req.body;
  try {
    const driver = db.prepare(
      "SELECT id, name, email, vehicle, baseLocation, lat, lng FROM drivers WHERE email = ? AND password = ?"
    ).get(email, password);

    if (!driver) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ message: "Login success", driver });
  } catch (err) {
    console.error("Driver login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// UPDATE DRIVER GPS LOCATION
app.post("/api/driver/location", (req, res) => {
  const { email, lat, lng } = req.body;
  try {
    const driver = db.prepare("SELECT id FROM drivers WHERE email = ?").get(email);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    db.prepare("UPDATE drivers SET lat = ?, lng = ? WHERE email = ?").run(lat, lng, email);
    res.json({ message: "Location updated" });
  } catch (err) {
    console.error("Driver location error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// DRIVER BOOKINGS LIST
// DRIVER BOOKINGS LIST (with optional date & limit)
// DRIVER BOOKINGS LIST (with optional date & limit)
app.get("/api/driver/bookings", (req, res) => {
  const { email, date } = req.query;
  try {
    let sql = "SELECT * FROM bookings WHERE driverEmail = ?";
    const params = [email];

    if (date) {
      // Filter by date (YYYY-MM-DD)
      sql += " AND DATE(createdAt) = DATE(?)";
      params.push(date);
    }

    sql += " ORDER BY createdAt DESC LIMIT 20"; // only last 20
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    console.error("Driver bookings error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// ==================== HOSPITAL API ====================

// HOSPITAL SIGNUP
app.post("/api/hospital/signup", (req, res) => {
  const { name, email, password, location } = req.body;
  if (!name || !email || !password || !location) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const existing = db.prepare("SELECT id FROM hospitals WHERE email = ?").get(email);
    if (existing) {
      return res.status(400).json({ message: "Hospital already exists" });
    }

    const stmt = db.prepare(`
      INSERT INTO hospitals (name, email, password, location)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(name, email, password, location);

    const hospital = db.prepare(
      "SELECT id, name, email, location FROM hospitals WHERE id = ?"
    ).get(info.lastInsertRowid);

    res.json({ message: "Hospital registered", hospital });
  } catch (err) {
    console.error("Hospital signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// HOSPITAL LOGIN
app.post("/api/hospital/login", (req, res) => {
  const { email, password } = req.body;
  try {
    const hospital = db.prepare(
      "SELECT id, name, email, location FROM hospitals WHERE email = ? AND password = ?"
    ).get(email, password);

    if (!hospital) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ message: "Login success", hospital });
  } catch (err) {
    console.error("Hospital login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// HOSPITAL BOOKINGS LIST (with driver live location)
// HOSPITAL BOOKINGS LIST (with driver live location + optional date & limit)
// HOSPITAL BOOKINGS LIST (with driver live location + optional date & limit)
app.get("/api/hospital/bookings", (req, res) => {
  const { email, date } = req.query;
  try {
    let sql = `
      SELECT b.*,
             d.lat AS driverLat,
             d.lng AS driverLng
      FROM bookings b
      LEFT JOIN drivers d ON d.id = b.driverId
      WHERE b.hospitalEmail = ?
    `;
    const params = [email];

    if (date) {
      sql += " AND DATE(b.createdAt) = DATE(?)";
      params.push(date);
    }

    sql += " ORDER BY b.createdAt DESC LIMIT 20";

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    console.error("Hospital bookings error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// ==================== BOOKINGS API ====================

// CREATE BOOKING
// CREATE BOOKING (AI picks nearest driver using GPS if available)
app.post("/api/bookings", (req, res) => {
  const {
    userEmail,
    userName,
    pickup,
    emergencyType,
    hospitalPref,
    pickupLat,
    pickupLng,
  } = req.body;

  if (!userEmail || !userName || !pickup || !emergencyType) {
    return res.status(400).json({ message: "Missing booking fields" });
  }

  try {
    // 1) Pick hospital (same logic as before)
    const hospitalAuto = db.prepare("SELECT * FROM hospitals ORDER BY id ASC LIMIT 1").get();
    if (!hospitalAuto) {
      return res.status(400).json({ message: "No hospital registered yet" });
    }

    let hospital = hospitalAuto;
    if (hospitalPref && hospitalPref !== "auto") {
      const byName = db.prepare("SELECT * FROM hospitals WHERE name = ?").get(hospitalPref);
      if (byName) hospital = byName;
    }

    // 2) AI-like driver selection based on distance
    // in /api/bookings
const allDrivers = db.prepare("SELECT * FROM drivers").all();
// ... choose nearest based on GPS
if (pickupLat && pickupLng) {
  let bestDist = Infinity;
  allDrivers.forEach((d) => {
    if (d.lat != null && d.lng != null) {
      const dist = distanceKm(pickupLat, pickupLng, d.lat, d.lng);
      if (dist < bestDist) {
        bestDist = dist;
        chosenDriver = d;   // 🔮 "AI" picks shortest-distance ambulance
      }
    }
  });
}


    // 3) AI ETA based on distance between pickup and chosen driver, else default
    let eta = 5;
    if (pickupLat && pickupLng && chosenDriver.lat != null && chosenDriver.lng != null) {
      const dist = distanceKm(pickupLat, pickupLng, chosenDriver.lat, chosenDriver.lng);
      eta = estimateEtaMinutes(dist);
    }

    const stmt = db.prepare(`
      INSERT INTO bookings (
        userEmail, userName, pickup, pickupLat, pickupLng,
        emergencyType, driverId, driverName, driverEmail,
        driverVehicle, driverLocation,
        hospitalId, hospitalName, hospitalEmail, hospitalLocation,
        eta, status, driverNote
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    `);

    const info = stmt.run(
      userEmail,
      userName,
      pickup,
      pickupLat || null,
      pickupLng || null,
      emergencyType,
      chosenDriver.id,
      chosenDriver.name,
      chosenDriver.email,
      chosenDriver.vehicle,
      chosenDriver.baseLocation,
      hospital.id,
      hospital.name,
      hospital.email,
      hospital.location,
      eta,
      "pending"
    );

    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
    res.json(booking);
  } catch (err) {
    console.error("Create booking error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// USER BOOKINGS + driver GPS
// USER BOOKINGS + driver GPS (limit last 10)
app.get("/api/bookings/by-user", (req, res) => {
  const { email } = req.query;
  try {
    const rows = db.prepare(`
      SELECT b.*,
             d.lat AS driverLat,
             d.lng AS driverLng
      FROM bookings b
      LEFT JOIN drivers d ON d.id = b.driverId
      WHERE b.userEmail = ?
      ORDER BY b.createdAt DESC
      LIMIT 10
    `).all(email);

    res.json(rows);
  } catch (err) {
    console.error("User bookings error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// DRIVER ACCEPT / UPDATE BOOKING
app.post("/api/bookings/:id/accept", (req, res) => {
  const { id } = req.params;
  const { driverNote } = req.body;

  try {
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    db.prepare(
      "UPDATE bookings SET status = ?, driverNote = ? WHERE id = ?"
    ).run("accepted", driverNote || "", id);

    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
    res.json(updated);
  } catch (err) {
    console.error("Accept booking error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- START SERVER ----------
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

app.listen(PORT, HOST, () => {
  const localIP = getLocalIP();
  console.log(`Server running with SQLite DB on http://localhost:${PORT}`);
  if (HOST === "0.0.0.0" || HOST === "::" || HOST === "") {
    console.log(`Accessible on your network at http://${localIP}:${PORT}`);
  } else {
    console.log(`Listening on ${HOST}:${PORT}`);
  }
});
