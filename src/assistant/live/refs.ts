import { randomBytes } from 'node:crypto';
import { ForgedEntityRefError, type EntityKind, type EntityRef, type StoredEntity, type TurnRefTable } from './types';

export function createTurnRefTable(): TurnRefTable {
  return {
    turnId: `turn_${randomBytes(6).toString('hex')}`,
    entries: new Map(),
  };
}

export function mintEntityRef(table: TurnRefTable, entity: StoredEntity): EntityRef {
  let ref: EntityRef = `ent_${randomBytes(4).toString('hex')}`;
  while (table.entries.has(ref)) {
    ref = `ent_${randomBytes(4).toString('hex')}`;
  }
  table.entries.set(ref, entity);
  return ref;
}

export function mintPersonRef(
  table: TurnRefTable,
  person: { id: string; companyId: string },
): EntityRef {
  return mintEntityRef(table, {
    kind: 'person',
    internalId: person.id,
    companyId: person.companyId,
  });
}

export function mintTeamRef(
  table: TurnRefTable,
  team: { id: string; companyId: string },
): EntityRef {
  return mintEntityRef(table, {
    kind: 'team',
    internalId: team.id,
    companyId: team.companyId,
  });
}

export function mintRegionRef(
  table: TurnRefTable,
  region: { id: string; companyId: string },
): EntityRef {
  return mintEntityRef(table, {
    kind: 'region',
    internalId: region.id,
    companyId: region.companyId,
  });
}

export function readEntityRef(table: TurnRefTable, ref: string, kind?: EntityKind): StoredEntity {
  const stored = table.entries.get(ref);
  if (!stored || (kind && stored.kind !== kind)) {
    throw new ForgedEntityRefError(ref);
  }
  return stored;
}
