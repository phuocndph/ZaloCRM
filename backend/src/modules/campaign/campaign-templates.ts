// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Catalog mẫu chiến dịch hệ thống.
 *
 * Mẫu hệ thống là dữ liệu bất biến. "Sử dụng mẫu" luôn tạo workflow nháp
 * hoặc mở form tạo Outreach để người dùng chọn tệp/nick trước khi lưu.
 */
import {
  FOLLOWUP_TEMPLATES,
  getTemplate as getFollowupTemplate,
  templateDetail as followupDetail,
  templateSummary as followupSummary,
} from '../followup/followup-templates.js';

export type CampaignTemplateKind = 'followup' | 'outreach';

export interface OutreachCampaignTemplate {
  key: string;
  kind: 'outreach';
  source: 'system';
  name: string;
  category: string;
  tags: string[];
  version: number;
  goal: string;
  audience: string;
  shortDescription: string;
  intro: string;
  whenToUse: string[];
  endConditions: string[];
  expectedOutcome: string;
  config: {
    audienceSource: 'customer_list' | 'friend_pool';
    enableAutoAdd: boolean;
    addFriendMessage?: string;
    addDelayMinMs: number;
    addDelayMaxMs: number;
    maxAddPerDay: number;
    enableAutoMessage: boolean;
    waitAfterAddMinMs: number;
    waitAfterAddMaxMs: number;
    msgDelayMinMs: number;
    msgDelayMaxMs: number;
    maxMsgPerDay: number;
    filterRequireTags: string[];
    filterExcludeTags: string[];
    filterSkipChattedDays: number | null;
    filterFriendRelation: 'any' | 'friend_only' | 'non_friend_only';
    deduplicateContacts: boolean;
    templates: Array<{ title?: string; content: string; weight: number; imageAssetIds: string[] }>;
  };
}

const seconds = (value: number) => value * 1000;

