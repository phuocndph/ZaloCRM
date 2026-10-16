import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureBrowserAudio } from '../src/shared/media/audio-remux.js';
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(root.startsWith(path.join(tmpdir(), 'zcrm-audio-test-'))).toBe(true); await rm(root, { recursive: true, force: true }); } });
describe('browser audio conversion', () => {
  it('returns null for unsupported extensions instead of treating the source as its own cache', async () => {
    expect(await ensureBrowserAudio('voice.mp3')).toBeNull(); expect(await ensureBrowserAudio('voice.AMR')).toBeNull();
  });
  it('converts real AAC/AMR, deduplicates simultaneous requests and removes failed temporary output', async (context) => {
    try { await exec('ffmpeg', ['-version']); } catch { context.skip(); return; }
    const root = await mkdtemp(path.join(tmpdir(), 'zcrm-audio-test-')); roots.push(root);
    const source = path.join(root, 'voice.aac');
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-f', 'adts', source]);
    const [a, b] = await Promise.all([ensureBrowserAudio(source), ensureBrowserAudio(source)]);
    expect(a).toBe(`${source}.browser.m4a`); expect(b).toBe(a);
    expect((await readFile(a!)).subarray(4, 8).toString()).toBe('ftyp');
    const amr = path.join(root, 'voice.amr');
    const frames = Array.from({ length: 50 }, () => { const frame = Buffer.alloc(32); frame[0] = 0x3c; return frame; });
    await writeFile(amr, Buffer.concat([Buffer.from('#!AMR\n'), ...frames]));
    const convertedAmr = await ensureBrowserAudio(amr); expect(convertedAmr).toBe(`${amr}.browser.m4a`);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', convertedAmr!]);
    expect(stdout.trim()).toBe('aac');
    const corrupt = path.join(root, 'invalid.amr'); await writeFile(corrupt, 'not audio'); expect(await ensureBrowserAudio(corrupt)).toBeNull();
    expect((await readdir(root)).some((file) => file.includes('.tmp-'))).toBe(false);
  });
});
