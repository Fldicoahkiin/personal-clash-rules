import type {
  NodeSettings,
  NodeSortMode,
} from "./node-transforms";

interface ProfileRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ProfileSummaryRow extends ProfileRow {
  enabled_source_count: number;
  node_count: number;
  link_count: number;
}

interface ProfileSettingsRow extends ProfileRow {
  include_pattern: string;
  exclude_pattern: string;
  rename_rules: string;
  sort_mode: NodeSortMode;
}

interface SourceRow {
  id: string;
  name: string;
  source_type: "subscription" | "node";
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface NormalizedNodesRow {
  node_count: number;
  generated_at: string;
}

interface ShareRow {
  id: string;
  name: string;
  enabled: number;
  created_at: string;
  revoked_at: string | null;
  token_ciphertext: string | null;
  token_iv: string | null;
}

interface PublishedNodesRow {
  profile_name: string;
  nodes_json: string | null;
  generated_at: string | null;
}

interface StoredSourceRow {
  source_type: "subscription" | "node";
  secret_ciphertext: string;
  secret_iv: string;
}

interface EditableSourceRow {
  profile_id: string;
  name: string;
  source_type: "subscription" | "node";
  enabled: number;
}

interface RefreshRow {
  id: string;
  status: "running" | "succeeded" | "failed";
  node_count: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

function profileJson(row: ProfileRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nodeSettingsJson(row: ProfileSettingsRow): NodeSettings {
  return {
    includePattern: row.include_pattern,
    excludePattern: row.exclude_pattern,
    renameRules: JSON.parse(row.rename_rules) as NodeSettings["renameRules"],
    sortMode: row.sort_mode,
  };
}

export async function listProfiles(db: D1Database) {
  const result = await db.prepare(`
    SELECT
      profiles.*,
      (
        SELECT COUNT(*)
        FROM sources
        WHERE sources.profile_id = profiles.id AND sources.enabled = 1
      ) AS enabled_source_count,
      COALESCE((
        SELECT node_count
        FROM normalized_nodes
        WHERE normalized_nodes.profile_id = profiles.id
      ), 0) AS node_count,
      (SELECT COUNT(*) FROM share_links WHERE share_links.profile_id = profiles.id AND enabled = 1) AS link_count
    FROM profiles
    ORDER BY updated_at DESC
  `).all<ProfileSummaryRow>();

  return result.results.map((row) => ({
    ...profileJson(row),
    enabledSourceCount: row.enabled_source_count,
    nodeCount: row.node_count,
    linkCount: row.link_count,
  }));
}

export async function listRefreshableProfileIds(
  db: D1Database,
  limit: number,
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT profiles.id
    FROM profiles
    WHERE EXISTS (
      SELECT 1
      FROM sources
      WHERE sources.profile_id = profiles.id AND sources.enabled = 1
    )
    ORDER BY (
      SELECT MAX(refresh_runs.finished_at)
      FROM refresh_runs
      WHERE refresh_runs.profile_id = profiles.id
    ) ASC NULLS FIRST
    LIMIT ?
  `).bind(limit).all<{ id: string }>();

  return result.results.map((profile) => profile.id);
}

export async function createProfile(db: D1Database, name: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO profiles (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).bind(id, name, now, now).run();

  return { id, name, createdAt: now, updatedAt: now };
}

export async function renameProfile(
  db: D1Database,
  profileId: string,
  name: string,
) {
  const updatedAt = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE profiles
    SET name = ?, updated_at = ?
    WHERE id = ?
  `).bind(name, updatedAt, profileId).run();
  if (result.meta.changes === 0) {
    return null;
  }
  return { id: profileId, name, updatedAt };
}

export async function deleteProfile(db: D1Database, profileId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM profiles WHERE id = ?")
    .bind(profileId)
    .run();
  return result.meta.changes > 0;
}

export async function readProfile(db: D1Database, profileId: string) {
  const profile = await db.prepare(`
    SELECT
      id,
      name,
      include_pattern,
      exclude_pattern,
      rename_rules,
      sort_mode,
      created_at,
      updated_at
    FROM profiles
    WHERE id = ?
  `).bind(profileId).first<ProfileSettingsRow>();
  if (!profile) {
    return null;
  }

  const [sources, snapshot, refreshes] = await Promise.all([
    db.prepare(`
      SELECT id, name, source_type, enabled, created_at, updated_at
      FROM sources
      WHERE profile_id = ?
      ORDER BY created_at ASC
    `).bind(profileId).all<SourceRow>(),
    db.prepare(`
      SELECT node_count, generated_at
      FROM normalized_nodes
      WHERE profile_id = ?
    `).bind(profileId).first<NormalizedNodesRow>(),
    db.prepare(`
      SELECT id, status, node_count, error, started_at, finished_at
      FROM refresh_runs
      WHERE profile_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 8
    `).bind(profileId).all<RefreshRow>(),
  ]);

  const refreshHistory = refreshes.results.map(refreshJson);

  return {
    ...profileJson(profile),
    nodeSettings: nodeSettingsJson(profile),
    sources: sources.results.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.source_type,
      enabled: source.enabled === 1,
      createdAt: source.created_at,
      updatedAt: source.updated_at,
    })),
    nodeCount: snapshot?.node_count ?? 0,
    normalizedAt: snapshot?.generated_at ?? null,
    latestRefresh: refreshHistory[0] ?? null,
    refreshHistory,
  };
}