const outreachTemplates: OutreachCampaignTemplate[] = [
  {
    key: 'outreach-warm-lead', kind: 'outreach', source: 'system', version: 1,
    name: 'Tiếp cận khách đã quan tâm', category: 'Khách mới',
    tags: ['khách mới', 'tệp SĐT', 'kết bạn'],
    goal: 'Kết bạn và mở cuộc trò chuyện đầu tiên',
    audience: 'Lead trong tệp đã xác minh Zalo, chưa là bạn với nick được giao',
    shortDescription: 'Lời mời lịch sự, chờ một khoảng ngắn rồi gửi tin mở đầu có tên khách.',
    intro: 'Mẫu cơ bản cho lead mới. Chỉ dùng với tệp có nguồn rõ ràng và nick đã được giao data.',
    whenToUse: ['Lead mới từ form hoặc tệp đã xác minh Zalo', 'Khách chưa từng trò chuyện với nick gửi'],
    endConditions: ['Đã gửi lời mời và tin mở đầu', 'Khách phản hồi hoặc bị loại bởi điều kiện gửi'],
    expectedOutcome: 'Tăng tỷ lệ kết bạn và tạo phản hồi đầu tiên mà không gửi dồn.',
    config: {
      audienceSource: 'customer_list', enableAutoAdd: true,
      addFriendMessage: 'Chào anh/chị {{name}}, em là bên Joliefam. Em xin phép kết bạn để gửi anh/chị thông tin phù hợp ạ.',
      addDelayMinMs: seconds(5), addDelayMaxMs: seconds(12), maxAddPerDay: 60,
      enableAutoMessage: true, waitAfterAddMinMs: seconds(90), waitAfterAddMaxMs: seconds(180),
      msgDelayMinMs: seconds(8), msgDelayMaxMs: seconds(18), maxMsgPerDay: 120,
      filterRequireTags: [], filterExcludeTags: ['Không làm phiền'], filterSkipChattedDays: 3,
      filterFriendRelation: 'non_friend_only', deduplicateContacts: true,
      templates: [
        { title: 'Mở đầu', content: 'Chào anh/chị {{name}}, em gửi anh/chị một số thông tin phù hợp để mình tham khảo khi cần ạ.', weight: 1, imageAssetIds: [] },
        { title: 'Mở đầu ngắn', content: 'Em chào anh/chị {{name}} ạ. Khi nào anh/chị cần thêm thông tin, em hỗ trợ ngay nhé.', weight: 1, imageAssetIds: [] },
      ],
    },
  },
  {
    key: 'outreach-quote-followup', kind: 'outreach', source: 'system', version: 1,
    name: 'Bám đuổi sau báo giá', category: 'Chốt đơn',
    tags: ['báo giá', 'chốt đơn', 'follow-up'],
    goal: 'Khách phản hồi và tiến tới quyết định mua',
    audience: 'Khách đã nhận báo giá nhưng chưa có cuộc trò chuyện gần đây',
    shortDescription: 'Tin nhắc lại nhẹ nhàng, loại khách vừa chat để tránh làm phiền.',
    intro: 'Dùng cho tệp đã có ngữ cảnh báo giá. Không nên dùng cho lead hoàn toàn mới.',
    whenToUse: ['Sau khi gửi báo giá 2–7 ngày', 'Khách chưa có phản hồi hoặc chưa chốt'],
    endConditions: ['Khách phản hồi', 'Khách có tag Không làm phiền', 'Đã gửi đủ giới hạn'],
    expectedOutcome: 'Khơi lại nhu cầu và đưa khách về cuộc trò chuyện với Sale.',
    config: {
      audienceSource: 'customer_list', enableAutoAdd: false,
      addDelayMinMs: seconds(5), addDelayMaxMs: seconds(12), maxAddPerDay: 60,
      enableAutoMessage: true, waitAfterAddMinMs: seconds(0), waitAfterAddMaxMs: seconds(0),
      msgDelayMinMs: seconds(15), msgDelayMaxMs: seconds(30), maxMsgPerDay: 80,
      filterRequireTags: ['Đã báo giá'], filterExcludeTags: ['Không làm phiền', 'Đã mua'],
      filterSkipChattedDays: 2, filterFriendRelation: 'friend_only', deduplicateContacts: true,
      templates: [
        { title: 'Nhắc báo giá', content: 'Em chào anh/chị {{name}} ạ. Anh/chị đã kịp xem báo giá bên em gửi chưa ạ? Em có thể điều chỉnh phương án nếu mình cần.', weight: 1, imageAssetIds: [] },
        { title: 'Gợi mở nhu cầu', content: 'Em hỏi thăm nhanh anh/chị {{name}}: hiện mình còn cần em giữ phương án báo giá trước đó không ạ?', weight: 1, imageAssetIds: [] },
      ],
    },
  },
  {
    key: 'outreach-reengage-old-lead', kind: 'outreach', source: 'system', version: 1,
    name: 'Đánh thức khách cũ', category: 'Đánh thức',
    tags: ['khách cũ', 'đánh thức', 'quan hệ'],
    goal: 'Khách cũ tương tác trở lại',
    audience: 'Khách đã từng có tương tác nhưng im lặng lâu ngày',
    shortDescription: 'Một lời hỏi thăm có lý do, gửi chậm và dừng sớm nếu khách không phản hồi.',
    intro: 'Ưu tiên giữ quan hệ. Không dùng thông điệp giảm giá dồn dập cho nhóm khách này.',
    whenToUse: ['Khách im lặng từ 30 ngày trở lên', 'Trước mùa cao điểm hoặc sản phẩm mới'],
    endConditions: ['Khách phản hồi', 'Đã chat trong thời gian lọc', 'Đã gửi một tin đánh thức'],
    expectedOutcome: 'Mở lại cuộc trò chuyện với khách cũ mà không tạo cảm giác spam.',
    config: {
      audienceSource: 'customer_list', enableAutoAdd: false,
      addDelayMinMs: seconds(8), addDelayMaxMs: seconds(15), maxAddPerDay: 40,
      enableAutoMessage: true, waitAfterAddMinMs: seconds(0), waitAfterAddMaxMs: seconds(0),
      msgDelayMinMs: seconds(20), msgDelayMaxMs: seconds(40), maxMsgPerDay: 50,
      filterRequireTags: ['Khách cũ'], filterExcludeTags: ['Không làm phiền'],
      filterSkipChattedDays: 30, filterFriendRelation: 'friend_only', deduplicateContacts: true,
      templates: [
        { title: 'Hỏi thăm', content: 'Chào anh/chị {{name}}, lâu rồi em chưa hỏi thăm. Công việc của anh/chị dạo này ổn không ạ?', weight: 1, imageAssetIds: [] },
      ],
    },
  },
  {
    key: 'outreach-post-sale-care', kind: 'outreach', source: 'system', version: 1,
    name: 'Chăm sóc sau bán', category: 'Sau bán',
    tags: ['sau bán', 'chăm sóc', 'phản hồi'],
    goal: 'Thu phản hồi sau khi khách nhận hàng',
    audience: 'Khách đã mua và đã nhận hàng',
    shortDescription: 'Hỏi trải nghiệm sau bán, không kết hợp bán thêm trong tin đầu tiên.',
    intro: 'Mẫu này ưu tiên chất lượng chăm sóc và phát hiện vấn đề sớm.',
    whenToUse: ['3–7 ngày sau khi khách nhận hàng', 'Sau khi Sale xác nhận giao hàng thành công'],
    endConditions: ['Khách phản hồi', 'Khách có tag Không làm phiền', 'Đã gửi tin chăm sóc'],
    expectedOutcome: 'Thu phản hồi thật và giảm nguy cơ khiếu nại do không được hỏi thăm.',
    config: {
      audienceSource: 'customer_list', enableAutoAdd: false,
      addDelayMinMs: seconds(8), addDelayMaxMs: seconds(15), maxAddPerDay: 40,
      enableAutoMessage: true, waitAfterAddMinMs: seconds(0), waitAfterAddMaxMs: seconds(0),
      msgDelayMinMs: seconds(20), msgDelayMaxMs: seconds(45), maxMsgPerDay: 50,
      filterRequireTags: ['Đã mua'], filterExcludeTags: ['Không làm phiền'],
      filterSkipChattedDays: 3, filterFriendRelation: 'friend_only', deduplicateContacts: true,
      templates: [
        { title: 'Hỏi trải nghiệm', content: 'Chào anh/chị {{name}}, mình dùng sản phẩm bên em thấy ổn không ạ? Nếu có điểm nào cần hỗ trợ, anh/chị nhắn em ngay nhé.', weight: 1, imageAssetIds: [] },
      ],
    },
  },
  {
    key: 'outreach-friend-welcome', kind: 'outreach', source: 'system', version: 1,
    name: 'Chào mừng bạn mới', category: 'Bạn bè',
    tags: ['friend pool', 'bạn mới', 'chào mừng'],
    goal: 'Mở lời tự nhiên với người vừa kết bạn',
    audience: 'Bạn bè đã kết bạn từ các nick Zalo được chọn',
    shortDescription: 'Gửi một lời chào sau khi kết bạn, không gửi lời mời kết bạn lần nữa.',
    intro: 'Dùng cho friend pool. Hệ thống sẽ gửi từ đúng nick đang sở hữu quan hệ bạn bè.',
    whenToUse: ['Sau khi quét hoặc đồng bộ bạn bè', 'Khi cần mở lời với bạn mới chưa trò chuyện'],
    endConditions: ['Đã gửi tin chào', 'Khách phản hồi hoặc bị loại bởi điều kiện gửi'],
    expectedOutcome: 'Tạo cuộc trò chuyện đầu tiên với bạn mới theo cách tự nhiên.',
    config: {
      audienceSource: 'friend_pool', enableAutoAdd: false,
      addDelayMinMs: seconds(0), addDelayMaxMs: seconds(0), maxAddPerDay: 0,
      enableAutoMessage: true, waitAfterAddMinMs: seconds(0), waitAfterAddMaxMs: seconds(0),
      msgDelayMinMs: seconds(20), msgDelayMaxMs: seconds(45), maxMsgPerDay: 120,
      filterRequireTags: [], filterExcludeTags: ['Không làm phiền'],
      filterSkipChattedDays: 7, filterFriendRelation: 'friend_only', deduplicateContacts: true,
      templates: [
        { title: 'Chào mừng', content: 'Chào bạn {{name}} nhé. Cảm ơn bạn đã kết nối, khi nào cần thông tin gì cứ nhắn mình ạ.', weight: 1, imageAssetIds: [] },
      ],
    },
  },
];

