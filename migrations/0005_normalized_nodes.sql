CREATE TABLE normalized_nodes (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  nodes_json TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);

DROP TABLE generated_outputs;
