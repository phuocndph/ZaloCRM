import { randomBytes } from 'node:crypto';

export type AgentExecutionScope = { allowedAccountIds: string[] };
declare module 'fastify' {
  interface FastifyRequest { agentScope?: AgentExecutionScope }
}
type Identity = { id: string; orgId: string; role: string; email: string; agentScope?: AgentExecutionScope };
const identities = new Map<string, { user: Identity; expiresAt: number; method: string; url: string }>();
// Single-use in-process capability. It is never returned to the external agent.
export function createInternalAgentIdentity(user: Identity, method: string, url: string) {
  const key = randomBytes(32).toString('hex');
  identities.set(key, { user, method, url, expiresAt: Date.now() + 10000 });
  return { key, dispose: () => identities.delete(key) };
}
export function consumeInternalAgentIdentity(key: string, method: string, url: string): Identity | null {
  const entry = identities.get(key);
  identities.delete(key);
  return entry && entry.expiresAt > Date.now() && entry.method === method && entry.url === url ? entry.user : null;
}
