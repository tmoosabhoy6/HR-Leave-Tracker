CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  its_id TEXT,
  department TEXT,
  currency TEXT,
  group_override TEXT CHECK (group_override IN ('iraqi','foreign')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL CHECK (type IN ('monthly','annual','sick','other')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','cancelled')),
  source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','admin')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decision_note TEXT
);
CREATE INDEX idx_requests_employee ON requests(employee_id);
CREATE INDEX idx_requests_status ON requests(status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
