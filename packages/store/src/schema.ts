/**
 * 数据库 schema（§5.7）。迁移按数组顺序执行，已应用的版本记入 schema_migrations。
 * 用顺序 SQL 迁移：新增结构时往数组末尾追加一段，不要修改已发布的段。
 */
export const MIGRATIONS: string[] = [
  // v1 — 初始结构：接收 / 路由 / 转发 全链路所需的表
  `
  CREATE TABLE IF NOT EXISTS sources (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'push',        -- push | poller | managed
    token_hash    TEXT NOT NULL UNIQUE,
    dedup_ttl_sec INTEGER NOT NULL DEFAULT 86400,
    mapping_json  TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    owner         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS producers (
    id                TEXT PRIMARY KEY,
    source_id         TEXT REFERENCES sources(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,                   -- managed | poller
    status            TEXT,
    pid               INTEGER,
    config_json       TEXT,
    state_dir         TEXT,
    last_heartbeat_at TEXT,
    restart_count     INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    origin            TEXT,                            -- handwritten | agent_generated
    draft_path        TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    source_id        TEXT NOT NULL REFERENCES sources(id),
    producer_id      TEXT,
    type             TEXT NOT NULL,
    text             TEXT NOT NULL,
    title            TEXT,
    url              TEXT,
    severity         TEXT NOT NULL DEFAULT 'info',
    dedup_key        TEXT NOT NULL,
    at               TEXT NOT NULL,
    received_at      TEXT NOT NULL,
    data_json        TEXT NOT NULL DEFAULT '{}',
    dedup_expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_dedup    ON events(source_id, dedup_key, dedup_expires_at);
  CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at DESC);

  CREATE TABLE IF NOT EXISTS rules (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    priority      INTEGER NOT NULL DEFAULT 100,
    exclusive     INTEGER NOT NULL DEFAULT 0,
    when_json     TEXT NOT NULL,
    behavior_json TEXT,
    actions_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    format    TEXT NOT NULL DEFAULT 'text',
    title_tpl TEXT,
    body_tpl  TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL,
    config_json     TEXT NOT NULL DEFAULT '{}',
    enabled         INTEGER NOT NULL DEFAULT 1,
    rate_limit_json TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id),
    rule_id         TEXT,
    channel_id      TEXT NOT NULL REFERENCES channels(id),
    idempotency_key TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | sent | dead
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 8,
    next_attempt_at TEXT NOT NULL,
    not_before      TEXT,
    claimed_at      TEXT,
    last_error      TEXT,
    rendered_json   TEXT,
    provider_id     TEXT,
    created_at      TEXT NOT NULL,
    sent_at         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON deliveries(status, next_attempt_at);

  CREATE TABLE IF NOT EXISTS poller_state (
    producer_id   TEXT NOT NULL,
    key           TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (producer_id, key)
  );

  CREATE TABLE IF NOT EXISTS secrets (
    name       TEXT PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    at          TEXT NOT NULL,
    actor       TEXT,
    action      TEXT NOT NULL,
    target      TEXT,
    detail_json TEXT
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,                        -- reminder | todo | recurring
    title        TEXT NOT NULL,
    note         TEXT,
    due_at       TEXT,
    rrule        TEXT,
    tz           TEXT,
    next_run_at  TEXT,
    state        TEXT NOT NULL DEFAULT 'active',       -- active | fired | done | paused
    completed_at TEXT,
    catch_up     INTEGER NOT NULL DEFAULT 1,
    extra_json   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  `,
  // v2 — 单用户鉴权：会话表（口令散列与密钥已分别由 users/secrets 表承载）
  `
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `,
];
