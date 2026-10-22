import type { AdvisorArchetype } from './demoNorthstar';
import type { DemoDateBucket } from './demoDatePlan';

export const CASE_DOCUMENTS = [
  { documentType: 'consent', label: 'Letter of consent' },
  { documentType: 'broker_disclosure', label: 'Broker disclosure' },
  { documentType: 'appointment', label: 'Letter of appointment' },
] as const;

export const NEXT_ACTION_TITLES = [
  'Call client',
  'Gather FICA',
  'Schedule review',
  'Submit application',
  'Follow up underwriting',
  'Confirm acceptance',
] as const;

const STAGES = [
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
] as const;

export type ExtraCaseSpec = {
  title: string;
  stage: (typeof STAGES)[number];
  bucket: DemoDateBucket;
  slotOffset: number;
  amount: number;
  issued: boolean;
  docsReceived: 0 | 1 | 2 | 3;
  ficaId: boolean;
  ficaResidence: boolean;
  ficaBank: boolean;
  nextAction: boolean;
  nextActionTitle?: string;
  chosenInsurer?: string;
  reviewDue?: boolean;
  linkProduction?: boolean;
  applicationStatus?: string;
  factFindMode?: 'simple_goal' | 'full_fna';
  analysisQuotes?: Array<{ productType?: string; insurer?: string; premium?: number; commission?: number }>;
};

export type ExtraActivitySpec = {
  title: string;
  bucket: DemoDateBucket;
  slotOffset: number;
  status: 'scheduled' | 'completed';
  type: 'call' | 'meeting' | 'email' | 'follow_up' | 'presentation';
  stage: (typeof STAGES)[number];
  outcome?: 'proceeded' | 'lost' | 'completed';
};

export const extraMayaWorkspaceCases = (): ExtraCaseSpec[] => [
  {
    title: 'Life Cover new enquiry',
    stage: 'Initial Contact',
    bucket: 'current_month',
    slotOffset: 21,
    amount: 0,
    issued: false,
    docsReceived: 0,
    ficaId: false,
    ficaResidence: false,
    ficaBank: false,
    nextAction: true,
    nextActionTitle: 'Call client',
    linkProduction: false,
  },
  {
    title: 'Retirement annuity fact-find',
    stage: 'Interview',
    bucket: 'yesterday',
    slotOffset: 22,
    amount: 0,
    issued: false,
    docsReceived: 1,
    ficaId: true,
    ficaResidence: false,
    ficaBank: false,
    nextAction: true,
    nextActionTitle: 'Gather FICA',
    linkProduction: false,
    factFindMode: 'simple_goal',
  },
  {
    title: 'Income protection quotes',
    stage: 'Analysis',
    bucket: 'hours_ago',
    slotOffset: 23,
    amount: 0,
    issued: false,
    docsReceived: 2,
    ficaId: true,
    ficaResidence: true,
    ficaBank: false,
    nextAction: true,
    nextActionTitle: 'Call client',
    linkProduction: false,
    analysisQuotes: [
      { productType: 'Income protection', insurer: 'Discovery', premium: 1850, commission: 22000 },
      { productType: 'Income protection', insurer: 'Sanlam', premium: 1720, commission: 19800 },
    ],
  },
  {
    title: 'Investment recommendation pack',
    stage: 'Recommendation',
    bucket: 'current_month',
    slotOffset: 24,
    amount: 0,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: true,
    nextActionTitle: 'Submit application',
    chosenInsurer: 'Sanlam',
    linkProduction: false,
  },
  {
    title: 'Disability cover implementation',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 25,
    amount: 24500,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Old Mutual',
    linkProduction: true,
    applicationStatus: 'application_received',
  },
  {
    title: 'Medical aid awaiting medicals',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 27,
    amount: 9800,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Discovery',
    linkProduction: true,
    applicationStatus: 'awaiting_medicals',
  },
  {
    title: 'Retirement PMA pending',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 28,
    amount: 15200,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Sanlam',
    linkProduction: true,
    applicationStatus: 'pma_pending',
  },
  {
    title: 'Life Cover awaiting advisor information',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 29,
    amount: 7400,
    issued: false,
    docsReceived: 2,
    ficaId: true,
    ficaResidence: true,
    ficaBank: false,
    nextAction: true,
    nextActionTitle: 'Send outstanding information',
    chosenInsurer: 'Old Mutual',
    linkProduction: true,
    applicationStatus: 'awaiting_advisor_info',
  },
  {
    title: 'Disability declined application',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 30,
    amount: 6100,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Momentum',
    linkProduction: true,
    applicationStatus: 'declined',
  },
  {
    title: 'Investments withdrawn application',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 31,
    amount: 4300,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Allan Gray',
    linkProduction: true,
    applicationStatus: 'withdrawn',
  },
  {
    title: 'Accepted status not yet issued',
    stage: 'Implementation',
    bucket: 'current_month',
    slotOffset: 32,
    amount: 12000,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Sanlam',
    linkProduction: true,
    applicationStatus: 'accepted_issued',
  },
  {
    title: 'Life Cover annual review',
    stage: 'Review',
    bucket: 'current_month',
    slotOffset: 26,
    amount: 0,
    issued: false,
    docsReceived: 3,
    ficaId: true,
    ficaResidence: true,
    ficaBank: true,
    nextAction: false,
    chosenInsurer: 'Discovery',
    reviewDue: true,
    linkProduction: false,
  },
];

