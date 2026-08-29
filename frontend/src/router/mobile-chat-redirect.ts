import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router';

export function mobileChatRedirect(input: {
  convId?: string;
  query: LocationQueryRaw;
  hash: string;
}): RouteLocationRaw {
  const common = { query: input.query, hash: input.hash };
  return input.convId
    ? { name: 'M.Chat', params: { convId: input.convId }, ...common }
    : { name: 'M.Conversations', ...common };
}
