// Loaded only inside the installed Harness runtime, not the ordinary Node app.
import { defineTool } from '../harness-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
import { harnessParameters } from './harness-schema.js';
import { markdownData } from './markdown-input.js';

export const name = 'dafeiyu-social-tools';
export const inject = ['tools'];
export async function apply(ctx) {
  const endpoint = process.env.DAFEIYU_BRIDGE_URL;
  const headers = { Authorization: `Bearer ${process.env.DAFEIYU_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${endpoint}/schemas?all=1`, { headers });
  if (!response.ok) throw new Error('大肥鱼工具连接失败');
  const schemas = await response.json();
  for (const { function: tool } of schemas) {
    const parameters = harnessParameters(tool.parameters);
    ctx.tools.register(defineTool({
      name: tool.name, description: tool.description, parameters,
      output: { schema: { type: 'json' }, render: (_args, result) => [{ type: 'text', text: markdownData(result) }] },
      async execute(args, exec) {
        const response = await fetch(`${endpoint}/tool`, {
          method: 'POST', headers, signal: exec.signal,
          body: JSON.stringify({ sessionId: exec.agent?.id, name: tool.name, args }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '大肥鱼工具请求失败');
        return result;
      },
    }));
  }
}
