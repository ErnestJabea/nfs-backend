export type SupportedCountry = {
  code: string;
  name: string;
  currency: string;
  aliases: string[];
};

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  { code: 'CMR', name: 'Cameroun', currency: 'XAF', aliases: ['cameroon'] },
  { code: 'GAB', name: 'Gabon', currency: 'XAF', aliases: [] },
  { code: 'TCD', name: 'Tchad', currency: 'XAF', aliases: ['chad'] },
  { code: 'COG', name: 'République du Congo', currency: 'XAF', aliases: ['congo', 'congo brazzaville'] },
  { code: 'CAF', name: 'République centrafricaine', currency: 'XAF', aliases: ['centrafrique'] },
  { code: 'GNQ', name: 'Guinée équatoriale', currency: 'XAF', aliases: ['equatorial guinea'] },
  { code: 'COD', name: 'République démocratique du Congo', currency: 'CDF', aliases: ['rdc', 'congo kinshasa'] },
  { code: 'NGA', name: 'Nigeria', currency: 'NGN', aliases: [] },
  { code: 'SEN', name: 'Sénégal', currency: 'XOF', aliases: [] },
  { code: 'CIV', name: "Côte d’Ivoire", currency: 'XOF', aliases: ['cote d ivoire'] },
  { code: 'BEN', name: 'Bénin', currency: 'XOF', aliases: [] },
  { code: 'TGO', name: 'Togo', currency: 'XOF', aliases: [] },
  { code: 'MLI', name: 'Mali', currency: 'XOF', aliases: [] },
  { code: 'BFA', name: 'Burkina Faso', currency: 'XOF', aliases: [] },
  { code: 'NER', name: 'Niger', currency: 'XOF', aliases: [] },
  { code: 'GNB', name: 'Guinée-Bissau', currency: 'XOF', aliases: ['guinee bissau'] },
  { code: 'FRA', name: 'France', currency: 'EUR', aliases: [] },
  { code: 'BEL', name: 'Belgique', currency: 'EUR', aliases: ['belgium'] },
  { code: 'DEU', name: 'Allemagne', currency: 'EUR', aliases: ['germany'] },
  { code: 'ESP', name: 'Espagne', currency: 'EUR', aliases: ['spain'] },
  { code: 'ITA', name: 'Italie', currency: 'EUR', aliases: ['italy'] },
  { code: 'PRT', name: 'Portugal', currency: 'EUR', aliases: [] },
  { code: 'GBR', name: 'Royaume-Uni', currency: 'GBP', aliases: ['united kingdom'] },
  { code: 'CHE', name: 'Suisse', currency: 'CHF', aliases: ['switzerland'] },
  { code: 'USA', name: 'États-Unis', currency: 'USD', aliases: ['united states', 'etats unis'] },
  { code: 'CAN', name: 'Canada', currency: 'CAD', aliases: [] },
];

const normalize = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export const resolveCountry = (value: unknown) => {
  const normalized = normalize(value);
  return SUPPORTED_COUNTRIES.find(country => [
    normalize(country.code),
    normalize(country.name),
    ...country.aliases.map(normalize),
  ].includes(normalized)) || null;
};

export const publicCountries = () => SUPPORTED_COUNTRIES.map(({ aliases: _aliases, ...country }) => country);
