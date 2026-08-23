import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from '../utils/auth';
import {
  Activity,
  Contact,
  Production,
  ProductionType,
  UserRecord,
} from '../types';

/**
 * In-memory seed data — replace with a database layer when ready.
 */
export const DEMO_USER_ID = 'user-1';

export const seedUsers: UserRecord[] = [
  {
    id: DEMO_USER_ID,
    firstName: 'John',
    lastName: 'Mitchell',
    email: 'john.mitchell@advisortrack.com',
    phone: '(555) 123-4567',
    company: 'Mitchell Financial Group',
    role: 'Financial Advisor',
    emailVerifiedAt: '2024-01-15T10:00:00Z',
    createdAt: '2024-01-15T10:00:00Z',
    passwordHash: '',
  },
];

export const seedContacts: Contact[] = [
  {
    id: 'contact-1',
    userId: DEMO_USER_ID,
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@email.com',
    phone: '(555) 234-5678',
    company: 'Johnson & Associates',
    status: 'active',
    priority: 'high',
    rating: 4.5,
    notes: 'Interested in retirement planning package.',
    lastContactedAt: '2025-06-10T14:00:00Z',
    isPractice: false,
    activationStatus: 'active',
    createdAt: '2025-01-20T09:00:00Z',
  },
  {
    id: 'contact-2',
    userId: DEMO_USER_ID,
    firstName: 'Michael',
    lastName: 'Chen',
    email: 'michael.chen@email.com',
    phone: '(555) 345-6789',
    company: 'Chen Tech Solutions',
    status: 'prospect',
    priority: 'medium',
    rating: 3.5,
    lastContactedAt: '2025-06-05T11:30:00Z',
    isPractice: false,
    activationStatus: 'active',
    createdAt: '2025-02-14T10:00:00Z',
  },
  {
    id: 'contact-6',
    userId: DEMO_USER_ID,
    firstName: 'Jennifer',
    lastName: 'Homan',
    email: 'jennifer.homan@email.com',
    phone: '(555) 789-0123',
    status: 'active',
    priority: 'high',
    rating: 4,
    lastContactedAt: '2025-06-14T10:00:00Z',
    isPractice: false,
    activationStatus: 'active',
    createdAt: '2025-03-01T09:00:00Z',
  },
];

export const seedActivities: Activity[] = [
  {
    id: 'activity-1',
    userId: DEMO_USER_ID,
    title: 'Quarterly review call',
    type: 'call',
    status: 'scheduled',
    contactId: 'contact-1',
    contactName: 'Sarah Johnson',
    description: 'Review portfolio performance',
    scheduledAt: '2025-06-18T10:00:00Z',
    durationMinutes: 30,
    createdAt: '2025-06-01T08:00:00Z',
  },
  {
    id: 'activity-2',
    userId: DEMO_USER_ID,
    title: 'Initial consultation',
    type: 'meeting',
    status: 'completed',
    contactId: 'contact-2',
    contactName: 'Michael Chen',
    scheduledAt: '2025-06-12T14:00:00Z',
    durationMinutes: 60,
    createdAt: '2025-06-10T09:00:00Z',
  },
];

export const seedProductions: Production[] = [
  {
    id: 'production-1',
    userId: DEMO_USER_ID,
    title: 'Life policy commission',
    type: 'commission',
    amount: 8744.9,
    contactId: 'contact-6',
    contactName: 'Jennifer Homan',
    productName: 'Life Cover',
    date: '2025-08-14',
    createdAt: '2025-08-14T12:00:00Z',
  },
  {
    id: 'production-2',
    userId: DEMO_USER_ID,
    title: 'Advisory fee',
    type: 'fee',
    amount: 2500,
    contactId: 'contact-1',
    contactName: 'Sarah Johnson',
    date: '2025-06-01',
    createdAt: '2025-06-01T09:00:00Z',
  },
];

export const PRODUCTION_GOAL = 50000;

/**
 * Initializes in-memory stores with hashed demo credentials.
 */
export const createStore = async () => {
  const demoPassword = await hashPassword('password');

  return {
    users: seedUsers.map((user) =>
      user.id === DEMO_USER_ID ? { ...user, passwordHash: demoPassword } : user
    ),
    contacts: [...seedContacts],
    activities: [...seedActivities],
    productions: [...seedProductions],
  };
};

export type DataStore = Awaited<ReturnType<typeof createStore>>;

/**
 * Generates a new UUID for created records.
 */
export const newId = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;

/**
 * Aggregates production totals for the dashboard summary endpoint.
 */
export const buildProductionSummary = (
  productions: Production[],
  goal = PRODUCTION_GOAL
) => {
  const byType: Record<ProductionType, number> = {
    commission: 0,
    fee: 0,
    bonus: 0,
    renewal: 0,
    other: 0,
  };

  let total = 0;
  let month = new Date().toISOString().slice(0, 7);

  for (const entry of productions) {
    total += entry.amount;
    byType[entry.type] += entry.amount;
    if (entry.date.slice(0, 7) > month) {
      month = entry.date.slice(0, 7);
    }
  }

  return { month, total, goal, byType };
};
