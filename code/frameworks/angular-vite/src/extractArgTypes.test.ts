import { describe, expect, it } from 'vitest';

import type { CompodocComponentSummary } from './componentManifest/buildAngularComponentDocgen.ts';
import type { CompodocJson } from './componentManifest/compodocTypes.ts';
import { extractArgTypes } from './extractArgTypes.ts';

function makeCompodoc(overrides: Partial<CompodocComponentSummary> = {}): CompodocComponentSummary {
  return {
    name: 'ButtonComponent',
    type: 'component',
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

describe('extractArgTypes', () => {
  it('converts a string input with a quoted default value', () => {
    const argTypes = extractArgTypes(
      makeCompodoc({
        inputs: [
          {
            name: 'label',
            type: 'string',
            optional: true,
            defaultValue: "'Click me'",
            description: 'Text displayed inside the button.',
          },
        ],
      }),
      null
    );

    expect(argTypes.label).toMatchObject({
      name: 'label',
      description: 'Text displayed inside the button.',
      type: { name: 'string', required: false },
      table: {
        category: 'inputs',
        type: { summary: 'string' },
        defaultValue: { summary: 'Click me' },
      },
    });
  });

  it('casts a boolean default value', () => {
    const argTypes = extractArgTypes(
      makeCompodoc({
        inputs: [
          {
            name: 'disabled',
            type: 'boolean',
            optional: true,
            defaultValue: 'false',
            description: '',
          },
        ],
      }),
      null
    );

    expect(argTypes.disabled.table?.defaultValue).toEqual({ summary: 'false' });
    expect(argTypes.disabled.type).toMatchObject({ name: 'boolean' });
  });

  it('marks a required input (no `optional`) as required', () => {
    const argTypes = extractArgTypes(
      makeCompodoc({
        inputs: [{ name: 'id', type: 'string', optional: false, description: '' }],
      }),
      null
    );

    expect(argTypes.id.type).toMatchObject({ required: true });
  });

  it('resolves an enum-like union type via compodocJson.miscellaneous', () => {
    const compodocJson: CompodocJson = {
      components: [],
      directives: [],
      pipes: [],
      injectables: [],
      classes: [],
      miscellaneous: {
        enumerations: [
          {
            name: 'ButtonVariant',
            ctype: 'enum',
            subtype: '',
            file: '',
            childs: [
              { name: 'Primary', value: 'primary' },
              { name: 'Secondary', value: 'secondary' },
            ],
          },
        ],
      },
    };

    const argTypes = extractArgTypes(
      makeCompodoc({
        inputs: [{ name: 'variant', type: 'ButtonVariant', optional: true, description: '' }],
      }),
      compodocJson
    );

    expect(argTypes.variant.type).toMatchObject({ name: 'enum', value: ['primary', 'secondary'] });
  });

  it('builds an actionable argType for a plain output', () => {
    const argTypes = extractArgTypes(
      makeCompodoc({
        outputs: [
          {
            name: 'clicked',
            type: 'EventEmitter<void>',
            description: 'Emitted when the user clicks the button.',
          },
        ],
      }),
      null
    );

    expect(argTypes.clicked).toMatchObject({
      name: 'clicked',
      description: 'Emitted when the user clicks the button.',
      type: { name: 'other', value: 'void' },
      action: 'clicked',
      table: { category: 'outputs', type: { summary: 'EventEmitter<void>' } },
    });
  });

  it('synthesizes a `${name}Change` output for a model() signal and suppresses the raw duplicate', () => {
    const argTypes = extractArgTypes(
      makeCompodoc({
        inputs: [{ name: 'value', type: 'string', optional: true, description: 'The value.' }],
        outputs: [{ name: 'value', type: 'string', description: 'The value.' }],
      }),
      null
    );

    expect(argTypes.value).toBeDefined();
    expect(argTypes.valueChange).toMatchObject({
      name: 'valueChange',
      action: 'valueChange',
      table: { category: 'outputs', type: { summary: '(e: string) => void' } },
    });
    // The raw bare-name `value` output entry is suppressed — only the model input and the
    // synthesized `valueChange` output remain.
    expect(Object.keys(argTypes)).toEqual(['value', 'valueChange']);
  });
});
