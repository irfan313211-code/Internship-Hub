const Database = require("better-sqlite3");

const db = new Database("internships.db");

// Enable foreign-key enforcement and improve concurrent access.
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS internships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    internship_type TEXT NOT NULL
      CHECK (internship_type IN ('paid', 'unpaid')),
    stipend INTEGER NOT NULL DEFAULT 0
      CHECK (stipend >= 0),
    is_remote INTEGER NOT NULL DEFAULT 0
      CHECK (is_remote IN (0, 1)),
    apply_url TEXT NOT NULL,
    deadline TEXT,
    created_at TEXT NOT NULL DEFAULT
      (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT
      (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

module.exports = db;