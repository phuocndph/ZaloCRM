import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentMcpServer } from './modules/agents/agent-mcp-client.js';

try {
  const server = createAgentMcpServer(process.env.ZALOCRM_URL ?? '', process.env.ZALOCRM_AGENT_KEY ?? '');
  await server.connect(new StdioServerTransport());
} catch {
  // stdout is reserved for MCP; never log credential-bearing errors.
  console.error('ZaloCRM MCP failed to start. Check ZALOCRM_URL and ZALOCRM_AGENT_KEY.');
  process.exitCode = 1;
}
