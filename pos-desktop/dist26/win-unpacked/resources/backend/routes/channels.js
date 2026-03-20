const express = require('express');
const router = express.Router();

module.exports = (db) => {
  // GET /api/channels
  router.get('/', (req, res) => {
    db.all('SELECT * FROM channels ORDER BY channel_id', [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  return router;
}; 