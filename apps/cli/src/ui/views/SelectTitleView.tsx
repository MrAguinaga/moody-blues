import { Box, Text } from 'ink';
import React from 'react';

import { Banner } from '../components/Banner';
import { type SelectOption, SelectPrompt } from '../components/SelectPrompt';
import { THEME } from '../theme';

export interface SelectTitleViewProps {
  version?: string;
  heading: string;
  options: readonly SelectOption[];
  onSelect: (value: string) => void;
}

export const SelectTitleView: React.FC<SelectTitleViewProps> = ({
  version,
  heading,
  options,
  onSelect,
}) => (
  <Box flexDirection="column" paddingX={1}>
    <Banner version={version} />

    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold underline color={THEME.brand.primaryLight}>
          {heading}
        </Text>
      </Box>
      <SelectPrompt
        label="Which title do you want to remove?"
        options={options}
        onSubmit={onSelect}
      />
    </Box>
  </Box>
);