export const extraMayaWorkspaceActivities = (): ExtraActivitySpec[] => [
  { title: 'Follow-up call today', bucket: 'hours_ago', slotOffset: 1, status: 'scheduled', type: 'call', stage: 'Initial Contact' },
  { title: 'Fact-find later this week', bucket: 'upcoming', slotOffset: 2, status: 'scheduled', type: 'meeting', stage: 'Interview' },
  { title: 'Quote review this week', bucket: 'upcoming', slotOffset: 4, status: 'scheduled', type: 'follow_up', stage: 'Analysis' },
  { title: 'Overdue FICA chase', bucket: 'days_ago_3', slotOffset: 1, status: 'scheduled', type: 'call', stage: 'Interview' },
  { title: 'Overdue implementation check', bucket: 'days_ago_4', slotOffset: 2, status: 'scheduled', type: 'email', stage: 'Implementation' },
  { title: 'Completed initial contact', bucket: 'hours_ago', slotOffset: 3, status: 'completed', type: 'call', stage: 'Initial Contact', outcome: 'proceeded' },
  { title: 'Completed fact-find', bucket: 'yesterday', slotOffset: 4, status: 'completed', type: 'meeting', stage: 'Interview', outcome: 'proceeded' },
  { title: 'Completed analysis', bucket: 'current_month', slotOffset: 5, status: 'completed', type: 'follow_up', stage: 'Analysis', outcome: 'proceeded' },
  { title: 'Completed recommendation', bucket: 'current_month', slotOffset: 6, status: 'completed', type: 'presentation', stage: 'Recommendation', outcome: 'proceeded' },
  { title: 'Completed implementation', bucket: 'current_month', slotOffset: 7, status: 'completed', type: 'meeting', stage: 'Implementation', outcome: 'proceeded' },
  { title: 'Completed review', bucket: 'current_month', slotOffset: 8, status: 'completed', type: 'meeting', stage: 'Review', outcome: 'completed' },
  { title: 'Last-week review call', bucket: 'last_week', slotOffset: 2, status: 'completed', type: 'call', stage: 'Review', outcome: 'proceeded' },
];

export const mobileBucketFor = (
  archetype: AdvisorArchetype,
  advisorIndex: number
): DemoDateBucket | null => {
  if (archetype === 'null_mobile') return null;
  if (archetype === 'inactive') {
    return (['days_ago_3', 'days_ago_4', 'days_ago_5'] as const)[advisorIndex % 3];
  }
  if (archetype === 'mixed') return 'days_ago_4';
  if (archetype === 'healthy') {
    return (['hours_ago', 'yesterday', 'hours_ago'] as const)[advisorIndex % 3];
  }
  if (archetype === 'weak_conversion') return 'hours_ago';
  if (archetype === 'stalled') return 'yesterday';
  if (archetype === 'missing_docs') return 'yesterday';
  return advisorIndex % 2 === 0 ? 'yesterday' : 'hours_ago';
};

export const currentMonthIssuedFor = (archetype: AdvisorArchetype, advisorIndex: number): number => {
  if (archetype === 'weak_conversion') return 7_850 + (advisorIndex % 5) * 430;
  if (archetype === 'healthy') return 58_400 + (advisorIndex % 8) * 3_260;
  if (archetype === 'inactive') return 16_900 + (advisorIndex % 6) * 740;
  if (archetype === 'stalled') return 18_200 + (advisorIndex % 4) * 910;
  if (archetype === 'missing_docs') return 14_600 + (advisorIndex % 5) * 680;
  if (archetype === 'mixed') return 11_400 + (advisorIndex % 4) * 520;
  return 33_800 + ((advisorIndex * 1_240) % 21_000);
};

