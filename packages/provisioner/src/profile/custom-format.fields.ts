import type { CustomFormatResource, SpecificationSchemaResource } from '../arr/arr.types';
import { fieldsMatch, type ProviderField } from '../http/provider-fields';
import {
  type CustomFormatDefinition,
  CustomFormatSchemaError,
  type FieldDefinition,
  type FieldValue,
  type NamedOption,
  type SpecificationDefinition,
} from './profile.types';

export function toApiFields(fields: Readonly<Record<string, FieldValue>>): ProviderField[] {
  return Object.entries(fields).map(([name, value]) => ({ name, value }));
}

function isNamedOption(value: FieldDefinition): value is NamedOption {
  return typeof value === 'object' && value !== null;
}

export function resolveSpecificationFields(
  specification: SpecificationDefinition,
  schema: readonly SpecificationSchemaResource[],
): Record<string, FieldValue> {
  const template = schema.find((entry) => entry.implementation === specification.implementation);
  if (!template) {
    throw new CustomFormatSchemaError(
      `The server offers no ${specification.implementation} implementation`,
    );
  }

  return Object.fromEntries(
    Object.entries(specification.fields).map(([name, definition]) => {
      if (!isNamedOption(definition)) {
        return [name, definition];
      }
      const option = template.fields
        .find((field) => field.name === name)
        ?.selectOptions?.find((candidate) => candidate.name === definition.option);
      if (!option) {
        throw new CustomFormatSchemaError(
          `${specification.implementation} has no option "${definition.option}" for field "${name}"`,
        );
      }
      return [name, option.value];
    }),
  );
}

export function toCustomFormatResource(
  definition: CustomFormatDefinition,
  schema: readonly SpecificationSchemaResource[],
): CustomFormatResource {
  return {
    name: definition.name,
    includeCustomFormatWhenRenaming: definition.includeCustomFormatWhenRenaming,
    specifications: definition.specifications.map((specification) => ({
      name: specification.name,
      implementation: specification.implementation,
      negate: specification.negate,
      required: specification.required,
      fields: toApiFields(resolveSpecificationFields(specification, schema)),
    })),
  };
}

export function customFormatMatches(
  existing: CustomFormatResource,
  desired: CustomFormatResource,
): boolean {
  return (
    existing.name === desired.name &&
    existing.includeCustomFormatWhenRenaming === desired.includeCustomFormatWhenRenaming &&
    existing.specifications.length === desired.specifications.length &&
    desired.specifications.every((wanted, index) => {
      const current = existing.specifications[index];
      return (
        current !== undefined &&
        current.name === wanted.name &&
        current.implementation === wanted.implementation &&
        current.negate === wanted.negate &&
        current.required === wanted.required &&
        fieldsMatch(current, Object.fromEntries(wanted.fields.map((f) => [f.name, f.value])))
      );
    })
  );
}
