export interface ProviderField {
  name: string;
  value?: unknown;
  [key: string]: unknown;
}

export interface ProviderResource {
  fields: ProviderField[];
  [key: string]: unknown;
}

export class UnknownProviderFieldError extends Error {
  constructor(readonly fieldName: string) {
    super(`Provider schema has no field named "${fieldName}"`);
    this.name = 'UnknownProviderFieldError';
  }
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

export function applyFieldValues<T extends ProviderResource>(
  schemaItem: T,
  values: Readonly<Record<string, unknown>>,
): T {
  const clone = structuredClone(schemaItem);
  for (const [name, value] of Object.entries(values)) {
    const field = clone.fields.find((candidate) => candidate.name === name);
    if (!field) {
      throw new UnknownProviderFieldError(name);
    }
    field.value = value;
  }
  return clone;
}

export function fieldsMatch(
  existing: ProviderResource,
  desired: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(desired).every(([name, value]) => {
    const field = existing.fields.find((candidate) => candidate.name === name);
    return field !== undefined && valuesEqual(field.value, value);
  });
}
