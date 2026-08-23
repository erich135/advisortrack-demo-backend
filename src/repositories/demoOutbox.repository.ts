import { getPool } from '../config/database';

export type DemoOutboxEvent = {
  id: string;
  company_id: string | null;
  session_id: string | null;
  actor_user_id: string | null;
  action: string;
  recipient: string | null;
  payload: Record<string, unknown>;
  status: 'simulated';
  created_at: Date;
};

export const demoOutboxRepository = {
  async insert(input: {
    companyId?: string | null;
    sessionId?: string | null;
    actorUserId?: string | null;
    action: string;
    recipient?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<DemoOutboxEvent> {
    const result = await getPool().query<DemoOutboxEvent>(
      `INSERT INTO demo_outbox_events (
         company_id, session_id, actor_user_id, action, recipient, payload, status
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'simulated')
       RETURNING id, company_id, session_id, actor_user_id, action, recipient, payload, status, created_at`,
      [
        input.companyId ?? null,
        input.sessionId ?? null,
        input.actorUserId ?? null,
        input.action,
        input.recipient ?? null,
        JSON.stringify(input.payload ?? {}),
      ]
    );
    return result.rows[0];
  },
};
