#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../server/src/config.ts';
import { clientToken, controllerToken } from '../../server/src/credentials.ts';
import { MessagingKernel } from '@notify-hub/core';
import { MESSAGE_HELP, runMessagingCLI } from './commands.ts';

async function main() {
  const positional: string[] = [];
  const flags: Record<string,string|true> = {};
  const argv = process.argv.slice(2);
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i]!;
    if (!arg.startsWith('--')) positional.push(arg);
    else {const key=arg.slice(2); if (['help','manager'].includes(key)) flags[key]=true; else if(argv[i+1] && !argv[i+1]!.startsWith('--')) flags[key]=argv[++i]!;else flags[key]=true;}
  }
  const allowed = new Set(['help','manager','config','type','content','to','id','wait','lease','token','socket','server']);
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
  if (!['identity','endpoint','subscription','message'].includes(cmd)) throw new Error('未知命令；运行 notifs help');
  await runMessagingCLI(positional,flags,config,clientToken(config.configDir));
}
main().catch(err=>{console.error(err instanceof Error ? err.message : String(err));process.exitCode=1;});
