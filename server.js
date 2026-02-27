require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
['uploads', 'data', 'credentials'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Initialize database
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/floorplans', require('./routes/floorplan'));
app.use('/api', require('./routes/qrcode'));
app.use('/api/settings', require('./routes/settings'));

// Start server
app.listen(PORT, () => {
  console.log(`Bahn Express Room Booking running at http://localhost:${PORT}`);
});
