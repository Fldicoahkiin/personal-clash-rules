PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('subscription', 'node')),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sources_profile_id_index ON sources(profile_id);

CREATE TABLE generated_outputs (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  etag TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, target)
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX share_links_profile_id_index ON share_links(profile_id);
