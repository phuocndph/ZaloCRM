// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CustomerResearchPanel from './CustomerResearchPanel.vue';
import { useAuthStore } from '@/stores/auth';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/api/index', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

describe('CustomerResearchPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = {
      id: 'u1',
      email: 'owner@joliefam.vn',
      fullName: 'Chủ JolieFam',
      role: 'owner',
      orgId: 'org1',
      orgName: 'JolieFam',
      grants: {
        ai_model: { manage_secret: true },
        ai_knowledge: { access: true, create: true, edit: true, approve: true },
      },
    };

    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();

    mockGet.mockImplementation(async (url: string) => {
      if (url === '/ai/research/capabilities') {
        return {
          data: {
            search: { provider: 'serper_google', configured: true },
            publicWeb: { allowedDomains: ['vnexpress.net'] },
            facebook: { automaticGroupReading: false, manualImport: true },
            encryption: true,
            formats: ['article', 'zalo_message', 'checklist'],
          },
        };
      }
      if (url === '/ai/research/models') {
        return {
          data: {
            models: [
              {
                id: 'model-1',
                displayName: 'GPT-4o Nghiên cứu',
                externalModelId: 'gpt-4o',
                status: 'submitted',
                isDefault: true,
              },
            ],
            defaultModelConfigId: 'model-1',
            aiConfigRevision: '1',
          },
        };
      }
      if (url === '/ai/research/projects') {
        return {
          data: {
            projects: [
              {
                id: 'proj-1',
                orgId: 'org1',
                createdByUserId: 'u1',
                title: 'Nỗi đau giặt ủi khách sạn 3 sao',
                brief: 'Tìm khó khăn về chăn ga gối đệm và khăn tắm của chủ khách sạn',
                modelConfigId: 'model-1',
                status: 'active',
                revision: 1,
                maxQueries: 5,
                queriesUsed: 1,
                maxSources: 30,
                maxAiCalls: 10,
                aiCalls: 2,
                maxAiCostMicros: '1000000',
                aiCostMicros: '120000',
                createdAt: '2026-10-23T08:00:00Z',
                updatedAt: '2026-10-23T08:10:00Z',
              },
            ],
          },
        };
      }
      if (url === '/ai/research/projects/proj-1') {
        return {
          data: {
            id: 'proj-1',
            orgId: 'org1',
            createdByUserId: 'u1',
            title: 'Nỗi đau giặt ủi khách sạn 3 sao',
            brief: 'Tìm khó khăn về chăn ga gối đệm và khăn tắm của chủ khách sạn',
            modelConfigId: 'model-1',
            status: 'active',
            revision: 1,
            maxQueries: 5,
            queriesUsed: 1,
            maxSources: 30,
            maxAiCalls: 10,
            aiCalls: 2,
            maxAiCostMicros: '1000000',
            aiCostMicros: '120000',
            createdAt: '2026-10-23T08:00:00Z',
            updatedAt: '2026-10-23T08:10:00Z',
            sources: [{ status: 'read', _count: 1 }],
            pains: [{ status: 'draft', _count: 1 }],
            contents: [{ status: 'draft', _count: 1 }],
            tasks: [
              {
                id: 'task-1',
                kind: 'analyze',
                status: 'completed',
                cancelRequested: false,
                createdAt: '2026-10-23T08:05:00Z',
                completedAt: '2026-10-23T08:06:00Z',
              },
            ],
          },
        };
      }
      if (url === '/ai/research/projects/proj-1/sources') {
        return {
          data: {
            sources: [
              {
                id: 'src-1',
                orgId: 'org1',
                projectId: 'proj-1',
                title: 'Tâm sự chủ khách sạn phố cổ về khăn tắm ố vàng',
                url: 'https://www.facebook.com/groups/hotel/posts/123',
                canonicalKey: 'k1',
                kind: 'manual',
                status: 'read',
                speakerRole: 'owner',
                contentHash: 'h1',
                duplicateOfId: null,
                errorCode: null,
                publishedAt: null,
                readAt: '2026-10-23T08:01:00Z',
                createdAt: '2026-10-23T08:01:00Z',
                content: 'Khăn tắm trắng giặt dịch vụ bên ngoài chỉ 2 tháng là xỉn màu và thô ráp khiến khách chê.',
              },
            ],
          },
        };
      }
      if (url === '/ai/research/projects/proj-1/pains') {
        return {
          data: {
            pains: [
              {
                id: 'pain-1',
                orgId: 'org1',
                projectId: 'proj-1',
                taskId: 'task-1',
                title: 'Khăn tắm trắng nhanh xỉn màu và thô ráp khi giặt ngoài',
                detail: {
                  audience: 'Chủ khách sạn 2-3 sao thuê giặt bên ngoài',
                  situation: 'Sau khoảng 2 tháng giặt công nghiệp bằng hóa chất mạnh',
                  impact: 'Tốn chi phí thay khăn mới sớm, khách đánh giá thấp buồng phòng',
                  desire: 'Chọn loại sợi bền và quy trình giặt giữ độ mềm trắng lâu hơn',
                  uncertainty: 'Chưa rõ định lượng GSM hiện tại khách sạn đang dùng',
                  relevance: 'direct',
                  certainty: 'operator_source',
                },
                evidence: [
                  {
                    sourceId: 'src-1',
                    quote: 'Khăn tắm trắng giặt dịch vụ bên ngoài chỉ 2 tháng là xỉn màu và thô ráp khiến khách chê.',
                  },
                ],
                independentSources: 1,
                status: 'draft',
                revision: 1,
                mergedIntoId: null,
                approvedByUserId: null,
                approvedAt: null,
                createdAt: '2026-10-23T08:06:00Z',
                updatedAt: '2026-10-23T08:06:00Z',
              },
            ],
          },
        };
      }
      if (url === '/ai/research/projects/proj-1/contents') {
        return {
          data: {
            contents: [
              {
                id: 'cnt-1',
                orgId: 'org1',
                projectId: 'proj-1',
                painId: 'pain-1',
                taskId: 'task-2',
                rootId: null,
                version: 1,
                format: 'zalo_message',
                title: '3 dấu hiệu xưởng giặt đang làm hỏng khăn tắm khách sạn của anh/chị',
                body: 'Chào anh/chị, nhiều chủ khách sạn chia sẻ khăn trắng mới dùng 2 tháng đã xỉn màu...',
                evidence: [
                  {
                    sourceId: 'src-1',
                    quote: 'Khăn tắm trắng giặt dịch vụ bên ngoài chỉ 2 tháng là xỉn màu và thô ráp khiến khách chê.',
                  },
                ],
                missingInformation: ['Cần hỏi khách định lượng khăn hiện tại'],
                status: 'draft',
                painRevision: 1,
                approvedByUserId: null,
                approvedAt: null,
                createdAt: '2026-10-23T08:09:00Z',
              },
            ],
          },
        };
      }
      return { data: {} };
    });
  });

  it('thu gọn thiết lập mặc định, mở được khi cần và tìm đợt mà không tạo yêu cầu mới', async () => {
    const wrapper = mount(CustomerResearchPanel, { attachTo: document.body }); await flushPromises();
    expect(wrapper.get('.connection-settings').isVisible()).toBe(false);
    await wrapper.get('.connection-toolbar button').trigger('click');
    expect(wrapper.get('.connection-settings').isVisible()).toBe(true);
    expect(wrapper.get('.connection-toolbar button').attributes('aria-expanded')).toBe('true');
    const calls = mockGet.mock.calls.length;
    await wrapper.get('[aria-label="Tìm đợt nghiên cứu"]').setValue('không tồn tại');
    expect(wrapper.findAll('.project-card')).toHaveLength(0);
    expect(wrapper.text()).toContain('Không có đợt phù hợp');
    await wrapper.get('[aria-label="Tìm đợt nghiên cứu"]').setValue('giặt ủi');
    expect(wrapper.findAll('.project-card')).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(calls);
    expect(mockPost).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('chuyển bước bằng bàn phím và mở nguồn dẫn để đọc', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Nỗi đau khách hàng');
    expect(wrapper.get('.evidence-box').element.tagName).toBe('DETAILS');
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'End' });
    expect(wrapper.get('[aria-selected="true"]').text()).toContain('Bài viết chia sẻ');
    expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe('research-tab-contents');
    wrapper.unmount();
  });

  it('hiển thị đầy đủ 3 bước: nguồn thông tin, nỗi đau khách hàng và bài viết chia sẻ', async () => {
    const wrapper = mount(CustomerResearchPanel);
    await flushPromises();

    expect(wrapper.text()).toContain('Tìm nỗi đau & tạo bài');
    expect(wrapper.text()).toContain('Nỗi đau giặt ủi khách sạn 3 sao');
    expect(wrapper.text()).toContain('Tâm sự chủ khách sạn phố cổ về khăn tắm ố vàng');

    // Chuyển sang Bước 2: Nỗi đau khách hàng
    const stepButtons = wrapper.findAll('.step-tab');
    await stepButtons[1].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Khăn tắm trắng nhanh xỉn màu và thô ráp khi giặt ngoài');
    expect(wrapper.text()).toContain('Chủ khách sạn 2-3 sao thuê giặt bên ngoài');

    // Bấm duyệt vấn đề
    mockPatch.mockResolvedValueOnce({
      data: { id: 'pain-1', status: 'approved', revision: 2 },
    });
    const approveBtn = wrapper.find('.pain-actions .approve-btn');
    await approveBtn.trigger('click');
    await flushPromises();

    expect(mockPatch).toHaveBeenCalledWith(
      '/ai/research/projects/proj-1/pains/pain-1',
      expect.objectContaining({ revision: 1, status: 'approved' }),
    );

    // Chuyển sang Bước 3: Bài viết chia sẻ
    await stepButtons[2].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('3 dấu hiệu xưởng giặt đang làm hỏng khăn tắm khách sạn của anh/chị');
    expect(wrapper.text()).toContain('Cần hỏi khách định lượng khăn hiện tại');

    // Duyệt bài viết
    mockPost.mockResolvedValueOnce({
      data: { id: 'cnt-1', status: 'approved' },
    });
    const approveContentBtn = wrapper.find('.content-actions .approve-btn');
    await approveContentBtn.trigger('click');
    await flushPromises();

    expect(mockPost).toHaveBeenCalledWith(
      '/ai/research/projects/proj-1/contents/cnt-1/approve',
      {},
    );
  });

  it('tạo đợt chạy trực tiếp và tự khởi động tìm, đọc và tổng hợp', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    await wrapper.find('.header-actions .primary').trigger('click');
    const form = wrapper.find('form.research-modal');
    expect((form.find('select').element as HTMLSelectElement).value).toBe('model-1');
    expect(form.text()).not.toContain('Hermes');
    expect(form.text()).toContain('Tạo và bắt đầu tìm hiểu');
    mockPost.mockResolvedValueOnce({ data: { id: 'proj-1', executor: 'internal' } }).mockResolvedValueOnce({ data: { taskId: 'run', status: 'queued' } });
    await form.trigger('submit'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects', expect.objectContaining({ executor: 'internal', modelConfigId: 'model-1' }));
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects/proj-1/tasks', expect.objectContaining({ kind: 'research' }));
    wrapper.unmount();
  });

  it('xem nguồn sau số 60 và bỏ các ô đặt hạn mức', async () => {
    const originalGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, options?: { params?: { page?: number } }) => {
      if (url.endsWith('/proj-1/sources')) {
        const page = options?.params?.page ?? 1;
        return { data: { sources: Array.from({ length: page < 4 ? 25 : page === 4 ? 1 : 0 }, (_, i) => ({
          id: `src-${(page - 1) * 25 + i + 1}`, title: `Nguồn ${(page - 1) * 25 + i + 1}`, status: 'read',
          content: 'Nội dung nguồn đã đọc', speakerRole: 'unknown', createdAt: '2026-10-23T08:01:00Z',
        })) } };
      }
      return originalGet(url, options);
    });
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    expect(wrapper.findAll('.source-card')).toHaveLength(76);
    expect(wrapper.text()).toContain('Nguồn 76');
    expect(mockGet).toHaveBeenCalledWith('/ai/research/projects/proj-1/sources', { params: { page: 4 } });
    await wrapper.find('.header-actions .primary').trigger('click');
    const form = wrapper.find('form.research-modal');
    expect(form.findAll('input[type="number"]')).toHaveLength(0);
    expect(form.text()).toContain('không dừng vì ngân sách hoặc số lượt');
    wrapper.unmount();
  });

  it('chuyển đợt Hermes cũ sang ZCRM và giữ nguyên nguồn đã có', async () => {
    const originalGet = mockGet.getMockImplementation()!;
    let direct = false;
    mockGet.mockImplementation(async (url: string, options?: unknown) => {
      const result = await originalGet(url, options);
      if (url === '/ai/research/projects/proj-1') {
        result.data.executor = direct ? 'internal' : 'hermes';
        result.data.tasks = direct ? [] : [{ id: 'queued-task', kind: 'discover', status: 'queued', input: { executor: 'hermes' }, createdAt: '2026-10-23T13:00:00Z' }];
      }
      return result;
    });
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    expect(wrapper.find('.direct-switch').text()).toContain('Chuyển đợt này sang AI trong ZCRM');
    expect(wrapper.text()).not.toContain('zcrm_bridge.py');
    expect(mockGet).not.toHaveBeenCalledWith('/ai/research/hermes-status');
    mockPost.mockImplementationOnce(async () => { direct = true; return { data: { executor: 'internal' } }; });
    await wrapper.get('.direct-switch button').trigger('click'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects/proj-1/direct', { modelConfigId: 'model-1' });
    expect(wrapper.find('.direct-switch').exists()).toBe(false);
    expect(wrapper.findAll('.source-card')).toHaveLength(1);
    expect(wrapper.find('.research-start').text()).toContain('Tự tìm');
    wrapper.unmount();
  });

  it('chọn vấn đề để duyệt và viết bài bằng một yêu cầu, không tự gửi hay đăng bài', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    await wrapper.findAll('.step-tab')[1].trigger('click');
    await wrapper.get('.select-pain input').setValue(true);
    await wrapper.get('.batch-write select').setValue('article');
    mockPost.mockResolvedValueOnce({ data: { taskId: 'write', status: 'queued' } });
    await wrapper.get('.batch-write button').trigger('click'); await flushPromises();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects/proj-1/tasks', expect.objectContaining({ kind: 'generate_batch', pains: [{ painId: 'pain-1', revision: 1 }], format: 'article' }));
    expect(mockPatch).not.toHaveBeenCalled();
    expect(wrapper.get('.step-tab.active').text()).toContain('Bài viết chia sẻ');
    wrapper.unmount();
  });

  it('giữ mã yêu cầu khi kết nối lỗi để chạy lại không tạo thêm công việc', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    mockPost.mockRejectedValueOnce(new Error('network disconnected')).mockResolvedValueOnce({ data: { taskId: 'run', status: 'queued' } });
    await wrapper.get('.research-start button').trigger('click'); await flushPromises();
    await wrapper.get('.research-start button').trigger('click'); await flushPromises();
    expect(mockPost.mock.calls[0][1].idempotencyKey).toBe(mockPost.mock.calls[1][1].idempotencyKey);
    wrapper.unmount();
  });

  it('lưu mã tìm kiếm ngay trên trang và xóa mã khỏi ô nhập sau khi lưu', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    await wrapper.get('.search-setup input[type="password"]').setValue('search-secret');
    mockPost.mockResolvedValueOnce({ data: { configured: true } });
    await wrapper.get('.search-setup form').trigger('submit'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/search-connection', { apiKey: 'search-secret' });
    expect((wrapper.get('.search-setup input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).not.toContain('search-secret');
    wrapper.unmount();
  });

  it('đọc và tổng hợp nguồn đã thêm mà không cần kết nối Google', async () => {
    const originalGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, options?: unknown) => {
      const response = await originalGet(url, options);
      if (url === '/ai/research/capabilities') response.data.search.configured = false;
      return response;
    });
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    expect(wrapper.get('.research-start button').attributes('disabled')).toBeDefined();
    const sourceButton = wrapper.findAll('.action-group button').find((button) => button.text() === 'Đọc và tổng hợp nguồn đã thêm')!;
    expect(sourceButton.attributes('disabled')).toBeUndefined();
    mockPost.mockResolvedValueOnce({ data: { taskId: 'saved', status: 'queued' } });
    await sourceButton.trigger('click'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects/proj-1/tasks', expect.objectContaining({ kind: 'research', sourceMode: 'saved' }));
    wrapper.unmount();
  });

  it('tự tìm hội nhóm và hiển thị nhóm riêng, không coi đường dẫn là bằng chứng đã đọc', async () => {
    const originalGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, options?: unknown) => {
      const result = await originalGet(url, options);
      if (url.endsWith('/proj-1/sources')) result.data.sources.push({ id: 'group-1', title: 'Hội chủ khách sạn', url: 'https://www.facebook.com/groups/hotel/', kind: 'facebook_group', status: 'group_found', content: null });
      return result;
    });
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    expect(wrapper.get('[aria-label="Hội nhóm đã tìm thấy"]').text()).toContain('Hội chủ khách sạn');
    expect(wrapper.get('[aria-label="Hội nhóm đã tìm thấy"]').text()).toContain('chưa đọc bài bên trong');
    expect(wrapper.findAll('.source-card')).toHaveLength(1);
    mockPost.mockResolvedValueOnce({ data: { taskId: 'group-search', status: 'queued' } });
    const button = wrapper.findAll('button').find((button) => button.text() === 'Tự tìm hội nhóm Facebook')!;
    await button.trigger('click'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects/proj-1/tasks', expect.objectContaining({ kind: 'discover_groups' }));
    wrapper.unmount();
  });
  it('hiển thị lỗi AI dễ hiểu khi dịch vụ không hỗ trợ mô hình được chọn', async () => {
    const originalGet = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, options?: unknown) => {
      const result = await originalGet(url, options);
      if (url === '/ai/research/projects/proj-1') result.data.tasks = [{ id: 'failed', kind: 'research', status: 'failed', errorCode: 'INVALID_REQUEST', createdAt: '2026-10-23T08:00:00Z' }];
      return result;
    });
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    expect(wrapper.get('.task-info').text()).toContain('không hỗ trợ mô hình đã chọn');
    expect(wrapper.get('.task-info').text()).not.toContain('INVALID_REQUEST');
    wrapper.unmount();
  });
  it('cho phép thêm nguồn bài viết Facebook thủ công và chạy AI tổng hợp', async () => {
    const wrapper = mount(CustomerResearchPanel);
    await flushPromises();

    const addSourceBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Dán bài Facebook / Thêm nguồn'));
    expect(addSourceBtn).toBeDefined();
    await addSourceBtn!.trigger('click');

    const modalForm = wrapper.find('form.research-modal');
    const inputs = modalForm.findAll('input');
    await inputs[0].setValue('Bài đăng hỏi kinh nghiệm chọn bảo vệ đệm chống thấm');
    await inputs[1].setValue('https://www.facebook.com/groups/chukhachsan/posts/999');
    await modalForm.find('textarea').setValue('Bảo vệ đệm loại rẻ giặt 3 lần đã bong lớp chống thấm và gây sột soạt khi khách nằm.');
    await modalForm.find('input[type="checkbox"]').setValue(true);

    mockPost.mockResolvedValueOnce({
      data: { id: 'src-2', duplicate: false },
    });
    await modalForm.trigger('submit');
    await flushPromises();

    expect(mockPost).toHaveBeenCalledWith(
      '/ai/research/projects/proj-1/sources',
      expect.objectContaining({
        title: 'Bài đăng hỏi kinh nghiệm chọn bảo vệ đệm chống thấm',
        url: 'https://www.facebook.com/groups/chukhachsan/posts/999',
        permissionConfirmed: true,
      }),
    );
  });
});
