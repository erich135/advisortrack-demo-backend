/**
 * Pristine Northstar Advisory public-demo template (fictional).
 * Used by the seeder and ranking assertions. Never production customer data.
 */
export const NORTHSTAR_COMPANY_ID = 'd2222222-2222-4222-8222-222222222222';
export const NORTHSTAR_TEMPLATE_SLUG = 'northstar-advisory-master';
export const NORTHSTAR_SEED_VERSION = 12;
export const NORTHSTAR_VERSION_LABEL = 'phase12';
export const NORTHSTAR_COMPANY_NAME = 'Northstar Advisory';
export const NORTHSTAR_EMAIL_DOMAIN = 'northstar.demo.invalid';
export const NORTHSTAR_SEAT_LIMIT = 50;
export const NORTHSTAR_ASSIGNED_LICENCES = 42;
export const NORTHSTAR_AVAILABLE_LICENCES = 8;
export const NORTHSTAR_PASSWORD_HASH =
  '$2b$10$7qk.w275sP5l4htSpOtGcOI9sx8kV5NgiKpgzUhpVeSQ9.7aaBoru';
export const PHASE11_TEMPLATE_COMPANY_ID = 'd1111111-1111-4111-8111-111111111111';

export const NORTHSTAR_PERSONAS = {
  executive: { firstName: 'Alex', lastName: 'Rivera', emailLocal: 'alex.rivera' },
  regional_manager: { firstName: 'Jordan', lastName: 'Hale', emailLocal: 'jordan.hale' },
  team_leader: { firstName: 'Sam', lastName: 'Okonkwo', emailLocal: 'sam.okonkwo' },
} as const;

export const NORTHSTAR_LAST_MONTH_RANKINGS = {
  executive: { top: 'Jordan Hale', needs: 'Priya Naidoo' },
  regional_manager: { top: 'Sam Okonkwo', needs: 'Leah van Wyk' },
  team_leader: { top: 'Maya Brooks', needs: 'Thabo Nkosi' },
} as const;

export type NorthstarAdvisorSeed = {
  firstName: string;
  lastName: string;
  lastMonthIssued: number;
  licensed: boolean;
};

export type NorthstarTeamSeed = {
  name: string;
  leader: { firstName: string; lastName: string };
  lastMonthIssued: number;
  advisors: NorthstarAdvisorSeed[];
};

export type NorthstarRegionSeed = {
  name: string;
  manager: { firstName: string; lastName: string };
  lastMonthIssued: number;
  teams: NorthstarTeamSeed[];
};