function outreachSummary(t: OutreachCampaignTemplate) {
  return {
    key: t.key, kind: t.kind, source: t.source, version: t.version,
    name: t.name, category: t.category, tags: t.tags, goal: t.goal,
    audience: t.audience, shortDescription: t.shortDescription,
    estimatedDays: 1, stepCount: t.config.enableAutoAdd ? 2 : 1,
    sendCount: t.config.templates.length, saleTaskCount: 0,
    audienceSource: t.config.audienceSource,
    safety: {
      maxAddPerDay: t.config.maxAddPerDay, maxMsgPerDay: t.config.maxMsgPerDay,
      addDelayMinMs: t.config.addDelayMinMs, addDelayMaxMs: t.config.addDelayMaxMs,
      msgDelayMinMs: t.config.msgDelayMinMs, msgDelayMaxMs: t.config.msgDelayMaxMs,
    },
  };
}

export function listCampaignTemplates(kind?: CampaignTemplateKind) {
  const followups = FOLLOWUP_TEMPLATES
    .filter(() => !kind || kind === 'followup')
    .map((t) => ({ ...followupSummary(t), kind: 'followup' as const, source: 'system' as const, audienceSource: null }));
  const outreach = outreachTemplates
    .filter(() => !kind || kind === 'outreach')
    .map(outreachSummary);
  return [...followups, ...outreach];
}

export function listCampaignTemplateCategories(kind?: CampaignTemplateKind) {
  return [...new Set(listCampaignTemplates(kind).map((t) => t.category))];
}

export function getCampaignTemplate(key: string) {
  const followupKey = key.startsWith('followup:') ? key.slice('followup:'.length) : key;
  const followup = getFollowupTemplate(followupKey);
  if (followup) return { kind: 'followup' as const, source: 'system' as const, key: `followup:${followup.key}`, template: followupDetail(followup) };
  const outreach = outreachTemplates.find((t) => t.key === key);
  if (outreach) return { kind: 'outreach' as const, source: 'system' as const, key: outreach.key, template: { ...outreachSummary(outreach), intro: outreach.intro, whenToUse: outreach.whenToUse, endConditions: outreach.endConditions, expectedOutcome: outreach.expectedOutcome, config: outreach.config } };
  return undefined;
}

export function getOutreachTemplate(key: string) {
  return outreachTemplates.find((t) => t.key === key);
}

