import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAgentMcpServer } from '../../src/modules/agents/agent-mcp-client.js';

describe('Hermes MCP adapter', () => {
  it('requires HTTPS for non-local hosts and never accepts URL credentials', () => {
    expect(() => createAgentMcpServer('http://crm.example.com', 'zcrm_agent.test')).toThrow('HTTPS');
    expect(() => createAgentMcpServer('https://user:pass@crm.example.com', 'zcrm_agent.test')).toThrow();
  });
  it('discovers current tools and forwards arguments using the SDK protocol', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ tools: [{ name: 'list_work', description: 'List work', inputSchema: { type: 'object' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'AGENT_PERMISSION_DENIED' }), { status: 403 }));
    const server = createAgentMcpServer('http://127.0.0.1:3080', 'zcrm_agent.test', fetcher);
    const client = new Client({ name: 'test-hermes', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools[0].name).toBe('list_work');
      expect((await client.callTool({ name: 'list_work', arguments: { scope: 'all' } })).isError).toBe(false);
      expect((await client.callTool({ name: 'list_work', arguments: {} })).isError).toBe(true);
      expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer zcrm_agent.test' }, body: '{"scope":"all"}' });
    } finally { await client.close(); await server.close(); }
  });
});
