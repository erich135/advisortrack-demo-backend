/**
 * Ordered sales pipeline stages — matches PostgreSQL pipeline_stage enum.
 */
export const PIPELINE_STAGES = [
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages before value / case estimates (sales pipeline activities). */
export const SALES_PIPELINE_STAGES: PipelineStage[] = [
  'Initial Contact',
  'Interview',
  'Analysis',
];

/** Stages where a production case estimate can be linked from an activity. */
export const CASE_LINK_STAGES: PipelineStage[] = ['Recommendation', 'Implementation', 'Review'];

/**
 * Returns the next pipeline stage, or null when at Review (terminal).
 */
export const getNextPipelineStage = (current: string): PipelineStage | null => {
  const index = PIPELINE_STAGES.indexOf(current as PipelineStage);
  if (index < 0 || index >= PIPELINE_STAGES.length - 1) {
    return null;
  }
  return PIPELINE_STAGES[index + 1];
};

/**
 * Returns true when the stage supports optional case / production linking on Proceed.
 */
export const isCaseLinkStage = (stage: string): boolean =>
  CASE_LINK_STAGES.includes(stage as PipelineStage);

export { getPipelineStageLabel } from '../features/pipelineStages';
