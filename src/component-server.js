import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { componentSchemas } from './component-catalog.js';
import { componentAction } from './component-actions.js';

const directory = path.resolve(process.argv[2] || 'data/components');
fs.mkdirSync(directory, { recursive: true });
if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('组件目录不能是符号链接');
let initialized = false;
const output = (id, result, error) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error: { code: -32602, message: error } } : { result }) }) + '\n');
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', line => {
  queue = queue.then(async () => {
    let message;
    try {
      if (Buffer.byteLength(line) > 64000) throw new Error('MCP请求过大');
      message = JSON.parse(line); if (message.id === undefined) return;
      if (message.method === 'initialize') { initialized = true; return output(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'dafeiyu-components', version: '1.0.0' } }); }
      if (!initialized) throw new Error('MCP尚未初始化');
      if (message.method === 'ping') return output(message.id, {});
      if (message.method === 'tools/list') return output(message.id, { tools: componentSchemas.map(s => ({ name: s.function.name.replace('mcp__dafeiyu__', ''), description: s.function.description, inputSchema: s.function.parameters })) });
      if (message.method !== 'tools/call' || !componentSchemas.some(s => s.function.name === `mcp__dafeiyu__${message.params?.name}`)) throw new Error('不支持的MCP方法或工具');
      try {
        const value = await componentAction(message.params.name, message.params.arguments || {}, message.params._meta || {}, directory);
        output(message.id, { content: [{ type: 'text', text: JSON.stringify(value) }] });
      } catch (error) { output(message.id, { isError: true, content: [{ type: 'text', text: error.message }] }); }
    } catch (error) { if (message?.id !== undefined) output(message.id, null, error.message); }
  });
});
