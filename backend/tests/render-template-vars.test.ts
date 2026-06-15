import { describe, it, expect } from 'vitest';
import { shiftStylesForRender } from '../src/modules/automation/blocks/render-template.js';

// Test 8-biến (anh chốt 2026-06-15). Trọng tâm: applyVars/regex KHÔNG nuốt nhầm token
// ({name} vs {name_full}) + shiftStylesForRender dịch offset đúng cho token mới.
// resolveVars/applyVars là internal (cần DB) nên test qua shiftStylesForRender + manual replace.

const VALS = {
  gender: 'Anh', name: 'Lộc', name_full: 'Trần Văn Lộc',
  crm_full: 'Lộc Q7', crm_first: 'Lộc', crm_last: 'Q7',
  sale: 'Thành', sale_full: 'Phạm Chí Thành',
};

// Mô phỏng applyVars (cùng logic TOKEN_ORDER) để test không-nuốt-nhầm.
const TOKEN_ORDER = ['gender', 'name', 'name_full', 'crm_full', 'crm_first', 'crm_last', 'sale', 'sale_full'] as const;
function applyVars(raw: string, v: Record<string, string>): string {
  let out = raw;
  for (const k of TOKEN_ORDER) out = out.replaceAll(`{${k}}`, v[k]);
  return out;
}

describe('applyVars — không nuốt nhầm token con', () => {
  it('{name_full} KHÔNG bị {name} ăn mất phần đầu', () => {
    expect(applyVars('Chào {name_full}', VALS)).toBe('Chào Trần Văn Lộc');
  });
  it('{name} và {name_full} trong cùng câu — mỗi cái đúng giá trị', () => {
    expect(applyVars('{name} ({name_full})', VALS)).toBe('Lộc (Trần Văn Lộc)');
  });
  it('{sale} và {sale_full} không lẫn', () => {
    expect(applyVars('{sale} = {sale_full}', VALS)).toBe('Thành = Phạm Chí Thành');
  });
  it('full 8 biến render đúng', () => {
    const raw = '{gender} {name} {name_full} {crm_full} {crm_first} {crm_last} {sale} {sale_full}';
    expect(applyVars(raw, VALS)).toBe('Anh Lộc Trần Văn Lộc Lộc Q7 Lộc Q7 Thành Phạm Chí Thành');
  });
  it('token không tồn tại giữ nguyên', () => {
    expect(applyVars('Xin chào {unknown}', VALS)).toBe('Xin chào {unknown}');
  });
});

describe('shiftStylesForRender — dịch offset cho token MỚI', () => {
  it('token {crm_full} đứng trước vùng đậm → dời cả start', () => {
    // "Chào {crm_full}, ưu đãi" — đậm "ưu đãi" (start sau token)
    const raw = 'Chào {crm_full}, ưu đãi';
    const styleStart = raw.indexOf('ưu đãi');
    const styles = [{ st: 'b', start: styleStart, len: 6 }];
    const out = shiftStylesForRender(raw, styles, VALS);
    expect(out).not.toBeNull();
    // delta = len("Lộc Q7") − len("{crm_full}") = 6 − 10 = −4 → start dời −4
    const delta = [...VALS.crm_full].length - '{crm_full}'.length;
    expect(out![0].start).toBe(styleStart + delta);
    expect(out![0].len).toBe(6);
  });

  it('token {name_full} NẰM TRONG vùng đậm → giãn len', () => {
    // đậm cả "Chào {name_full}!"
    const raw = 'Chào {name_full}!';
    const styles = [{ st: 'b', start: 0, len: raw.length }];
    const out = shiftStylesForRender(raw, styles, VALS);
    expect(out).not.toBeNull();
    // {name_full}(11) → "Trần Văn Lộc"(12) delta +1 → len +1
    expect(out![0].len).toBe(raw.length + 1);
  });

  it('không có biến → giữ nguyên styles', () => {
    const styles = [{ st: 'b', start: 0, len: 4 }];
    expect(shiftStylesForRender('Chào bạn', styles, VALS)).toEqual(styles);
  });
});
