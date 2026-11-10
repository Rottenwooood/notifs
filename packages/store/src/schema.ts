export const HUB_SCHEMA = `
CREATE TABLE identities (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE,
  manager INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE hub_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, stored_bytes INTEGER NOT NULL DEFAULT 0);
INSERT INTO hub_state(id) VALUES(1);
CREATE TABLE endpoints (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES identities(id),
  spec TEXT NOT NULL,
  next_send_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE subscriptions (
  name TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL REFERENCES endpoints(name),
  spec TEXT NOT NULL
);
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES identities(id),
  client_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  recipients TEXT NOT NULL,
  UNIQUE(source_id,client_id)
);
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL REFERENCES endpoints(name),
  state TEXT NOT NULL CHECK(state IN ('leased','received','held')),
  lease TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_message_active_batch ON batches(endpoint) WHERE state != 'received';
CREATE TABLE deliveries (
  message_id TEXT NOT NULL REFERENCES messages(id),
  message_seq INTEGER NOT NULL REFERENCES messages(seq),
  endpoint TEXT NOT NULL REFERENCES endpoints(name),
  state TEXT NOT NULL CHECK(state IN ('pending','leased','received','held')),
  batch_id TEXT REFERENCES batches(id),
  PRIMARY KEY(message_id,endpoint)
);
CREATE INDEX idx_message_queue ON deliveries(endpoint,state,message_seq);
CREATE INDEX idx_message_source ON messages(source_id,seq);
`;
