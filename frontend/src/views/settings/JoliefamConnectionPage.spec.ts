// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({settings:vi.fn(),saveSettings:vi.fn(),test:vi.fn(),get:vi.fn()}));
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({canAccess:()=>true})}));
vi.mock('@/api',()=>({api:{get:m.get}}));
vi.mock('@/api/commerce',async original=>({...await original<any>(),commerceApi:m}));
import Connection from './JoliefamConnectionPage.vue';
const config={enabled:false,basePath:'/api/zcrm/v1',hasToken:false,hasWebhookSecret:false,actorMap:{},encryptionReady:true,webhookPath:'/webhook'};
beforeEach(()=>{vi.clearAllMocks();m.settings.mockResolvedValue(config);m.get.mockResolvedValue({data:{users:[{id:'employee',fullName:'Nhân viên A',isActive:true}]}});});
describe('CRM connection screen',()=>{
  it('keeps setup and technical information closed until requested and selects employees by name',async()=>{
    const w=mount(Connection);await flushPromises(); expect(w.find('input[type="password"]').exists()).toBe(false);
    expect(w.findAll('details').every(d=>!d.attributes('open'))).toBe(true);
    const employees=w.findAll('details')[0]!;await employees.find('summary').trigger('click');
    await employees.findAll('button').find(b=>b.text()==='Thêm nhân viên')!.trigger('click');
    expect(employees.find('select').text()).toContain('Nhân viên A');
    expect(employees.findAll('input')).toHaveLength(1); w.unmount();
  });
  it('saves and verifies settings before offering the separate enable action',async()=>{
    const saved={...config,hasToken:true,hasWebhookSecret:true};
    m.saveSettings.mockResolvedValue(saved);m.test.mockResolvedValue({});
    const w=mount(Connection);await flushPromises();
    await w.findAll('button').find(b=>b.text()==='Thiết lập kết nối')!.trigger('click');
    await w.findAll('input[type="password"]')[0]!.setValue('test-token');
    await w.findAll('input[type="password"]')[1]!.setValue('test-webhook');
    m.settings.mockResolvedValue({...saved,testedAt:'2026-10-29T01:00:00Z'});
    await w.find('form').trigger('submit');await flushPromises();
    expect(m.saveSettings).toHaveBeenCalledWith(expect.objectContaining({enabled:false,token:'test-token',webhookSecret:'test-webhook'}));
    expect(m.test).toHaveBeenCalledOnce(); expect(m.saveSettings).toHaveBeenCalledOnce();
    expect(w.findAll('button').some(b=>b.text()==='Bật kết nối')).toBe(true);
    expect(w.find('input[type="password"]').exists()).toBe(false);w.unmount();
  });
});
