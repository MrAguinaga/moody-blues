import { Box, Text } from 'ink';
import React from 'react';

import { Banner } from '../components/Banner';
import { SelectPrompt } from '../components/SelectPrompt';
import { THEME } from '../theme';

export interface ConfirmViewProps {
  version?: string;
  heading: string;
  details: string[];
  preserved?: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const OPTIONS = [
  { value: 'cancel', label: 'Cancel' },
  { value: 'confirm', label: 'Continue' },
] as const;

export const ConfirmView: React.FC<ConfirmViewProps> = ({
  version,
  heading,
  details,
  preserved = [],
  confirmLabel,
  onConfirm,
  onCancel,
}) => (
  <Box flexDirection="column" paddingX={1}>
    <Banner version={version} />

    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold underline color={THEME.brand.primaryLight}>
          {heading}
        </Text>
      </Box>

      {details.map((detail) => (
        <Text key={detail} color={THEME.semantic.warning}>
          ✖ {detail}
        </Text>
      ))}
      {preserved.map((item) => (
        <Text key={item} color={THEME.semantic.success}>
          ✔ {item}
        </Text>
      ))}

      <Box marginTop={1}>
        <SelectPrompt
          label={confirmLabel}
          options={OPTIONS}
          onSubmit={(value) => (value === 'confirm' ? onConfirm() : onCancel())}
        />
      </Box>
    </Box>
  </Box>
);
