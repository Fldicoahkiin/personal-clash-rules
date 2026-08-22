CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  node_count INTEGER,
  target_count INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX refresh_runs_profile_id_index
  ON refresh_runs(profile_id, started_at DESC);
