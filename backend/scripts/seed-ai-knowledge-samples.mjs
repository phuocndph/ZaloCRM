/**
 * Seed bộ dữ liệu mẫu cho Cài đặt → Trợ lý AI → Kho tri thức.
 *
 * Chạy trong container app:
 *   node /app/scripts/seed-ai-knowledge-samples.mjs
 *
 * Script idempotent: dùng `externalId` cố định, nên chạy lại sẽ không tạo
 * thêm tài liệu nếu bộ mẫu đã tồn tại. Tài liệu được tạo ở trạng thái Draft
 * và đã Re-index để Admin kiểm tra Retrieval trước khi chạy Evaluation/Publish.
 */

import { prisma } from '../dist/shared/database/prisma-client.js';
import {
  createKnowledgeDocument,
  createKnowledgeSource,
  reindexKnowledgeDocument,
} from '../dist/modules/ai/knowledge-base-service.js';

const SAMPLE_PREFIX = 'sample-ai-assistant-2026';
const actorUser = await prisma.user.findFirst({
  orderBy: { createdAt: 'asc' },
  select: { id: true, orgId: true, role: true, fullName: true },
});

if (!actorUser) {
  throw new Error('Không tìm thấy người dùng để tạo bộ dữ liệu AI mẫu.');
}

const actor = {
  orgId: actorUser.orgId,
  userId: actorUser.id,
  role: actorUser.role,
};

