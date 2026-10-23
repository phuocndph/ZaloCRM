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
      if (url === '/ai/model-configs') {
        return {
          data: {
            modelConfigs: [
              {
                id: 'model-1',
                displayName: 'GPT-4o Nghiên cứu',
                externalModelId: 'gpt-4o',
                status: 'approved',
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

  it('hiển thị đầy đủ 3 bước: nguồn thông tin, nỗi đau khách hàng và bài viết chia sẻ', async () => {
    const wrapper = mount(CustomerResearchPanel);
    await flushPromises();

    expect(wrapper.text()).toContain('Tìm nỗi đau chủ khách sạn & Tạo bài chia sẻ');
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

  it('tạo đợt giao Hermes không yêu cầu chọn model ZCRM', async () => {
    const wrapper = mount(CustomerResearchPanel); await flushPromises();
    await wrapper.find('.header-actions .primary').trigger('click');
    const form = wrapper.find('form.research-modal');
    expect((form.find('select').element as HTMLSelectElement).value).toBe('hermes');
    expect(form.text()).not.toContain('Cấu hình mô hình AI sử dụng');
    mockPost.mockRejectedValueOnce({ response: { data: { error: 'Test create request only' } } });
    await form.trigger('submit'); await flushPromises();
    expect(mockPost).toHaveBeenCalledWith('/ai/research/projects', expect.objectContaining({ executor: 'hermes' }));
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