export async function readProfileLinks(db: D1Database, profileId: string) {
  const links = await db.prepare(`
    SELECT id, name, enabled, created_at, revoked_at, token_ciphertext, token_iv
    FROM share_links
    WHERE profile_id = ?
    ORDER BY created_at DESC
  `).bind(profileId).all<ShareRow>();
  return links.results;
}

export async function readConversionSources(db: D1Database, profileId: string) {
  const profile = await db.prepare(`
    SELECT
      id,
      name,
      include_pattern,
      exclude_pattern,
      rename_rules,
      sort_mode,
      created_at,
      updated_at
    FROM profiles
    WHERE id = ?
  `).bind(profileId).first<ProfileSettingsRow>();
  if (!profile) {
    return null;
  }
  const sources = await db.prepare(`
    SELECT source_type, secret_ciphertext, secret_iv
    FROM sources
    WHERE profile_id = ? AND enabled = 1
    ORDER BY created_at ASC
  `).bind(profileId).all<StoredSourceRow>();
  return {
    profile: profileJson(profile),
    nodeSettings: nodeSettingsJson(profile),
    sources: sources.results,
  };
}

export async function updateProfileNodeSettings(
  db: D1Database,
  profileId: string,
  settings: NodeSettings,
): Promise<NodeSettings | null> {
  const updatedAt = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE profiles
    SET
      include_pattern = ?,
      exclude_pattern = ?,
      rename_rules = ?,
      sort_mode = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    settings.includePattern,
    settings.excludePattern,
    JSON.stringify(settings.renameRules),
    settings.sortMode,
    updatedAt,
    profileId,
  ).run();
  return result.meta.changes > 0 ? settings : null;
}

export async function insertSource(
  db: D1Database,
  input: {
    profileId: string;
    name: string;
    type: "subscription" | "node";
    ciphertext: string;
    iv: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO sources (
      id, profile_id, name, source_type, secret_ciphertext, secret_iv, created_at, updated_at
    )
    SELECT ?, id, ?, ?, ?, ?, ?, ?
    FROM profiles
    WHERE id = ?
  `).bind(
    id,
    input.name,
    input.type,
    input.ciphertext,
    input.iv,
    now,
    now,
    input.profileId,
  ).run();

  if (result.meta.changes === 0) {
    return null;
  }

  await touchProfile(db, input.profileId, now);
  return {
    id,
    name: input.name,
    type: input.type,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deleteSource(db: D1Database, sourceId: string): Promise<boolean> {
  const source = await db.prepare(`
    SELECT profile_id
    FROM sources
    WHERE id = ?
  `).bind(sourceId).first<{ profile_id: string }>();
  if (!source) {
    return false;
  }

  await db.prepare("DELETE FROM sources WHERE id = ?").bind(sourceId).run();
  await touchProfile(db, source.profile_id, new Date().toISOString());
  return true;
}

export async function setSourceEnabled(
  db: D1Database,
  sourceId: string,
  enabled: boolean,
) {
  const source = await db.prepare(`
    SELECT profile_id
    FROM sources
    WHERE id = ?
  `).bind(sourceId).first<{ profile_id: string }>();
  if (!source) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE sources
    SET enabled = ?, updated_at = ?
    WHERE id = ?
  `).bind(enabled ? 1 : 0, updatedAt, sourceId).run();
  await touchProfile(db, source.profile_id, updatedAt);
  return { id: sourceId, enabled, updatedAt };
}

export async function readEditableSource(
  db: D1Database,
  sourceId: string,
): Promise<EditableSourceRow | null> {
  return db.prepare(`
    SELECT profile_id, name, source_type, enabled
    FROM sources
    WHERE id = ?
  `).bind(sourceId).first<EditableSourceRow>();
}

