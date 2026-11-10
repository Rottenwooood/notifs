#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../server/src/config.ts';
import { clientToken, controllerToken } from '../../server/src/credentials.ts';
import { MessagingKernel } from '@notify-hub/core';
import { backupDatabase } from '@notify-hub/store';
import { MESSAGE_HELP, runMessagingCLI } from './commands.ts';
import { installService, uninstallService } from './service.ts';

async function main() {
  const positional: string[] = [];
  const flags: Record<string,string|true> = {};
  const argv = process.argv.slice(2);
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i]!;
    if (!arg.startsWith('--')) positional.push(arg);
    else {const key=arg.slice(2); if (['help','manager'].includes(key)) flags[key]=true; else if(argv[i+1] && !argv[i+1]!.startsWith('--')) flags[key]=argv[++i]!;else flags[key]=true;}
  }
  const allowed = new Set(['help','manager','config','type','content','to','id','token','socket','server','print','force','name']);
  for (const key of Object.keys(flags)) if (!allowed.has(key)) throw new Error(`未知选项 --${key}`);
  const cmd = positional[0];
  if (!cmd || cmd === 'help' || flags.help) {console.log(MESSAGE_HELP); return;}
  const config = loadConfig();
  if (cmd === 'init') {
    mkdirSync(config.dataDir, {recursive:true,mode:0o700});
    const kernel = new MessagingKernel(config.dbPath, controllerToken(config.configDir)); kernel.close();
    console.log(JSON.stringify({identity:'owner',credential:join(config.configDir,'controller-token'),db:config.dbPath,server:config.baseUrl},null,2)); return;
  }
  if (cmd === 'start') {
    const bundle = fileURLToPath(new URL('./server.mjs',import.meta.url));
    const child = existsSync(bundle)
      ? spawn(process.execPath,[bundle],{stdio:'inherit'})
      : spawn(process.execPath,['--import','tsx',resolve('apps/server/src/main.ts')],{stdio:'inherit'});
    process.on('SIGINT',()=>child.kill('SIGINT')); process.on('SIGTERM',()=>child.kill('SIGTERM'));
    child.on('error',err=>{console.error(err.message);process.exitCode=1;});
    child.on('exit',(code,signal)=>process.exit(code ?? (signal ? 1 : 0))); return;
  }
  if (cmd === 'mcp') {
    const {startMcp}=await import('@notify-hub/mcp');
    await startMcp({baseUrl:config.baseUrl,token:clientToken(config.configDir),socketPath:typeof flags.socket==='string'?flags.socket:undefined}); return;
  }
  if (cmd === 'backup') {
    const target = positional[1];
    if (!target) throw new Error('backup 需要目标路径');
    if (existsSync(target)) throw new Error('备份目标已存在；不会覆盖');
    await backupDatabase(config.dbPath, target);
    console.log(JSON.stringify({ backup: target, source: config.dbPath }, null, 2));
    return;
  }
  if (cmd === 'restore') {
    const source = positional[1];
    if (!source) throw new Error('restore 需要备份路径');
    if (!existsSync(source)) throw new Error('备份文件不存在');
    if (flags.force !== true) throw new Error('restore 需要 --force；先停止 notifs 服务');
    rmSync(`${config.dbPath}-wal`, { force: true });
    rmSync(`${config.dbPath}-shm`, { force: true });
    copyFileSync(source, config.dbPath);
    console.log(JSON.stringify({ restored: source, target: config.dbPath, force: true }, null, 2));
    return;
  }
  if (cmd === 'service') {
    const action = positional[1];
    const unitName = typeof flags.name === 'string' ? flags.name : 'notifs';
    if (action === 'install') {
      const path = installService({
        node: process.execPath,
        cli: fileURLToPath(import.meta.url),
        configDir: config.configDir,
        dataDir: config.dataDir,
      }, flags.print === true, unitName);
      console.log(JSON.stringify({ service: path, unit: unitName, printOnly: flags.print === true }, null, 2));
      if (flags.print !== true) console.log(`下一步：systemctl --user daemon-reload && systemctl --user enable --now ${unitName}`);
      return;
    }
    if (action === 'uninstall') {
      console.log(JSON.stringify({ removed: uninstallService(unitName) }, null, 2));
      return;
    }
    throw new Error('service 只支持 install 或 uninstall');
  }
  if (!['identity','endpoint','subscription','message'].includes(cmd)) throw new Error('未知命令；运行 notifs help');
  await runMessagingCLI(positional,flags,config,clientToken(config.configDir));
}
main().catch(err=>{console.error(err instanceof Error ? err.message : String(err));process.exitCode=1;});
