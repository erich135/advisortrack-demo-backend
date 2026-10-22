import { LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS } from '../../features/subscriptionFeatures';

export type SelfContactRow = {
  status: string;
  isPractice: boolean;
  activationStatus: string;
};

export type MyContactsSummaryProjection = {
  totalContacts: number;
  activeContacts: number;
  prospectCount: number;
  clientCount: number;
  inactiveCount: number;
  practiceContactCount: number;
  realContactCount: number;
  livePreviewActiveRealCount: number;
  livePreviewLimit: number;
};

export type MyContactsSummaryFocus =
  | 'total'
  | 'prospects'
  | 'clients'
  | 'inactive'
  | 'practice'
  | 'real'
  | 'live_preview'
  | 'overview';

export function projectMyContactsSummary(rows: SelfContactRow[]): MyContactsSummaryProjection {
  const empty: MyContactsSummaryProjection = {
    totalContacts: rows.length,
    activeContacts: 0,
    prospectCount: 0,
    clientCount: 0,
    inactiveCount: 0,
    practiceContactCount: 0,
    realContactCount: 0,
    livePreviewActiveRealCount: 0,
    livePreviewLimit: LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS,
  };
  return rows.reduce((summary, row) => {
    const status = row.status.toLowerCase();
    if (status === 'active') summary.activeContacts += 1;
    if (status === 'prospect') summary.prospectCount += 1;
    if (status === 'client') summary.clientCount += 1;
    if (status === 'inactive') summary.inactiveCount += 1;
    if (row.isPractice) summary.practiceContactCount += 1;
    else {
      summary.realContactCount += 1;
      if (row.activationStatus === 'active') summary.livePreviewActiveRealCount += 1;
    }
    return summary;
  }, empty);
}

export function detectMyContactsFocus(normalized: string): MyContactsSummaryFocus {
  if (/\bprospects?\b/.test(normalized)) return 'prospects';
  if (/\bclients?\b/.test(normalized) && !/\bcontacts?\b/.test(normalized)) return 'clients';
  if (/\binactive\b/.test(normalized)) return 'inactive';
  if (/\bpractice\b/.test(normalized)) return 'practice';
  if (/\breal contacts?\b/.test(normalized)) return 'real';
  if (/\blivepreview|live preview|slots?\b/.test(normalized)) return 'live_preview';
  if (/\bhow many contacts\b/.test(normalized)) return 'total';
  return 'overview';
}
