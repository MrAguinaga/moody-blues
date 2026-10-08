import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import type { CheckResult } from '../../checks';
import { THEME, UI_LAYOUT } from '../theme';

interface CheckItemProps {
  check: CheckResult;
}

export const CheckItem: React.FC<CheckItemProps> = ({ check }) => {
  return (
    <Box flexDirection="column" marginY={0}>
      <Box gap={UI_LAYOUT.badgeGap}>
        {check.status === 'pending' && (
          <Text color={THEME.semantic.muted}>
            ○ {check.name} ({check.description})
          </Text>
        )}

        {check.status === 'running' && (
          <Text>
            <Text color={THEME.brand.accent}>
              <Spinner type="dots" />{' '}
            </Text>
            <Text bold color={THEME.brand.accent}>
              {check.name}
            </Text>
            <Text color={THEME.brand.metallicDark}> — checking...</Text>
          </Text>
        )}

        {check.status === 'success' && (
          <Text>
            <Text color={THEME.semantic.success}>✔ </Text>
            <Text bold color={THEME.semantic.success}>
              {check.name}
            </Text>
            <Text color={THEME.brand.metallic}> — {check.message}</Text>
          </Text>
        )}

        {check.status === 'warning' && (
          <Text>
            <Text color={THEME.semantic.warning}>⚠ </Text>
            <Text bold color={THEME.semantic.warning}>
              {check.name}
            </Text>
            <Text color={THEME.semantic.warning}> — {check.message}</Text>
          </Text>
        )}

        {check.status === 'error' && (
          <Text>
            <Text color={THEME.semantic.error}>✖ </Text>
            <Text bold color={THEME.semantic.error}>
              {check.name}
            </Text>
            <Text color={THEME.semantic.error}> — {check.message}</Text>
          </Text>
        )}
      </Box>

      {check.status === 'warning' && check.suggestion && (
        <Box marginLeft={UI_LAYOUT.indent} marginTop={0}>
          <Text color={THEME.semantic.warning}>↳ Suggestion: {check.suggestion}</Text>
        </Box>
      )}

      {check.status === 'error' && (
        <Box flexDirection="column" marginLeft={UI_LAYOUT.indent}>
          {check.error && <Text color={THEME.brand.metallicDark}>↳ Detail: {check.error}</Text>}
          {check.suggestion && (
            <Text color={THEME.semantic.warning}>↳ Suggestion: {check.suggestion}</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
