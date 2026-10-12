/** 把 LLM 的输出解析成"文件集合"或"澄清问题"。 */

export interface ParsedGeneration {
  kind: 'files' | 'clarify';
  files: Record<string, string>;
  questions: string[];
}

const CLARIFY_RE = /^[#\s]*CLARIFY\s*$/im;
const FILE_RE = /^[#\s]*FILE:\s*(.+?)\s*$/gim;

function safePath(p: string): string | null {
  const clean = p.trim().replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.includes('..')) return null;
  return clean;
}

export function parseGeneration(text: string): ParsedGeneration {
  const hasFiles = FILE_RE.test(text);
  FILE_RE.lastIndex = 0;
  if (!hasFiles) {
    if (CLARIFY_RE.test(text)) {
      const idx = text.search(CLARIFY_RE);
      const questions = text
        .slice(idx)
        .split('\n')
        .slice(1)
        .map((l) => l.replace(/^\s*[-*\d.)\s]+/, '').trim())
        .filter(Boolean);
      return { kind: 'clarify', files: {}, questions };
    }
    throw new Error('LLM 输出既没有文件也没有澄清问题，无法解析');
  }

  const matches = [...text.matchAll(FILE_RE)];
  const files: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const path = safePath(m[1]!);
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    if (!path) continue;
    let chunk = text.slice(start, end);
    const fence = /^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(chunk);
    if (fence) chunk = fence[1]!;
    files[path] = chunk.replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n';
  }
  if (Object.keys(files).length === 0) throw new Error('LLM 输出里没有解析到任何合法文件路径');
  return { kind: 'files', files, questions: [] };
}

export function buildSystemPrompt(protocolDoc: string): string {
  return [
    '你是 notify-hub 的监控程序生成器。',
    '用户会用自然语言描述一个"当某处发生变化时提醒我"的需求，你要产出一个完整、可直接运行的监控程序目录。',
    '',
    '必须严格遵守下面的接入规范（这是唯一契约）：',
    '',
    '===== 接入规范开始 =====',
    protocolDoc,
    '===== 接入规范结束 =====',
    '',
    '输出格式（严格按此，不要有多余寒暄）：',
    '1) 如果关键信息不足（例如不知道要监控哪个地址/仓库/账号、认证方式、判定"什么算变化"），',
    '   只输出澄清问题：',
    '   ### CLARIFY',
    '   - 问题一',
    '   - 问题二',
    '2) 否则输出文件，每个文件一段，格式为：',
    '   ### FILE: <相对路径>',
    '   ```<语言>',
    '   <文件内容>',
    '   ```',
    '',
    '硬性要求：',
    '- 必须包含 producer.json。',
    '- kind=managed 时必须包含可执行入口（推荐 index.mjs，用 node 运行）。',
    '- producer.json 的可选配置写在 config 里；需要密钥时只把"名字"写进 credentials，绝对不要写密钥值。',
    '- 程序必须按规范发心跳、用稳定且唯一的 dedup_key、把断点写进自己的状态目录。',
    '- 不要引入不必要的依赖；标准库能做的就用标准库。',
  ].join('\n');
}
