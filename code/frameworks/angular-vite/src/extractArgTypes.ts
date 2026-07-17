import type { SBType, StrictArgTypes } from 'storybook/internal/types';

import type {
  CompodocComponentSummary,
  CompodocInputSummary,
} from './componentManifest/buildAngularComponentDocgen.ts';
import type { CompodocJson } from './componentManifest/compodocTypes.ts';

function extractTypeFromValue(defaultValue: unknown): string | null {
  const valueType = typeof defaultValue;
  return defaultValue || valueType === 'number' || valueType === 'boolean' || valueType === 'string'
    ? valueType
    : null;
}

function resolveTypealias(compodocType: string, compodocJson: CompodocJson | null): string {
  const typeAlias = compodocJson?.miscellaneous?.typealiases?.find(
    (alias) => alias.name === compodocType
  );
  return typeAlias ? resolveTypealias(typeAlias.rawtype, compodocJson) : compodocType;
}

function extractEnumValues(
  compodocType: string,
  compodocJson: CompodocJson | null
): string[] | null {
  const enumType = compodocJson?.miscellaneous?.enumerations?.find(
    (candidate) => candidate.name === compodocType
  );
  if (enumType?.childs.every((child) => child.value)) {
    return enumType.childs.map((child) => child.value as string);
  }

  if (compodocType.indexOf('|') === -1) {
    return null;
  }

  try {
    return compodocType.split('|').map((value) => JSON.parse(value));
  } catch {
    return null;
  }
}

function extractType(
  input: CompodocInputSummary,
  defaultValue: unknown,
  compodocJson: CompodocJson | null
): SBType {
  const compodocType = input.type || extractTypeFromValue(defaultValue);
  switch (compodocType) {
    case 'string':
    case 'boolean':
    case 'number':
      return { name: compodocType };
    case null:
      return { name: 'other', value: 'void' };
    default: {
      const resolvedType = resolveTypealias(compodocType, compodocJson);
      const enumValues = extractEnumValues(resolvedType, compodocJson);
      return enumValues
        ? { name: 'enum', value: enumValues }
        : { name: 'other', value: 'empty-enum' };
    }
  }
}

function castDefaultValue(type: string, defaultValue: string | undefined): unknown {
  if (['boolean', 'number', 'string', 'EventEmitter'].includes(type)) {
    switch (type) {
      case 'boolean':
        return defaultValue === 'true';
      case 'number':
        return Number(defaultValue);
      case 'EventEmitter':
        return undefined;
      default:
        return defaultValue;
    }
  }

  switch (defaultValue) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    default:
      return defaultValue;
  }
}

function extractDefaultValue(input: CompodocInputSummary): unknown {
  const unquoted = input.defaultValue?.replace(/^'(.*)'$/, '$1');
  return castDefaultValue(input.type, unquoted);
}

/** `table.defaultValue.summary` is a display string; `null`/`undefined` mean "no default". */
function formatDefaultValueSummary(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * Converts the lean Compodoc summary (the `compodoc` field on the docgen payload) into
 * `StrictArgTypes`. Used by the Angular `experimental_docgenProvider` — mirrors what
 * `extractArgTypesFromData` (`client/compodoc.ts`) does for the live-preview Controls panel, but
 * operates purely on data already resolved server-side: `compodocJson` is passed explicitly for
 * enum/typealias lookups instead of read from a browser global, and there is no JSDoc-comment
 * `@default` fallback or FEATURES-driven filtering — the summary only ever carries inputs/outputs,
 * never properties/methods/view children, so it is inherently the "filtered" shape already.
 */
export function extractArgTypes(
  compodoc: CompodocComponentSummary,
  compodocJson: CompodocJson | null
): StrictArgTypes {
  const argTypes: StrictArgTypes = {};

  const inputNames = new Set(compodoc.inputs.map((input) => input.name));
  const modelOutputs = compodoc.outputs.filter((output) => inputNames.has(output.name));
  const modelNames = new Set(modelOutputs.map((output) => output.name));

  compodoc.inputs.forEach((input) => {
    const defaultValue = extractDefaultValue(input);
    argTypes[input.name] = {
      name: input.name,
      description: input.description,
      // `required` lives on `SBBaseType` (the top-level `type`), not `table.type`.
      type: { required: !input.optional, ...extractType(input, defaultValue, compodocJson) },
      table: {
        category: 'inputs',
        type: { summary: input.type },
        defaultValue: { summary: formatDefaultValueSummary(defaultValue) },
      },
    };
  });

  compodoc.outputs.forEach((output) => {
    // A model() signal lands under the same bare name in both `inputs` and `outputs` (Compodoc
    // emits no dedicated marker for it); its output side is synthesized as `${name}Change` below.
    if (modelNames.has(output.name)) {
      return;
    }
    argTypes[output.name] = {
      name: output.name,
      description: output.description,
      type: { name: 'other', value: 'void' },
      action: output.name,
      table: {
        category: 'outputs',
        type: { summary: output.type },
      },
    };
  });

  modelOutputs.forEach((output) => {
    const changeName = `${output.name}Change`;
    argTypes[changeName] = {
      name: changeName,
      description: output.description,
      type: { name: 'other', value: 'void' },
      action: changeName,
      table: {
        category: 'outputs',
        type: { summary: `(e: ${output.type}) => void` },
      },
    };
  });

  return argTypes;
}
