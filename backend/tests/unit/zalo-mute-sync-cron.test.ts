import { describe, expect, it } from 'vitest';

import { activeGroupMutes, muteUntilFromEntry } from '../../src/modules/zalo/zalo-mute-sync-cron.js';

describe('Zalo mute sync', () => {
  it('treats negative duration as an indefinite mute', () => {
    expect(muteUntilFromEntry({ id: 'group-1', duration: -1 }, 1_700_000_000_000)).toBeNull();
  });

  it('calculates timed mute expiry from Zalo unix seconds', () => {
    const until = muteUntilFromEntry({ id: 'group-1', duration: 3600, startTime: 1_700_000_000 }, 1_700_000_000_000);
    expect(until?.toISOString()).toBe(new Date(1_700_003_600_000).toISOString());
  });

  it('keeps active groups and removes expired entries', () => {
    const active = activeGroupMutes([
      { id: 'forever', duration: -1 },
      { id: 'timed', duration: 3600, startTime: 1_700_000_000 },
      { id: 'expired', duration: 60, startTime: 1_699_000_000 },
    ], 1_700_000_000_000);

    expect([...active.keys()]).toEqual(['forever', 'timed']);
    expect(active.get('forever')).toBeNull();
    expect(active.get('timed')).toBeInstanceOf(Date);
  });
});
