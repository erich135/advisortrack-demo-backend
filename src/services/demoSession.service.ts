import crypto from 'crypto';
import { env } from '../config/env';
import { isDatabaseActive } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { organisationRepository } from '../repositories/organisation.repository';
import { demoPersonaRepository } from '../repositories/demoPersona.repository';
import { demoWorkspaceRepository } from '../repositories/demoWorkspace.repository';
import { userRepository } from '../repositories/user.repository';
import { organisationService } from './organisation.service';
import { signToken, toUserDto } from '../utils/auth';
import { isRejectedDemoRole, parseDemoPublicRole } from '../features/demoRoles';
import { demoSessionTtlMsFromMinutes } from '../features/demoSessionPolicy';
import {
  demoSessionRepository,
  hashDemoSessionToken,
  type DemoSelectedRole,
  type DemoSessionRow,
} from '../repositories/demoSession.repository';

const sessionTtlMs = (): number => demoSessionTtlMsFromMinutes(env.demoSessionTtlMinutes);

const toDto = (row: DemoSessionRow) => ({
  id: row.id,
  companyId: row.company_id,
  selectedRole: row.selected_role,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

const requireDemoMode = () => {
  if (!env.isDemoMode) {
    throw new AppError(404, 'Demo sessions are not available in this environment', 'NOT_FOUND');
  }
  if (!isDatabaseActive()) {
    throw new AppError(503, 'Database unavailable', 'DB_UNAVAILABLE');
  }
};

const requirePermittedRole = (value: unknown): DemoSelectedRole => {
  if (isRejectedDemoRole(value)) {
    throw new AppError(403, 'That role is not available in the public demo.', 'DEMO_ROLE_FORBIDDEN');
  }
  const role = parseDemoPublicRole(value);
  if (!role) {
    throw new AppError(400, 'Choose Executive, Regional Manager, or Team Leader.', 'DEMO_ROLE_REQUIRED');
  }
  return role;
};

const attachUser = async (userId: string) => {
  const user = await userRepository.findById(userId);
  if (!user || user.isActive === false) {
    throw new AppError(401, 'Demo persona is not available', 'DEMO_PERSONA_MISSING');
  }
  try {
    const organisation = await organisationService.getMyOrganisation(userId);
    return { ...toUserDto(user), organisation };
  } catch {
    return toUserDto(user);
  }
};

const mintJwt = (userId: string, email: string, session: DemoSessionRow) => {
  const remainingMs = session.expires_at.getTime() - Date.now();
  const expiresIn = Math.max(60, Math.floor(remainingMs / 1000));
  return signToken({ userId, email, demoSessionId: session.id }, expiresIn);
};

const personaFor = async (companyId: string, role: DemoSelectedRole) => {
  const persona = await demoPersonaRepository.findActive(companyId, role);
  if (!persona) {
    throw new AppError(500, 'Demo persona mapping is missing for this workspace', 'DEMO_PERSONA_MISSING');
  }
  const membership = await organisationRepository.findMembership(persona.user_id);
  if (!membership || membership.company_id !== companyId) {
    throw new AppError(500, 'Demo persona does not belong to this workspace', 'DEMO_PERSONA_COMPANY_MISMATCH');
  }
  return persona;
};

const markExpiredIfNeeded = async (row: DemoSessionRow): Promise<DemoSessionRow> => {
  if (row.status === 'active' && row.expires_at.getTime() <= Date.now()) {
    const expired = await demoSessionRepository.setStatus(row.id, 'expired');
    if (row.company_id && !(await demoWorkspaceRepository.isTemplateCompany(row.company_id))) {
      await organisationRepository.updateCompany(row.company_id, { isActive: false });
    }
    return expired ?? { ...row, status: 'expired' };
  }
  return row;
};

export const demoSessionService = {
  /**
   * Creates an opaque demo session. The visitor company is stored server-side.
   * Callers must not treat a client-supplied companyId as the security boundary
   * unless it is written here after server-side creation.
   */
  async create(input?: {
    companyId?: string | null;
    selectedRole?: DemoSelectedRole | null;
    ttlMs?: number;
  }) {
    requireDemoMode();
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashDemoSessionToken(token);
    const expiresAt = new Date(Date.now() + (input?.ttlMs ?? sessionTtlMs()));
    const row = await demoSessionRepository.insert({
      tokenHash,
      companyId: input?.companyId ?? null,
      selectedRole: input?.selectedRole ?? null,
      expiresAt,
    });
    return { token, session: toDto(row) };
  },

  async resolveFromToken(token: string) {
    requireDemoMode();
    const row = await demoSessionRepository.findByTokenHash(hashDemoSessionToken(token));
    if (!row) {
      throw new AppError(401, 'Demo session is not valid', 'UNAUTHORIZED');
    }
    const current = await markExpiredIfNeeded(row);
    if (current.status !== 'active' || current.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, 'Demo session has expired', 'DEMO_SESSION_EXPIRED');
    }
    return toDto(current);
  },

  async resolveActiveById(sessionId: string): Promise<DemoSessionRow> {
    requireDemoMode();
    const row = await demoSessionRepository.findById(sessionId);
    if (!row) {
      throw new AppError(401, 'Demo session is not valid', 'DEMO_SESSION_EXPIRED');
    }
    const current = await markExpiredIfNeeded(row);
    if (current.status === 'archived') {
      throw new AppError(401, 'Demo session is no longer available', 'DEMO_SESSION_EXPIRED');
    }
    if (current.status !== 'active' || current.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, 'Demo session has expired', 'DEMO_SESSION_EXPIRED');
    }
    if (!current.company_id || !current.selected_role) {
      throw new AppError(401, 'Demo session is not valid', 'DEMO_SESSION_EXPIRED');
    }
    return current;
  },

  /**
   * Confirms a bearer JWT is bound to an active demo session and the mapped persona.
   */
  async assertJwtBinding(input: { userId: string; demoSessionId?: string }): Promise<DemoSessionRow> {
    requireDemoMode();
    if (!input.demoSessionId) {
      throw new AppError(401, 'A demo session is required', 'DEMO_SESSION_REQUIRED');
    }
    const session = await this.resolveActiveById(input.demoSessionId);
    const persona = await personaFor(session.company_id!, session.selected_role!);
    if (persona.user_id !== input.userId) {
      throw new AppError(403, 'This demo identity does not match the session.', 'DEMO_PERSONA_MISMATCH');
    }
    const membership = await organisationRepository.findMembership(input.userId);
    if (!membership?.company_id || membership.company_id !== session.company_id) {
      throw new AppError(403, 'This demo identity is outside the session workspace.', 'DEMO_WORKSPACE_MISMATCH');
    }
    return session;
  },

  /**
   * Provisions an isolated visitor company and signs in as the selected persona.
   * Ignores any client-supplied companyId.
   */
  async enter(selectedRoleRaw: unknown) {
    requireDemoMode();
    const selectedRole = requirePermittedRole(selectedRoleRaw);
    const cloned = await demoWorkspaceRepository.cloneFromActiveTemplate();
    const created = await this.create({
      companyId: cloned.companyId,
      selectedRole,
    });
    const row = await demoSessionRepository.findById(created.session.id);
    if (!row?.company_id) {
      throw new AppError(500, 'Demo session was not linked to a workspace', 'DEMO_PROVISION_FAILED');
    }
    const persona = await personaFor(row.company_id, selectedRole);
    const user = await attachUser(persona.user_id);
    const jwt = mintJwt(persona.user_id, user.email, row);
    return {
      token: jwt,
      session: toDto(row),
      user,
    };
  },

  async switchRole(sessionId: string, selectedRoleRaw: unknown) {
    requireDemoMode();
    const selectedRole = requirePermittedRole(selectedRoleRaw);
    const session = await this.resolveActiveById(sessionId);
    const updated = await demoSessionRepository.setSelectedRole(session.id, selectedRole);
    const current = updated ?? session;
    const persona = await personaFor(current.company_id!, selectedRole);
    const user = await attachUser(persona.user_id);
    const jwt = mintJwt(persona.user_id, user.email, current);
    return {
      token: jwt,
      session: toDto({ ...current, selected_role: selectedRole }),
      user,
    };
  },

  async current(sessionId: string) {
    const session = await this.resolveActiveById(sessionId);
    const persona = await personaFor(session.company_id!, session.selected_role!);
    const user = await attachUser(persona.user_id);
    return {
      session: toDto(session),
      user,
    };
  },

  /**
   * Marks the session expired and archives the associated company.
   * Never hard-deletes sessions or companies.
   */
  async expire(sessionId: string) {
    requireDemoMode();
    const existing = await demoSessionRepository.findById(sessionId);
    if (!existing) {
      throw new AppError(404, 'Demo session not found', 'NOT_FOUND');
    }
    const updated = await demoSessionRepository.setStatus(sessionId, 'expired');
    if (existing.company_id && !(await demoWorkspaceRepository.isTemplateCompany(existing.company_id))) {
      await organisationRepository.updateCompany(existing.company_id, { isActive: false });
    }
    return toDto(updated!);
  },

  async archive(sessionId: string) {
    requireDemoMode();
    const existing = await demoSessionRepository.findById(sessionId);
    if (!existing) {
      throw new AppError(404, 'Demo session not found', 'NOT_FOUND');
    }
    const updated = await demoSessionRepository.setStatus(sessionId, 'archived');
    if (existing.company_id && !(await demoWorkspaceRepository.isTemplateCompany(existing.company_id))) {
      await organisationRepository.updateCompany(existing.company_id, { isActive: false });
    }
    return toDto(updated!);
  },

  /**
   * Archives the current visitor company (retaining rows), clones a fresh
   * Northstar workspace, repoints this session, and issues a new JWT.
   * Other visitors are untouched. Role is preserved when still mapped.
   */
  async reset(sessionId: string) {
    requireDemoMode();
    const session = await this.resolveActiveById(sessionId);
    const selectedRole = session.selected_role;
    if (!selectedRole || !session.company_id) {
      throw new AppError(401, 'Demo session is not valid', 'DEMO_SESSION_EXPIRED');
    }

    const previousCompanyId = session.company_id;
    const cloned = await demoWorkspaceRepository.cloneFromActiveTemplate();
    if (cloned.companyId === previousCompanyId) {
      throw new AppError(500, 'Demo reset did not provision a new company', 'DEMO_PROVISION_FAILED');
    }

    if (!(await demoWorkspaceRepository.isTemplateCompany(previousCompanyId))) {
      await organisationRepository.updateCompany(previousCompanyId, { isActive: false });
    }

    const expiresAt = new Date(Date.now() + sessionTtlMs());
    const updated = await demoSessionRepository.repoint({
      id: session.id,
      companyId: cloned.companyId,
      selectedRole,
      expiresAt,
    });
    const current = updated ?? { ...session, company_id: cloned.companyId, expires_at: expiresAt };
    const persona = await personaFor(current.company_id!, selectedRole);
    const user = await attachUser(persona.user_id);
    const jwt = mintJwt(persona.user_id, user.email, current);
    return {
      token: jwt,
      session: toDto(current),
      user,
    };
  },
};
