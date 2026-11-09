export const MESSAGES_MIGRATION = `
CREATE TABLE message_config (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, stored_bytes INTEGER NOT NULL DEFAULT 0);
INSERT INTO message_config(id) VALUES(1);
CREATE TABLE message_endpoints (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES sources(id),
  spec TEXT NOT NULL,
  next_send_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE message_subscriptions (
  name TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL REFERENCES message_endpoints(name),
  spec TEXT NOT NULL
);
CREATE TABLE messages_v2 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  client_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  recipients TEXT NOT NULL,
  UNIQUE(source_id,client_id)
);
CREATE TABLE message_batches (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL REFERENCES message_endpoints(name),
  state TEXT NOT NULL CHECK(state IN ('leased','received','held')),
  lease TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_message_active_batch ON message_batches(endpoint) WHERE state != 'received';
CREATE TABLE message_deliveries (
  message_id TEXT NOT NULL REFERENCES messages_v2(id),
  message_seq INTEGER NOT NULL REFERENCES messages_v2(seq),
  endpoint TEXT NOT NULL REFERENCES message_endpoints(name),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','received','held')),
  batch_id TEXT REFERENCES message_batches(id),
  PRIMARY KEY(message_id,endpoint)
);
CREATE INDEX idx_message_queue ON message_deliveries(endpoint,state,message_seq);
CREATE INDEX idx_message_source ON messages_v2(source_id,seq);
`;
