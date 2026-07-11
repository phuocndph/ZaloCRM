import { AIError } from './ai-error-handler.js';

export class PromptRenderer {
  variables(template: string): string[] {
    const names = new Set<string>();
    for (const match of template.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)) names.add(match[1]);
    return [...names].sort();
  }

  render(template: string, variables: Record<string, unknown>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path: string) => {
      const value = path.split('.').reduce<unknown>((current, key) => {
        if (typeof current !== 'object' || current === null) return undefined;
        return (current as Record<string, unknown>)[key];
      }, variables);
      if (value === undefined || value === null) {
        throw new AIError('INVALID_REQUEST', `Missing prompt variable: ${path}`, false, 400);
      }
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }
}
