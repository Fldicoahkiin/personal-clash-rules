ALTER TABLE profiles ADD COLUMN include_pattern TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN exclude_pattern TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN rename_rules TEXT NOT NULL DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'source'
  CHECK (sort_mode IN ('source', 'name-asc', 'name-desc'));
