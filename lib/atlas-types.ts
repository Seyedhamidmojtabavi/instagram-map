import taxonomy from "./categories.json";

export type Family = (typeof taxonomy.families)[number];
export type CategoryDef = (typeof taxonomy.categories)[number] & { hiddenFromDirectory?: boolean };

export const families: Family[] = taxonomy.families;
export const categories: CategoryDef[] = taxonomy.categories;
export const familyById = new Map(families.map((family) => [family.id, family]));
export const categoryById = new Map(categories.map((category) => [category.id, category]));

export function familyForCategory(categoryId: string | null | undefined): Family {
  const familyId = categoryById.get(categoryId ?? "")?.family ?? "people";
  return familyById.get(familyId) ?? families[families.length - 1];
}

export type PlaceProperties = {
  pk: string;
  username: string;
  fullName: string;
  biography?: string;
  address?: string;
  categories: string[];
  primaryCategory: string;
  family: string;
  color: string;
  instagramUrl?: string;
  geocodeMethod?: string;
  geocodeConfidence?: number | null;
};

export type Place = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: PlaceProperties;
};

export type DirectoryEntry = {
  pk: string;
  username: string;
  fullName: string;
  categories: string[];
  primaryCategory: string | null;
  family: string | null;
  verified: boolean;
  bio: string;
  located: boolean;
  pending: boolean;
};

export type Atlas = {
  type: "FeatureCollection";
  generatedAt: string | null;
  lastSyncAt: string | null;
  source: { username: string } | null;
  stats: {
    following: number;
    listed: number;
    located: number;
    awaitingReview: number;
    hidden: number;
    pendingProfiles: number;
  };
  sync: { finishedAt: string; ok: boolean; message: string | null } | null;
  features: Place[];
  directory: DirectoryEntry[];
};
