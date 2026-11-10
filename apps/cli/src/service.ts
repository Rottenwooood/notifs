import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ServicePaths {
  node: string;
  cli: string;
  configDir: string;
  dataDir: string;
}

export function serviceFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd/user/notifs.service');
}

export function renderServiceUnit(paths: ServicePaths): string {
  return `[Unit]
Description=notifs subscription communication center
After=network.target

[Service]
Type=simple
ExecStart=${paths.node} ${paths.cli} start
Restart=on-failure
RestartSec=2
Environment=NODE_ENV=production
Environment=NOTIFS_CONFIG_DIR=${paths.configDir}
Environment=NOTIFS_DATA_DIR=${paths.dataDir}
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=false
ReadWritePaths=${paths.configDir} ${paths.dataDir}

[Install]
WantedBy=default.target
`;
}

export function installService(paths: ServicePaths, printOnly = false): string {
  const unit = renderServiceUnit(paths);
  const path = serviceFilePath();
  if (printOnly) return unit;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, unit, { mode: 0o644 });
  return path;
}

export function uninstallService(): string {
  const path = serviceFilePath();
  if (existsSync(path)) rmSync(path);
  return path;
}