export async function updateSource(
  db: D1Database,
  sourceId: string,
  source: EditableSourceRow,
  input: {
    name: string;
    ciphertext?: string;
    iv?: string;
  },
) {
  const updatedAt = new Date().toISOString();
  if (input.ciphertext && input.iv) {
    await db.prepare(`
      UPDATE sources
      SET name = ?, secret_ciphertext = ?, secret_iv = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      input.name,
      input.ciphertext,
      input.iv,
      updatedAt,
      sourceId,
    ).run();
  } else {
    await db.prepare(`
      UPDATE sources
      SET name = ?, updated_at = ?
      WHERE id = ?
    `).bind(input.name, updatedAt, sourceId).run();
  }
  await touchProfile(db, source.profile_id, updatedAt);
  return {
    id: sourceId,
    name: input.name,
    type: source.source_type,
    enabled: source.enabled === 1,
    updatedAt,
  };
}

export async function replaceNormalizedNodes(
  db: D1Database,
  profileId: string,
  nodesJson: string,
  nodeCount: number,
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`
      INSERT INTO normalized_nodes (
        profile_id, nodes_json, node_count, generated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        nodes_json = excluded.nodes_json,
        node_count = excluded.node_count,
        generated_at = excluded.generated_at
    `).bind(profileId, nodesJson, nodeCount, now),
    db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").bind(now, profileId),
  ]);
}

export async function startRefresh(db: D1Database, profileId: string) {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO refresh_runs (id, profile_id, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).bind(id, profileId, startedAt).run();
  return { id, status: "running" as const, startedAt };
}

export async function finishRefresh(
  db: D1Database,
  input: {
    id: string;
    status: "succeeded" | "failed";
    nodeCount?: number;
    error?: string;
  },
) {
  const finishedAt = new Date().toISOString();
  await db.batch([
    db.prepare(`
      UPDATE refresh_runs
      SET status = ?, node_count = ?, target_count = NULL, error = ?, finished_at = ?
      WHERE id = ?
    `).bind(
      input.status,
      input.nodeCount ?? null,
      input.error ?? null,
      finishedAt,
      input.id,
    ),
    db.prepare(`
      DELETE FROM refresh_runs
      WHERE profile_id = (
        SELECT profile_id
        FROM refresh_runs
        WHERE id = ?
      )
      AND rowid NOT IN (
        SELECT rowid
        FROM refresh_runs
        WHERE profile_id = (
          SELECT profile_id
          FROM refresh_runs
          WHERE id = ?
        )
        ORDER BY started_at DESC, rowid DESC
        LIMIT 8
      )
    `).bind(input.id, input.id),
  ]);
  return {
    id: input.id,
    status: input.status,
    nodeCount: input.nodeCount ?? null,
    error: input.error ?? null,
    finishedAt,
  };
}

export async function insertShareLink(
  db: D1Database,
  input: {
    profileId: string;
    name: string;
    tokenHash: string;
    tokenCiphertext: string;
    tokenIv: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO share_links (
      id, profile_id, name, token_hash, token_ciphertext, token_iv, created_at
    )
    SELECT ?, id, ?, ?, ?, ?, ?
    FROM profiles
    WHERE id = ?
  `).bind(
    id,
    input.name,
    input.tokenHash,
    input.tokenCiphertext,
    input.tokenIv,
    now,
    input.profileId,
  ).run();

  if (result.meta.changes === 0) {
    return null;
  }

  await touchProfile(db, input.profileId, now);
  return { id, name: input.name, enabled: true, createdAt: now, revokedAt: null };
}

export async function revokeShareLink(db: D1Database, linkId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE share_links
    SET enabled = 0, revoked_at = ?
    WHERE id = ? AND enabled = 1
  `).bind(now, linkId).run();
  return result.meta.changes > 0;
}

export async function readPublishedNodes(
  db: D1Database,
  tokenHash: string,
): Promise<PublishedNodesRow | null> {
  return db.prepare(`
    SELECT
      profiles.name AS profile_name,
      normalized_nodes.nodes_json,
      normalized_nodes.generated_at
    FROM share_links
    JOIN profiles ON profiles.id = share_links.profile_id
    LEFT JOIN normalized_nodes ON normalized_nodes.profile_id = share_links.profile_id
    WHERE share_links.token_hash = ?
      AND share_links.enabled = 1
  `).bind(tokenHash).first<PublishedNodesRow>();
}

async function touchProfile(db: D1Database, profileId: string, updatedAt: string): Promise<void> {
  await db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?")
    .bind(updatedAt, profileId)
    .run();
}

function refreshJson(row: RefreshRow) {
  return {
    id: row.id,
    status: row.status,
    nodeCount: row.node_count,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
