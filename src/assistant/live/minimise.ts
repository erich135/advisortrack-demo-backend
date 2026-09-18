import { normalizeQuestion } from '../retrieve';
import type { AssistantContext } from '../context';
import { LIVE_LIMITS } from './limits';
import { pickPermittedFacts } from './policy';
import type { LiveToolFactGroup } from './types';

function neededPersonFields(question: string): Set<string> {
  const normalized = normalizeQuestion(question);
  const fields = new Set(['displayName', 'reportingRoleLabel', 'teamName', 'regionName', 'accountStatus']);
  if (/\b(licen[cs]e|seat)\b/.test(normalized)) fields.add('licenceStatus');
  if (/\b(invite|invitation)\b/.test(normalized)) fields.add('invitationStatus');
  if (/\b(mobile|telemetry|last seen|activity)\b/.test(normalized)) fields.add('lastMobileActivity');
  if (/\b(email|phone|contact)\b/.test(normalized)) {
    fields.add('email');
    fields.add('phone');
  }
  if (/\b(client|policy|case note|contact name)\b/.test(normalized)) {
    fields.add('contactName');
    fields.add('clientName');
  }
  return fields;
}

function neededPipelineFields(question: string): Set<string> {
  const normalized = normalizeQuestion(question);
  const fields = new Set(['openCases', 'pipelineValue']);
  if (/\b(pipeline|stage|cases|case)\b/.test(normalized) || /\bdoing\b/.test(normalized)) {
    fields.add('totalCases');
  }
  if (/\b(stage|fact finding|review)\b/.test(normalized)) {
    fields.add('topStageLabel');
    fields.add('topStageCount');
  }
  return fields;
}

function neededFieldsForTool(toolId: string, question: string): Set<string> | null {
  if (toolId === 'PERSON_SUMMARY' || toolId === 'ADVISOR_SUMMARY') return neededPersonFields(question);
  if (toolId === 'PIPELINE_SUMMARY') return neededPipelineFields(question);
  if (toolId === 'PRODUCTION_SUMMARY') {
    return new Set(['issuedAmount', 'issuedCount', 'notIssuedAmount', 'notIssuedCount']);
  }
  if (toolId === 'LICENCE_SUMMARY') return new Set(['purchased', 'assigned', 'available']);
  if (toolId === 'TEAM_SUMMARY') return new Set(['name', 'leaderName', 'regionName', 'advisorCount']);
  if (toolId === 'REGION_SUMMARY') return new Set(['name', 'managerName', 'teamCount', 'advisorCount']);
  if (toolId === 'COMPARISON_SUMMARY') {
    return new Set([
      'subjectName', 'metric', 'currentPeriod', 'baselinePeriod',
      'currentValue', 'baselineValue', 'currentComplete', 'baselineComplete',
    ]);
  }
  if (toolId === 'RANKING_SUMMARY') {
    return new Set([
      'metric', 'periodLabel', 'universe', 'comparisonRole', 'ordering',
      'scopeKind', 'sourceTool', 'rowCount',
      'name1', 'value1', 'name2', 'value2', 'name3', 'value3', 'name4', 'value4', 'name5', 'value5',
    ]);
  }
  if (toolId === 'ATTENTION_SUMMARY') {
    return new Set(['subjectName', 'flagged', 'reasonCount', 'reason1', 'reason2', 'reason3', 'reason4']);
  }
  return null;
}

/** Model prompts receive only the authorised fields required for the question. */
export function countToolProjectionFields(tools: LiveToolFactGroup[]): number {
  return tools.reduce((sum, tool) => sum + Object.keys(tool.facts).length, 0);
}

export function minimiseLiveToolsForModel(
  question: string,
  tools: LiveToolFactGroup[],
  context: AssistantContext,
): LiveToolFactGroup[] {
  const minimised = tools.map((tool) => {
    const permitted = pickPermittedFacts(tool.tool, tool.facts, context, 'model');
    const needed = neededFieldsForTool(tool.tool, question);
    const facts = needed
      ? Object.fromEntries(Object.entries(permitted).filter(([field]) => needed.has(field)))
      : permitted;
    return { ...tool, facts };
  }).filter((tool) => Object.keys(tool.facts).length > 0);

  let remaining = LIVE_LIMITS.maxToolProjectionFields;
  return minimised.map((tool) => {
    const entries = Object.entries(tool.facts);
    if (entries.length <= remaining) {
      remaining -= entries.length;
      return tool;
    }
    const facts = Object.fromEntries(entries.slice(0, Math.max(0, remaining)));
    remaining = 0;
    return { ...tool, facts };
  }).filter((tool) => Object.keys(tool.facts).length > 0);
}
