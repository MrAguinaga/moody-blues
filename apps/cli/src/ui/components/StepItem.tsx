import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { THEME, UI_LAYOUT } from '../theme';

export type StepItemStatus = 'pending' | 'running' | 'changed' | 'unchanged' | 'skipped' | 'failed';

export interface StepItemState {
  id: string;
  title: string;
  status: StepItemStatus;
  detail?: string;
  progress?: string;
}

interface StepItemProps {
  step: StepItemState;
}

export const StepItem: React.FC<StepItemProps> = ({ step }) => {
  const { title, status, detail, progress } = step;
  const suffix = detail ? ` (${detail})` : '';

  return (
    <Box flexDirection="column">
      {status === 'pending' && <Text color={THEME.semantic.muted}>○ {title}</Text>}

      {status === 'running' && (
        <Text>
          <Text color={THEME.brand.accent}>
            <Spinner type="dots" />{' '}
          </Text>
          <Text bold color={THEME.brand.accent}>
            {title}
          </Text>
        </Text>
      )}

      {status === 'changed' && (
        <Text>
          <Text color={THEME.semantic.success}>✔ </Text>
          <Text bold color={THEME.semantic.success}>
            {title}
          </Text>
          <Text color={THEME.brand.metallic}> — changed{suffix}</Text>
        </Text>
      )}

      {status === 'unchanged' && (
        <Text>
          <Text color={THEME.semantic.success}>✔ </Text>
          <Text color={THEME.brand.metallic}>{title}</Text>
          <Text color={THEME.brand.metallicDark}> — unchanged{suffix}</Text>
        </Text>
      )}

      {status === 'skipped' && (
        <Text color={THEME.semantic.muted}>
          – {title} — skipped{suffix}
        </Text>
      )}

      {status === 'failed' && (
        <Text>
          <Text color={THEME.semantic.error}>✖ </Text>
          <Text bold color={THEME.semantic.error}>
            {title}
          </Text>
        </Text>
      )}

      {status === 'running' && progress && (
        <Box marginLeft={UI_LAYOUT.indent}>
          <Text color={THEME.brand.metallicDark}>↳ {progress}</Text>
        </Box>
      )}

      {status === 'failed' && detail && (
        <Box marginLeft={UI_LAYOUT.indent}>
          <Text color={THEME.semantic.error}>↳ {detail}</Text>
        </Box>
      )}
    </Box>
  );
};