const sources = [
  {
    name: '[MẪU TEST] Danh mục sản phẩm & dịch vụ',
    type: 'product',
    priority: 50,
    tags: ['sample', 'test', 'san-pham', 'dich-vu'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:product-catalog`,
        title: 'Danh mục gói CRM mẫu 2026',
        fileName: 'danh-muc-goi-crm-mau-2026.txt',
        content: `# Danh mục gói CRM mẫu 2026

## Gói Starter
Phù hợp đội nhóm từ 1 đến 5 người dùng.
Bao gồm quản lý khách hàng, hội thoại Zalo, ghi chú, lịch hẹn, phân quyền cơ bản và báo cáo tổng quan.
Giá niêm yết: 490.000 đồng mỗi tháng cho tối đa 5 người dùng.
Không bao gồm kết nối API nâng cao hoặc tự động hóa chiến dịch.

## Gói Growth
Phù hợp doanh nghiệp từ 6 đến 25 người dùng.
Bao gồm toàn bộ tính năng Starter, thêm tự động hóa chăm sóc, tệp khách hàng, nhãn CRM, báo cáo hiệu suất và AI gợi ý phản hồi cho nhân viên.
Giá niêm yết: 1.490.000 đồng mỗi tháng cho tối đa 25 người dùng.
Có thể mua thêm 100.000 đồng mỗi người dùng mỗi tháng khi vượt số lượng đi kèm.

## Gói Enterprise
Phù hợp doanh nghiệp cần tích hợp và quy trình riêng.
Bao gồm toàn bộ Growth, API tích hợp, phân quyền tùy chỉnh, SSO, hỗ trợ ưu tiên và cấu hình theo yêu cầu.
Báo giá theo quy mô, nhu cầu triển khai và mức độ tích hợp.

Lưu ý: đây là dữ liệu mô phỏng phục vụ kiểm thử AI; không dùng để báo giá thực tế.`,
      },
      {
        externalId: `${SAMPLE_PREFIX}:feature-comparison`,
        title: 'Bảng so sánh tính năng các gói CRM mẫu',
        fileName: 'so-sanh-tinh-nang-goi-crm-mau.txt',
        content: `# Bảng so sánh tính năng các gói CRM mẫu

| Tính năng | Starter | Growth | Enterprise |
|---|---|---|---|
| Quản lý khách hàng và hội thoại | Có | Có | Có |
| Lịch hẹn và ghi chú | Có | Có | Có |
| Tự động hóa chăm sóc | Không | Có | Có |
| AI gợi ý phản hồi | Không | Có | Có |
| Báo cáo hiệu suất nâng cao | Không | Có | Có |
| API tích hợp | Không | Không | Có |
| SSO và phân quyền tùy chỉnh | Không | Không | Có |
| Hỗ trợ ưu tiên | Không | Không | Có |

Khi khách hàng chưa nêu số lượng nhân sự, cần hỏi số người dùng dự kiến và nhu cầu tự động hóa trước khi đề xuất gói.`,
      },
    ],
  },
  {
    name: '[MẪU TEST] Bảng giá & ưu đãi',
    type: 'price_list',
    priority: 45,
    tags: ['sample', 'test', 'bang-gia', 'uu-dai'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:pricing-promotion`,
        title: 'Bảng giá và ưu đãi thanh toán mẫu',
        fileName: 'bang-gia-uu-dai-thanh-toan-mau.txt',
        content: `# Bảng giá và ưu đãi thanh toán mẫu

Giá gói Starter: 490.000 đồng/tháng, tối đa 5 người dùng.
Giá gói Growth: 1.490.000 đồng/tháng, tối đa 25 người dùng.
Gói Enterprise: liên hệ tư vấn để nhận báo giá.

## Ưu đãi mô phỏng
- Thanh toán 12 tháng: giảm 10 phần trăm trên giá niêm yết.
- Khách hàng mới đăng ký Growth trong tháng: tặng 1 buổi onboarding trực tuyến 90 phút.
- Không cộng dồn ưu đãi thanh toán năm với mã khuyến mại khác.
- Giá đã nêu chưa bao gồm VAT nếu hóa đơn có yêu cầu VAT.

Nhân viên chỉ được xác nhận ưu đãi sau khi kiểm tra ngày hiệu lực. Không được tự hứa tặng thêm người dùng hoặc giảm giá ngoài chính sách.`,
      },
    ],
  },
  {
    name: '[MẪU TEST] Chính sách dịch vụ',
    type: 'policy',
    priority: 60,
    tags: ['sample', 'test', 'chinh-sach', 'bao-mat', 'thanh-toan'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:service-policy`,
        title: 'Chính sách dùng thử, thanh toán và bảo mật mẫu',
        fileName: 'chinh-sach-dich-vu-mau.txt',
        content: `# Chính sách dùng thử, thanh toán và bảo mật mẫu

## Dùng thử
Khách hàng được dùng thử 14 ngày cho gói Growth với dữ liệu mô phỏng.
Trong thời gian dùng thử, khách hàng có thể yêu cầu hướng dẫn khởi tạo dữ liệu.
Tài khoản dùng thử không được cam kết giữ dữ liệu quá 30 ngày sau khi hết hạn.

## Thanh toán và gia hạn
Dịch vụ được kích hoạt sau khi hệ thống ghi nhận thanh toán thành công.
Thông báo gia hạn được gửi trước ngày hết hạn 7 ngày.
Nếu quá hạn thanh toán, quyền truy cập có thể bị tạm ngưng; dữ liệu được lưu giữ theo chính sách lưu trữ.

## Bảo mật
Không yêu cầu khách hàng gửi mật khẩu, cookie, OTP hoặc mã xác thực qua hội thoại.
Sự cố nghi ngờ lộ tài khoản phải được chuyển ngay cho bộ phận hỗ trợ bảo mật.
Chỉ nhân sự được phân quyền mới được truy cập dữ liệu khách hàng theo phạm vi công việc.

Nội dung này chỉ là chính sách mô phỏng dùng để test kho tri thức.`,
      },
      {
        externalId: `${SAMPLE_PREFIX}:support-sla`,
        title: 'Cam kết phản hồi hỗ trợ mẫu',
        fileName: 'cam-ket-ho-tro-sla-mau.txt',
        content: `# Cam kết phản hồi hỗ trợ mẫu

Kênh tiếp nhận: hội thoại trong hệ thống, email hỗ trợ hoặc hotline trong giờ hành chính.
Mục tiêu phản hồi ban đầu:
- Sự cố không truy cập được hệ thống: trong 2 giờ làm việc.
- Lỗi thao tác thông thường: trong 8 giờ làm việc.
- Yêu cầu hướng dẫn tính năng: trong 1 ngày làm việc.

Không cam kết thời gian khắc phục chính xác nếu chưa có kết quả phân tích kỹ thuật.
Khi có ảnh hưởng nhiều người dùng, nhân viên cần ghi nhận thời điểm, phạm vi ảnh hưởng, ảnh chụp lỗi và chuyển cấp đúng quy trình.`,
      },
    ],
  },
  {
    name: '[MẪU TEST] FAQ khách hàng',
    type: 'faq',
    priority: 40,
    tags: ['sample', 'test', 'faq', 'hoi-dap'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:faq`,
        title: 'FAQ thường gặp về CRM mẫu',
        fileName: 'faq-crm-mau.txt',
        content: `# FAQ thường gặp về CRM mẫu

Hỏi: Tôi có thể dùng trên điện thoại không?
Đáp: Có. Hệ thống có giao diện mobile/PWA cho các thao tác hội thoại và quản lý cơ bản. Một số định dạng tài liệu cần ứng dụng tương thích để xem đầy đủ.

Hỏi: Có thể import danh sách khách hàng không?
Đáp: Có thể import theo mẫu dữ liệu được cung cấp. Nên kiểm tra dữ liệu trùng và quyền đồng ý liên hệ trước khi import.

Hỏi: AI có tự gửi tin nhắn cho khách hàng không?
Đáp: AI mặc định chỉ gợi ý nội dung. Tự động gửi chỉ hoạt động khi quản trị viên cấu hình workflow, ngưỡng an toàn và quyền phù hợp.

Hỏi: Tôi quên mật khẩu thì làm sao?
Đáp: Dùng chức năng khôi phục mật khẩu. Không gửi mật khẩu hoặc OTP cho bất kỳ nhân viên nào qua chat.

Hỏi: Có thể hủy dịch vụ không?
Đáp: Khách hàng gửi yêu cầu qua kênh hỗ trợ chính thức để được kiểm tra hợp đồng, dữ liệu và thời hạn dịch vụ.`,
      },
    ],
  },
  {
    name: '[MẪU TEST] Kịch bản tư vấn bán hàng',
    type: 'consultation_script',
    priority: 55,
    tags: ['sample', 'test', 'tu-van', 'ban-hang', 'script'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:sales-script`,
        title: 'Kịch bản tư vấn CRM mẫu theo nhu cầu',
        fileName: 'kich-ban-tu-van-crm-mau.txt',
        content: `# Kịch bản tư vấn CRM mẫu theo nhu cầu

## Bước 1: Chào hỏi và xác định nhu cầu
"Cảm ơn anh/chị đã quan tâm. Hiện đội ngũ mình có khoảng bao nhiêu người trực tiếp chăm sóc khách hàng và đang quản lý hội thoại bằng công cụ nào?"

## Bước 2: Khai thác vấn đề
"Hạng mục nào đang mất nhiều thời gian nhất: phân khách, theo dõi lịch hẹn, tổng hợp báo cáo hay trả lời tin nhắn?"

## Bước 3: Đề xuất có điều kiện
- Nếu đội ngũ 1 đến 5 người, ưu tiên giới thiệu Starter.
- Nếu cần tự động hóa hoặc AI gợi ý phản hồi, giới thiệu Growth.
- Nếu cần API, SSO hoặc phân quyền riêng, chuyển tư vấn Enterprise.

## Bước 4: Chốt bước tiếp theo
"Em có thể sắp xếp một buổi demo ngắn để minh họa theo đúng quy trình của đội mình. Anh/chị phù hợp khung giờ nào?"

Không khẳng định tính năng, giá hoặc ưu đãi nếu chưa đối chiếu tài liệu hiện hành.`,
      },
    ],
  },
  {
    name: '[MẪU TEST] Quy trình xử lý khiếu nại',
    type: 'complaint_process',
    priority: 70,
    tags: ['sample', 'test', 'khieu-nai', 'ho-tro', 'escalation'],
    documents: [
      {
        externalId: `${SAMPLE_PREFIX}:complaint-process`,
        title: 'Quy trình tiếp nhận và xử lý khiếu nại mẫu',
        fileName: 'quy-trinh-khieu-nai-mau.txt',
        content: `# Quy trình tiếp nhận và xử lý khiếu nại mẫu

## 1. Tiếp nhận
Lắng nghe, xác nhận đã nhận thông tin và xin lỗi vì trải nghiệm chưa tốt. Không tranh luận hoặc quy kết lỗi cho khách hàng.

## 2. Ghi nhận tối thiểu
Thu thập tên liên hệ, kênh xảy ra vấn đề, thời điểm, ảnh hưởng, ảnh chụp màn hình và thông báo lỗi nếu có.
Không yêu cầu mật khẩu, cookie, OTP hoặc thông tin xác thực nhạy cảm.

## 3. Phân loại và chuyển cấp
- Không truy cập được hệ thống hoặc nghi ngờ mất dữ liệu: chuyển cấp Khẩn.
- Lỗi một thao tác đơn lẻ: tạo ticket Hỗ trợ kỹ thuật.
- Tranh chấp thanh toán/hóa đơn: chuyển bộ phận Kế toán.
- Yêu cầu xóa dữ liệu hoặc quyền riêng tư: chuyển bộ phận Bảo mật/Pháp chế.

## 4. Phản hồi
Thông báo mã ticket và thời gian phản hồi dự kiến theo SLA. Chỉ cập nhật thông tin đã được bộ phận phụ trách xác nhận.

## 5. Kết thúc
Xác nhận khách hàng đã nhận giải pháp, lưu tóm tắt không chứa dữ liệu nhạy cảm và đánh dấu trạng thái xử lý.`,
      },
    ],
  },
];

const summary = { actor: actorUser.fullName, sourcesCreated: 0, documentsCreated: 0, documentsIndexed: 0, skipped: 0 };

for (const definition of sources) {
  let source = await prisma.aiKnowledgeSource.findFirst({
    where: { orgId: actor.orgId, name: definition.name, deletedAt: null },
    select: { id: true },
  });

  if (!source) {
    source = await createKnowledgeSource(actor, {
      name: definition.name,
      type: definition.type,
      priority: definition.priority,
      tags: definition.tags,
    });
    summary.sourcesCreated += 1;
  }

  for (const documentDefinition of definition.documents) {
    const existing = await prisma.aiKnowledgeDocument.findFirst({
      where: {
        orgId: actor.orgId,
        sourceId: source.id,
        externalId: documentDefinition.externalId,
        deletedAt: null,
      },
      select: { id: true, lastIndexedAt: true },
    });

    if (existing) {
      if (!existing.lastIndexedAt) {
        await reindexKnowledgeDocument(actor, existing.id);
        summary.documentsIndexed += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    const document = await createKnowledgeDocument(actor, source.id, {
      ...documentDefinition,
      mimeType: 'text/plain',
      language: 'vi',
      priority: definition.priority,
      tags: definition.tags,
      metadata: { sampleData: true, sampleSet: SAMPLE_PREFIX },
    });
    summary.documentsCreated += 1;

    await reindexKnowledgeDocument(actor, document.id);
    summary.documentsIndexed += 1;
  }
}

console.log(JSON.stringify({
  message: 'Đã chuẩn bị bộ tài liệu AI mẫu ở trạng thái Draft đã index.',
  ...summary,
  nextSteps: [
    'Mở Cài đặt → Trợ lý AI → Kho tri thức.',
    'Dùng ô “Kiểm tra Retrieval” với các câu hỏi mẫu.',
    'Tạo Evaluation đạt cho từng tài liệu trước khi bấm Publish.',
  ],
}, null, 2));

await prisma.$disconnect();