#!/usr/bin/env node
/**
 * Verifies planning engine output against the Excel spreadsheet baseline.
 * Run: node scripts/verify-planning-parity.js
 */
const {
  calculatePlanningTargets,
  getMarginalTaxRateForNett,
  sliderToRatio,
} = require('../dist/services/planningEngine');

/** Industry-default concierge inputs (R50k nett goal). */
const defaultInputs = {
  monthlyGoalNett: 50000,
  monthlyDeductions: 0,
  commissionSplit: 0.8,
  effectiveTaxRate: getMarginalTaxRateForNett(50000),
  avgCommission: 10000,
  ratios: {
    coldCallToInterview: sliderToRatio(4),
    interviewToAnalysis: sliderToRatio(6),
    analysisToRecommendation: sliderToRatio(6),
    recommendationToImplementation: sliderToRatio(6),
    submissionToIssued: sliderToRatio(8),
  },
};

const targets = calculatePlanningTargets(defaultInputs);

const checks = [
  {
    label: 'Weekly cold calls (50k defaults)',
    actual: targets.weekly.coldCallsPerWeek,
    expected: 50,
  },
  {
    label: 'Weekly interviews (50k defaults)',
    actual: targets.weekly.interviewsPerWeek,
    expected: 20,
  },
  {
    label: 'Weekly analysis/quotes (50k defaults)',
    actual: targets.weekly.quotesPerWeek,
    expected: 12,
  },
  {
    label: 'Weekly point target rounded (50k defaults)',
    actual: targets.weeklyPointTarget,
    expected: 400,
  },
];

const goal30k = calculatePlanningTargets({
  ...defaultInputs,
  monthlyGoalNett: 30000,
  effectiveTaxRate: getMarginalTaxRateForNett(30000),
});

checks.push({
  label: 'Weekly point target changes for R30k goal',
  actual: goal30k.weeklyPointTarget < targets.weeklyPointTarget ? 1 : 0,
  expected: 1,
});

let failed = 0;
for (const check of checks) {
  const pass = check.actual === check.expected;
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${check.label}: ${check.actual} (expected ${check.expected})`);
  if (!pass) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} parity check(s) failed.`);
  process.exit(1);
}

console.log('\nAll planning parity checks passed.');
console.log('Sample deliverables (R50k nett):', JSON.stringify(targets.weekly, null, 2));
