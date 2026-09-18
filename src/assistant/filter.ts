import { cardMatchesCapabilities } from './context';
import { classificationForRoute, routeById } from './routes';
import type { AssistantRoute, CardFilter, KnowledgeCard } from './types';

export type FilterableCard = Pick<
  KnowledgeCard,
  'environment' | 'audience' | 'requiredCapabilities' | 'routes'
>;

function environmentMatches(cardEnv: KnowledgeCard['environment'], environment: CardFilter['environment']): boolean {
  return cardEnv === 'both' || cardEnv === environment;
}

function audienceMatches(cardAudience: KnowledgeCard['audience'], audience: CardFilter['audience']): boolean {
  if (audience === 'staff') return true;
  return cardAudience === 'customer' || cardAudience === 'both';
}

function routesAllowedForCustomer(
  card: FilterableCard,
  environment: CardFilter['environment'],
  resolveRoute: (routeId: string) => AssistantRoute | undefined = routeById,
): boolean {
  return card.routes.every((routeId) => {
    const route = resolveRoute(routeId);
    if (!route) return false;
    if (route.environment !== 'both' && route.environment !== environment) return false;
    return classificationForRoute(route, environment) === 'customer';
  });
}

export function filterCards<T extends FilterableCard>(
  cards: T[],
  filter: CardFilter,
  resolveRoute: (routeId: string) => AssistantRoute | undefined = routeById,
): T[] {
  return cards.filter((card) => {
    if (!environmentMatches(card.environment, filter.environment)) return false;
    if (!audienceMatches(card.audience, filter.audience)) return false;
    if (filter.audience === 'customer' && card.audience === 'staff') return false;
    if (filter.audience === 'customer' && !routesAllowedForCustomer(card, filter.environment, resolveRoute)) {
      return false;
    }
    if (filter.capabilities && !cardMatchesCapabilities(card.requiredCapabilities, filter.capabilities)) {
      return false;
    }
    return true;
  });
}

export function filterCategories(
  categories: Array<{ id: string; environment: KnowledgeCard['environment'] }>,
  environment: CardFilter['environment'],
): Array<{ id: string; environment: KnowledgeCard['environment'] }> {
  return categories.filter(
    (category) => category.environment === 'both' || category.environment === environment,
  );
}
