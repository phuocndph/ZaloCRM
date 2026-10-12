export function isConversationEscalation(insight: any): boolean {
  if (['complaint', 'return_or_refund', 'human_request'].includes(String(insight?.intentLabel ?? ''))
    || insight?.signals?.hardEscalation === true) return true;
  if (insight?.signals?.hardEscalation === false) return false;
  return insight?.stage === 'human_required' && insight?.nextAction === 'assign_to_human';
}
