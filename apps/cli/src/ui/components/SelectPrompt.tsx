import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import { THEME } from '../theme';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectPromptProps {
  label: string;
  options: readonly SelectOption[];
  initialIndex?: number;
  onSubmit: (value: string) => void;
}

export const SelectPrompt: React.FC<SelectPromptProps> = ({
  label,
  options,
  initialIndex = 0,
  onSubmit,
}) => {
  const [index, setIndex] = useState(initialIndex);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex((current) => (current - 1 + options.length) % options.length);
    } else if (key.downArrow || input === 'j') {
      setIndex((current) => (current + 1) % options.length);
    } else if (key.return) {
      const selected = options[index];
      if (selected) {
        onSubmit(selected.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.brand.accent}>? </Text>
        <Text bold color={THEME.brand.metallic}>
          {label}
        </Text>
        <Text color={THEME.brand.metallicDark}> (use arrow keys, Enter to select)</Text>
      </Text>
      {options.map((option, position) => {
        const active = position === index;
        return (
          <Text key={option.value}>
            <Text color={THEME.brand.accent}>{active ? '  ❯ ' : '    '}</Text>
            <Text bold={active} color={active ? THEME.brand.primaryLight : THEME.brand.metallic}>
              {option.label}
            </Text>
            {option.hint && <Text color={THEME.brand.metallicDark}> — {option.hint}</Text>}
          </Text>
        );
      })}
    </Box>
  );
};
