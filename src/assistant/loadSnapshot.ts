import bundleJson from './knowledge-bundle.json';
import type { ServerKnowledgeBundle } from './serverBundle';

/** Abel-generated server knowledge snapshot. Never fetch production. */
export function loadServerBundle(): ServerKnowledgeBundle {
  return bundleJson as ServerKnowledgeBundle;
}
