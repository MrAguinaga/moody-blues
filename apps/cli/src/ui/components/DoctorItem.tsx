import { Box, Text } from 'ink';
import React from 'react';

import type { DoctorResult, DoctorStatus } from '../../doctor';
import { THEME, UI_LAYOUT } from '../theme';

interface DoctorItemProps {
  result: DoctorResult;
}

const PRESENTATION: Record<DoctorStatus, { icon: string; color: string }> = {
  ok: { icon: '✔', color: THEME.semantic.success },
  warning: { icon: '⚠', color: THEME.semantic.warning },
  error: { icon: '✖', color: THEME.semantic.error },
  skipped: { icon: '○', color: THEME.semantic.muted },
};

export const DoctorItem: React.FC<DoctorItemProps> = ({ result }) => {
  const { icon, color } = PRESENTATION[result.status];
  const showSuggestion =
    result.suggestion && (result.status === 'warning' || result.status === 'error');

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>
          {result.name}
        </Text>
        <Text color={result.status === 'ok' ? THEME.brand.metallic : color}>
          {' '}
          — {result.message}
        </Text>
      </Text>

      <Box flexDirection="column" marginLeft={UI_LAYOUT.indent}>
        {result.details?.map((detail, index) => (
          <Text key={`${index}-${detail}`} color={THEME.brand.metallicDark}>
            ↳ {detail}
          </Text>
        ))}
        {showSuggestion && (
          <Text color={THEME.semantic.warning}>↳ Suggestion: {result.suggestion}</Text>
        )}
      </Box>
    </Box>
  );
};