export const extraCasesFor = (
  archetype: AdvisorArchetype,
  advisorIndex: number,
  product: string
): ExtraCaseSpec[] => {
  const commission = (base: number): number => base + ((advisorIndex * 1_130) % 9_400);
  const title = (label: string): string => `${product} ${label}`;

  if (archetype === 'healthy') {
    return [
      {
        title: title('fact-find in progress'),
        stage: 'Interview',
        bucket: 'yesterday',
        slotOffset: 1,
        amount: commission(24_800),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Schedule review',
      },
      {
        title: title('quotes with client'),
        stage: 'Analysis',
        bucket: 'hours_ago',
        slotOffset: 2,
        amount: commission(31_200),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Call client',
      },
      {
        title: title('recommendation pack'),
        stage: 'Recommendation',
        bucket: 'current_month',
        slotOffset: 3,
        amount: commission(38_500),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Submit application',
      },
      {
        title: title('annual review booked'),
        stage: 'Review',
        bucket: 'current_month',
        slotOffset: 4,
        amount: commission(21_400),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Confirm acceptance',
      },
    ];
  }

  if (archetype === 'weak_conversion') {
    return [
      {
        title: title('large pending quote'),
        stage: 'Analysis',
        bucket: 'current_month',
        slotOffset: 1,
        amount: commission(72_000),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Call client',
      },
      {
        title: title('recommendation not taken up'),
        stage: 'Recommendation',
        bucket: 'yesterday',
        slotOffset: 2,
        amount: commission(81_400),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Follow up underwriting',
      },
      {
        title: title('application sitting with client'),
        stage: 'Implementation',
        bucket: 'hours_ago',
        slotOffset: 3,
        amount: commission(64_200),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Submit application',
      },
      {
        title: title('second-need analysis'),
        stage: 'Interview',
        bucket: 'current_month',
        slotOffset: 4,
        amount: commission(54_800),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Schedule review',
      },
      {
        title: title('estate discussion'),
        stage: 'Initial Contact',
        bucket: 'yesterday',
        slotOffset: 5,
        amount: commission(47_600),
        issued: false,
        docsReceived: 2,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Gather FICA',
      },
    ];
  }

  if (archetype === 'stalled') {
    return [
      {
        title: title('stalled fact-find'),
        stage: 'Interview',
        bucket: 'stale_7',
        slotOffset: 1,
        amount: commission(19_400),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: false,
      },
      {
        title: title('quotes unanswered'),
        stage: 'Analysis',
        bucket: 'stale_14',
        slotOffset: 2,
        amount: commission(22_700),
        issued: false,
        docsReceived: 2,
        ficaId: true,
        ficaResidence: true,
        ficaBank: false,
        nextAction: false,
      },
      {
        title: title('implementation drift'),
        stage: 'Implementation',
        bucket: 'stale_14',
        slotOffset: 3,
        amount: commission(27_100),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: false,
      },
    ];
  }

  if (archetype === 'missing_docs') {
    return [
      {
        title: title('awaiting FICA pack'),
        stage: 'Interview',
        bucket: 'current_month',
        slotOffset: 1,
        amount: commission(18_600),
        issued: false,
        docsReceived: 1,
        ficaId: true,
        ficaResidence: false,
        ficaBank: false,
        nextAction: true,
        nextActionTitle: 'Gather FICA',
      },
      {
        title: title('consent not returned'),
        stage: 'Initial Contact',
        bucket: 'yesterday',
        slotOffset: 2,
        amount: commission(16_200),
        issued: false,
        docsReceived: 0,
        ficaId: false,
        ficaResidence: false,
        ficaBank: false,
        nextAction: true,
        nextActionTitle: 'Gather FICA',
      },
      {
        title: title('bank proof outstanding'),
        stage: 'Analysis',
        bucket: 'hours_ago',
        slotOffset: 3,
        amount: commission(21_900),
        issued: false,
        docsReceived: 2,
        ficaId: true,
        ficaResidence: true,
        ficaBank: false,
        nextAction: true,
        nextActionTitle: 'Gather FICA',
      },
    ];
  }

  if (archetype === 'inactive') {
    return [
      {
        title: title('quiet pipeline file'),
        stage: STAGES[advisorIndex % 4],
        bucket: 'current_month',
        slotOffset: 1,
        amount: commission(15_400),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Call client',
      },
    ];
  }

  if (archetype === 'mixed') {
    return [
      {
        title: title('stalled servicing'),
        stage: 'Review',
        bucket: 'stale_7',
        slotOffset: 1,
        amount: commission(17_200),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: false,
      },
      {
        title: title('missing appointment letter'),
        stage: 'Interview',
        bucket: 'yesterday',
        slotOffset: 2,
        amount: commission(19_800),
        issued: false,
        docsReceived: 1,
        ficaId: true,
        ficaResidence: false,
        ficaBank: true,
        nextAction: true,
        nextActionTitle: 'Gather FICA',
      },
      {
        title: title('no next step logged'),
        stage: 'Recommendation',
        bucket: 'current_month',
        slotOffset: 3,
        amount: commission(23_500),
        issued: false,
        docsReceived: 3,
        ficaId: true,
        ficaResidence: true,
        ficaBank: true,
        nextAction: false,
      },
    ];
  }

  const extras: ExtraCaseSpec[] = [
    {
      title: title('discovery follow-up'),
      stage: 'Initial Contact',
      bucket: 'current_month',
      slotOffset: 1,
      amount: commission(16_800),
      issued: false,
      docsReceived: 3,
      ficaId: true,
      ficaResidence: true,
      ficaBank: true,
      nextAction: true,
      nextActionTitle: 'Call client',
    },
    {
      title: title('needs analysis'),
      stage: 'Interview',
      bucket: 'yesterday',
      slotOffset: 2,
      amount: commission(20_100),
      issued: false,
      docsReceived: 3,
      ficaId: true,
      ficaResidence: true,
      ficaBank: true,
      nextAction: true,
      nextActionTitle: 'Schedule review',
    },
  ];
  if (archetype === 'null_mobile') extras.pop();
  return extras;
};
