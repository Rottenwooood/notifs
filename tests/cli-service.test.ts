import { describe, expect, it } from 'vitest';
import { renderServiceUnit } from '../apps/cli/src/service.ts';

describe('systemd service unit', () => {
  it('runs the built CLI with explicit config and data directories', () => {
    const unit = renderServiceUnit({
      node: '/usr/bin/node', cli: '/opt/notifs/dist/cli.mjs',
      configDir: '/home/u/.config/notifs', dataDir: '/home/u/.local/share/notifs',
    });
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/notifs/dist/cli.mjs start');
    expect(unit).toContain('Environment=NOTIFS_CONFIG_DIR=/home/u/.config/notifs');
    expect(unit).toContain('Environment=NOTIFS_DATA_DIR=/home/u/.local/share/notifs');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });
});