export const NORTHSTAR_REGIONS: NorthstarRegionSeed[] = [
  {
    name: 'Coastal Region',
    manager: { firstName: 'Jordan', lastName: 'Hale' },
    lastMonthIssued: 2_450_000,
    teams: [
      {
        name: 'Harbour Team',
        leader: { firstName: 'Sam', lastName: 'Okonkwo' },
        lastMonthIssued: 1_120_000,
        advisors: [
          { firstName: 'Maya', lastName: 'Brooks', lastMonthIssued: 341_750, licensed: true },
          { firstName: 'Noah', lastName: 'Patel', lastMonthIssued: 268_400, licensed: true },
          { firstName: 'Sipho', lastName: 'Dlamini', lastMonthIssued: 209_150, licensed: true },
          { firstName: 'Elena', lastName: 'Rossi', lastMonthIssued: 175_900, licensed: true },
          { firstName: 'Thabo', lastName: 'Nkosi', lastMonthIssued: 124_800, licensed: true },
        ],
      },
      {
        name: 'Beacon Team',
        leader: { firstName: 'Chris', lastName: 'Mbeki' },
        lastMonthIssued: 780_000,
        advisors: [
          { firstName: 'Cara', lastName: 'Jensen', lastMonthIssued: 211_300, licensed: true },
          { firstName: 'Lyle', lastName: 'Naidoo', lastMonthIssued: 179_650, licensed: true },
          { firstName: 'Aisha', lastName: 'Rahman', lastMonthIssued: 154_200, licensed: true },
          { firstName: 'Brett', lastName: 'Coetzee', lastMonthIssued: 129_400, licensed: false },
          { firstName: 'Naledi', lastName: 'Molefe', lastMonthIssued: 105_450, licensed: false },
        ],
      },
      {
        name: 'Anchor Team',
        leader: { firstName: 'Leah', lastName: 'van Wyk' },
        lastMonthIssued: 550_000,
        advisors: [
          { firstName: 'Hugo', lastName: 'Strauss', lastMonthIssued: 149_800, licensed: true },
          { firstName: 'Zinhle', lastName: 'Mthembu', lastMonthIssued: 126_350, licensed: true },
          { firstName: 'Owen', lastName: 'Clarke', lastMonthIssued: 109_500, licensed: true },
          { firstName: 'Fatima', lastName: 'Jacobs', lastMonthIssued: 89_200, licensed: false },
          { firstName: 'Ruan', lastName: 'de Villiers', lastMonthIssued: 75_150, licensed: false },
        ],
      },
    ],
  },
  {
    name: 'Highveld Region',
    manager: { firstName: 'Daniel', lastName: 'Okoro' },
    lastMonthIssued: 1_680_000,
    teams: [
      {
        name: 'Ridge Team',
        leader: { firstName: 'Amara', lastName: 'Botha' },
        lastMonthIssued: 720_000,
        advisors: [
          { firstName: 'Keegan', lastName: 'Pillay', lastMonthIssued: 198_400, licensed: true },
          { firstName: 'Sihle', lastName: 'Ncube', lastMonthIssued: 164_250, licensed: true },
          { firstName: 'Dana', lastName: 'Kruger', lastMonthIssued: 139_800, licensed: true },
          { firstName: 'Yusuf', lastName: 'Hendricks', lastMonthIssued: 118_350, licensed: false },
          { firstName: 'Paige', lastName: 'Abrahams', lastMonthIssued: 99_200, licensed: false },
        ],
      },
      {
        name: 'Summit Team',
        leader: { firstName: 'Kwame', lastName: 'Ndlovu' },
        lastMonthIssued: 560_000,
        advisors: [
          { firstName: 'Imani', lastName: 'Reed', lastMonthIssued: 151_900, licensed: true },
          { firstName: 'Gareth', lastName: 'Fourie', lastMonthIssued: 128_600, licensed: true },
          { firstName: 'Boitumelo', lastName: 'Kgale', lastMonthIssued: 107_450, licensed: true },
          { firstName: 'Nina', lastName: 'Venter', lastMonthIssued: 91_700, licensed: false },
          { firstName: 'Andre', lastName: 'Steyn', lastMonthIssued: 80_350, licensed: false },
        ],
      },
      {
        name: 'Meadow Team',
        leader: { firstName: 'Ingrid', lastName: 'Vos' },
        lastMonthIssued: 400_000,
        advisors: [
          { firstName: 'Tariq', lastName: 'Mahomed', lastMonthIssued: 108_250, licensed: true },
          { firstName: 'Lauren', lastName: 'Peters', lastMonthIssued: 92_400, licensed: true },
          { firstName: 'Jabu', lastName: 'Sithole', lastMonthIssued: 76_800, licensed: true },
          { firstName: 'Chloe', lastName: 'Marais', lastMonthIssued: 65_150, licensed: false },
          { firstName: 'Wian', lastName: 'Bothma', lastMonthIssued: 57_400, licensed: false },
        ],
      },
    ],
  },
  {
    name: 'Karoo Region',
    manager: { firstName: 'Priya', lastName: 'Naidoo' },
    lastMonthIssued: 920_000,
    teams: [
      {
        name: 'Oasis Team',
        leader: { firstName: 'Farah', lastName: 'Abrahams' },
        lastMonthIssued: 410_000,
        advisors: [
          { firstName: 'Devan', lastName: 'Govender', lastMonthIssued: 112_600, licensed: true },
          { firstName: 'Kira', lastName: 'Mokoena', lastMonthIssued: 94_350, licensed: true },
          { firstName: 'Sean', lastName: 'Hartley', lastMonthIssued: 78_900, licensed: true },
          { firstName: 'Ayanda', lastName: 'Zulu', lastMonthIssued: 66_400, licensed: false },
          { firstName: 'Mia', lastName: 'Du Plessis', lastMonthIssued: 57_750, licensed: false },
        ],
      },
      {
        name: 'Canyon Team',
        leader: { firstName: 'Pieter', lastName: 'Smit' },
        lastMonthIssued: 310_000,
        advisors: [
          { firstName: 'Nandi', lastName: 'Cele', lastMonthIssued: 86_200, licensed: true },
          { firstName: 'Ryan', lastName: 'Chetty', lastMonthIssued: 71_850, licensed: true },
          { firstName: 'Lesedi', lastName: 'Phiri', lastMonthIssued: 59_400, licensed: true },
          { firstName: 'Hannah', lastName: 'Viljoen', lastMonthIssued: 49_900, licensed: false },
          { firstName: 'Theo', lastName: 'Barnard', lastMonthIssued: 42_650, licensed: false },
        ],
      },
      {
        name: 'Koppie Team',
        leader: { firstName: 'Lindiwe', lastName: 'Khumalo' },
        lastMonthIssued: 200_000,
        advisors: [
          { firstName: 'Omar', lastName: 'Salie', lastMonthIssued: 54_800, licensed: true },
          { firstName: 'Jessica', lastName: 'Naicker', lastMonthIssued: 46_250, licensed: true },
          { firstName: 'Bongani', lastName: 'Dube', lastMonthIssued: 38_700, licensed: true },
          { firstName: 'Caitlyn', lastName: 'Rossouw', lastMonthIssued: 32_150, licensed: false },
          { firstName: 'Elias', lastName: 'Mahlangu', lastMonthIssued: 28_100, licensed: false },
        ],
      },
    ],
  },
];

export const northstarEmail = (firstName: string, lastName: string): string => {
  const local = `${firstName}.${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${local}@${NORTHSTAR_EMAIL_DOMAIN}`;
};

export const countNorthstarPeople = (): {
  executives: number;
  regionalManagers: number;
  teamLeaders: number;
  advisors: number;
  regions: number;
  teams: number;
  licensed: number;
} => {
  let teamLeaders = 0;
  let advisors = 0;
  let licensed = 1;
  for (const region of NORTHSTAR_REGIONS) {
    licensed += 1;
    for (const team of region.teams) {
      teamLeaders += 1;
      licensed += 1;
      for (const advisor of team.advisors) {
        advisors += 1;
        if (advisor.licensed) licensed += 1;
      }
    }
  }
  return {
    executives: 1,
    regionalManagers: NORTHSTAR_REGIONS.length,
    teamLeaders,
    advisors,
    regions: NORTHSTAR_REGIONS.length,
    teams: teamLeaders,
    licensed,
  };
};
