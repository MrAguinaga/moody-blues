import { Text } from 'ink';
import React from 'react';

import type { CheckStatus } from '../../checks';
import { THEME } from '../theme';

interface StatusBadgeProps {
  status: CheckStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'success':
      return <Text color={THEME.semantic.success}>[✔ OK]</Text>;
    case 'warning':
      return <Text color={THEME.semantic.warning}>[⚠ WARNING]</Text>;
    case 'error':
      return <Text color={THEME.semantic.error}>[✖ ERROR]</Text>;
    case 'running':
      return <Text color={THEME.brand.accent}>[⠋ RUNNING]</Text>;
    case 'pending':
    default:
      return <Text color={THEME.semantic.muted}>[○ PENDING]</Text>;
  }
};
