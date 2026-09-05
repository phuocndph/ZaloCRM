import { describe, expect, it } from 'vitest';
import {
  assessCounterpartyHeuristically,
  resolveCounterpartyAssessment,
  shouldCreateSalesWorkItem,
} from '../../src/modules/ai/counterparty-role.js';

describe('counterparty role classification', () => {
  it('recognizes an inbound sales pitch as a vendor, not a customer', () => {
    const messages = [{
      senderType: 'contact',
      content: 'Chào anh, bên em chuyên cung cấp phần mềm quản lý và xin phép gửi anh bảng giá tham khảo.',
    }];
    const assessment = assessCounterpartyHeuristically(messages);
    expect(assessment.role).toBe('vendor');
    expect(shouldCreateSalesWorkItem({ assessment, messages, intent: 'product_inquiry' })).toBe(false);
  });

  it('recognizes a person asking to buy as a prospect', () => {
    const messages = [{ senderType: 'contact', content: 'Bên mình có chăn ga khách sạn loại cotton không? Cho tôi xin báo giá 20 bộ.' }];
    const assessment = assessCounterpartyHeuristically(messages);
    expect(assessment.role).toBe('prospect');
    expect(shouldCreateSalesWorkItem({ assessment, messages })).toBe(true);
  });

  it('lets strong outreach evidence override a weak incorrect model result', () => {
    const messages = [{ senderType: 'contact', content: 'Công ty chúng tôi chuyên phân phối vật tư, xin phép giới thiệu sản phẩm đến quý công ty.' }];
    const assessment = resolveCounterpartyAssessment(
      { role: 'prospect', confidence: 0.6, reason: 'Có nhắc đến sản phẩm.' },
      messages,
    );
    expect(assessment.role).toBe('vendor');
  });

  it('does not mistake a vendor call-to-action for the sender buying from us', () => {
    const messages = [{
      senderType: 'contact',
      content: 'Bên em nhận thi công nội thất. Anh chốt phương án nào em triển khai ạ.',
    }];
    expect(assessCounterpartyHeuristically(messages).role).toBe('vendor');
  });

  it('keeps a business buyer even when they describe their own service first', () => {
    const messages = [{
      senderType: 'contact',
      content: 'Bên em chuyên cung cấp phòng khách sạn và đang cần mua 30 bộ ga, xin báo giá giúp em.',
    }];
    expect(assessCounterpartyHeuristically(messages).role).toBe('prospect');
    expect(resolveCounterpartyAssessment(
      { role: 'prospect', confidence: 0.95, reason: 'Đang hỏi mua số lượng lớn.' },
      messages,
    ).role).toBe('prospect');
  });

  it('does not turn an unclear greeting into an urgent customer task', () => {
    const messages = [{ senderType: 'contact', content: 'Chào bạn' }];
    expect(shouldCreateSalesWorkItem({ messages })).toBe(false);
  });

  it('does not revive an explicit unknown role from a broad commercial intent', () => {
    const messages = [{ senderType: 'contact', content: 'Tôi gửi bạn thông tin để tham khảo.' }];
    expect(shouldCreateSalesWorkItem({
      assessment: { role: 'unknown', confidence: 0.91, reason: 'Không đủ bằng chứng xác định vai trò.' },
      messages,
      intent: 'product_inquiry',
      stage: 'discovery',
    })).toBe(false);
  });
});
