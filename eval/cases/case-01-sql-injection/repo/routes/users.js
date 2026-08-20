const db = require('../db');

function getUserById(req, res) {
  const id = req.params.id;
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  db.query(query, (err, rows) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(rows[0]);
  });
}

module.exports = { getUserById };
