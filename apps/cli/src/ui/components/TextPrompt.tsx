import { Box, Text, useInput } from 'ink';
import React, { useRef, useState } from 'react';

import { THEME } from '../theme';

const MASK_CHARACTER = '•';

export interface TextPromptProps {
  label: string;
  hint?: string;
  mask?: boolean;
  required?: boolean;
  validate?: (value: string) => string | undefined;
  notice?: string;
  onSubmit: (value: string) => void;
}

export const TextPrompt: React.FC<TextPromptProps> = ({
  label,
  hint,
  mask = false,
  required = true,
  validate,
  notice,
  onSubmit,
}) => {
  const valueRef = useRef('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
    setError(undefined);
  };

  const submit = () => {
    const submitted = valueRef.current.trim();
    if (submitted === '' && required) {
      setError('A value is required');
      return;
    }
    const problem = submitted === '' ? undefined : validate?.(submitted);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(submitted);
  };

  useInput((input, key) => {
    if (key.return) {
      submit();
      return;
    }
    if (key.backspace || key.delete) {
      update(valueRef.current.slice(0, -1));
      return;
    }
    const isControl = key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow;
    if (isControl || !input) {
      return;
    }
    const text = input.replace(/[\r\n]/g, '');
    if (text) {
      update(valueRef.current + text);
    }
    if (text !== input) {
      submit();
    }
  });

  const shown = mask ? MASK_CHARACTER.repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.brand.accent}>? </Text>
        <Text bold color={THEME.brand.metallic}>
          {label}
        </Text>
        {hint && <Text color={THEME.brand.metallicDark}> ({hint})</Text>}
      </Text>
      {notice && <Text color={THEME.semantic.warning}> {notice}</Text>}
      <Text>
        {'  '}
        <Text color={THEME.brand.primaryLight}>{shown}</Text>
        <Text color={THEME.brand.accent}>▌</Text>
      </Text>
      {error && <Text color={THEME.semantic.error}> ✖ {error}</Text>}
    </Box>
  );
};
