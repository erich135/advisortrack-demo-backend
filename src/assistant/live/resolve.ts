import { mintPersonRef, mintRegionRef, mintTeamRef } from './refs';
import { displayNameOf, levenshtein, normalizeName, stripUnitLabel } from './names';
import type {
  DirectoryPerson,
  DirectoryRegion,
  DirectoryTeam,
  EntityMatchTier,
  EntityRef,
  TurnRefTable,
} from './types';

export type ResolvedPersonCandidate = {
  ref: EntityRef;
  displayName: string;
  reportingRoleLabel: string;
  teamName: string | null;
  regionName: string | null;
  tier: EntityMatchTier;
  person: DirectoryPerson;
};

export type PersonResolution =
  | { kind: 'resolved'; candidate: ResolvedPersonCandidate }
  | { kind: 'ambiguous'; candidates: ResolvedPersonCandidate[] }
  | { kind: 'not_found_in_scope' };

export type ResolvedUnitCandidate = {
  kind: 'team' | 'region';
  ref: EntityRef;
  displayName: string;
  detail: string | null;
  tier: EntityMatchTier;
  team?: DirectoryTeam;
  region?: DirectoryRegion;
};

export type UnitResolution =
  | { kind: 'resolved'; candidate: ResolvedUnitCandidate }
  | { kind: 'ambiguous'; candidates: ResolvedUnitCandidate[] }
  | { kind: 'not_found_in_scope' };

const DISAMBIGUATE_MAX = 5;

function tokenise(name: string): string[] {
  return normalizeName(name).split(/\s+/).filter(Boolean);
}

function matchTier(mention: string, person: DirectoryPerson): EntityMatchTier | null {
  const query = tokenise(mention);
  const first = normalizeName(person.firstName);
  const last = normalizeName(person.lastName);
  const full = tokenise(displayNameOf(person)).join(' ');
  const queryFull = query.join(' ');

  if (queryFull === full) return 'exact_full_name';
  if (query.length === 1 && query[0] === last) return 'unique_surname';
  if (query.length === 1 && query[0] === first) return 'unique_given_name';

  const distance = levenshtein(queryFull, full);
  const fuzzyBudget = full.length >= 8 ? 2 : 1;
  if (distance > 0 && distance <= fuzzyBudget) return 'fuzzy';
  if (query.length === 2 && query[0] === first && levenshtein(query[1], last) === 1) return 'fuzzy';
  if (query.length === 2 && query[1] === last && levenshtein(query[0], first) === 1) return 'fuzzy';
  return null;
}

function matchUnitName(mention: string, name: string): EntityMatchTier | null {
  const query = stripUnitLabel(mention);
  const full = normalizeName(name);
  const stripped = stripUnitLabel(name);
  if (!query) return null;
  if (query === full || query === stripped) return 'exact_full_name';
  const distance = levenshtein(query, stripped || full);
  const target = stripped || full;
  const fuzzyBudget = target.length >= 8 ? 2 : 1;
  if (distance > 0 && distance <= fuzzyBudget) return 'fuzzy';
  return null;
}

function toCandidate(person: DirectoryPerson, tier: EntityMatchTier, refs: TurnRefTable): ResolvedPersonCandidate {
  return {
    ref: mintPersonRef(refs, person),
    displayName: displayNameOf(person),
    reportingRoleLabel: person.reportingRoleLabel,
    teamName: person.teamName,
    regionName: person.regionName,
    tier,
    person,
  };
}

/**
 * Search only inside the already-scoped directory. Never inspect out-of-scope people.
 */
export function resolvePersonInScope(
  mention: string,
  scopedPeople: DirectoryPerson[],
  refs: TurnRefTable,
): PersonResolution {
  const hits = scopedPeople
    .map((person) => {
      const tier = matchTier(mention, person);
      return tier ? toCandidate(person, tier, refs) : null;
    })
    .filter((hit): hit is ResolvedPersonCandidate => Boolean(hit));

  if (!hits.length) return { kind: 'not_found_in_scope' };

  const exact = hits.filter((hit) => hit.tier === 'exact_full_name');
  if (exact.length === 1) return { kind: 'resolved', candidate: exact[0] };
  if (exact.length > 1) {
    return { kind: 'ambiguous', candidates: exact.slice(0, DISAMBIGUATE_MAX) };
  }

  const given = hits.filter((hit) => hit.tier === 'unique_given_name');
  if (given.length === 1 && hits.every((hit) => hit.tier === 'unique_given_name' || hit.person.id === given[0].person.id)) {
    return { kind: 'resolved', candidate: given[0] };
  }
  if (given.length > 1) {
    return { kind: 'ambiguous', candidates: given.slice(0, DISAMBIGUATE_MAX) };
  }

  const surname = hits.filter((hit) => hit.tier === 'unique_surname');
  if (surname.length === 1 && hits.filter((hit) => hit.tier === 'unique_surname').length === 1) {
    return { kind: 'resolved', candidate: surname[0] };
  }
  if (surname.length > 1) {
    return { kind: 'ambiguous', candidates: surname.slice(0, DISAMBIGUATE_MAX) };
  }

  const fuzzy = hits.filter((hit) => hit.tier === 'fuzzy');
  if (fuzzy.length) {
    return { kind: 'ambiguous', candidates: fuzzy.slice(0, DISAMBIGUATE_MAX) };
  }

  if (hits.length === 1 && hits[0].tier !== 'fuzzy') {
    return { kind: 'resolved', candidate: hits[0] };
  }
  return { kind: 'ambiguous', candidates: hits.slice(0, DISAMBIGUATE_MAX) };
}

function finishUnitHits(hits: ResolvedUnitCandidate[]): UnitResolution {
  if (!hits.length) return { kind: 'not_found_in_scope' };
  const exact = hits.filter((hit) => hit.tier === 'exact_full_name');
  if (exact.length === 1) return { kind: 'resolved', candidate: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.slice(0, DISAMBIGUATE_MAX) };
  const fuzzy = hits.filter((hit) => hit.tier === 'fuzzy');
  if (fuzzy.length === 1 && hits.length === 1) return { kind: 'resolved', candidate: fuzzy[0] };
  if (fuzzy.length) return { kind: 'ambiguous', candidates: fuzzy.slice(0, DISAMBIGUATE_MAX) };
  if (hits.length === 1) return { kind: 'resolved', candidate: hits[0] };
  return { kind: 'ambiguous', candidates: hits.slice(0, DISAMBIGUATE_MAX) };
}

export function resolveTeamInScope(
  mention: string,
  scopedTeams: DirectoryTeam[],
  refs: TurnRefTable,
): UnitResolution {
  const hits: ResolvedUnitCandidate[] = [];
  for (const team of scopedTeams) {
    const tier = matchUnitName(mention, team.name);
    if (!tier) continue;
    hits.push({
      kind: 'team',
      ref: mintTeamRef(refs, team),
      displayName: team.name,
      detail: [team.leaderName, team.regionName].filter(Boolean).join(' · ') || null,
      tier,
      team,
    });
  }
  return finishUnitHits(hits);
}

export function resolveRegionInScope(
  mention: string,
  scopedRegions: DirectoryRegion[],
  refs: TurnRefTable,
): UnitResolution {
  const hits: ResolvedUnitCandidate[] = [];
  for (const region of scopedRegions) {
    const tier = matchUnitName(mention, region.name);
    if (!tier) continue;
    hits.push({
      kind: 'region',
      ref: mintRegionRef(refs, region),
      displayName: region.name,
      detail: region.managerName,
      tier,
      region,
    });
  }
  return finishUnitHits(hits);
}
