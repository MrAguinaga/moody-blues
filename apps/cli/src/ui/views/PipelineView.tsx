import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import type { CheckResult } from '../../checks';
import { Banner } from '../components/Banner';
import { CheckItem } from '../components/CheckItem';
import { StepItem, type StepItemState } from '../components/StepItem';
import { THEME } from '../theme';

export interface PipelineViewProps {
  version?: string;
  heading: string;
  checks?: CheckResult[];
  steps: StepItemState[];
  busy?: string;
  warnings?: string[];
  failure?: string;
  success?: string;
}

export const PipelineView: React.FC<PipelineViewProps> = ({
  version,
  heading,
  checks = [],
  steps,
  busy,
  warnings = [],
  failure,
  success,
}) => {
  const visibleChecks = checks.filter((check) => check.status !== 'pending');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner version={version} />

      <Box flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold underline color={THEME.brand.primaryLight}>
            {heading}
          </Text>
        </Box>

        {visibleChecks.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            {visibleChecks.map((check) => (
              <CheckItem key={check.id} check={check} />
            ))}
          </Box>
        )}

        {steps.length > 0 && (
          <Box flexDirection="column">
            {steps.map((step) => (
              <StepItem key={step.id} step={step} />
            ))}
          </Box>
        )}

        {busy && (
          <Box marginTop={1}>
            <Text color={THEME.brand.accent}>
              <Spinner type="dots" /> {busy}
            </Text>
          </Box>
        )}

        {warnings.map((warning) => (
          <Box key={warning} marginTop={1}>
            <Text color={THEME.semantic.warning}>⚠ {warning}</Text>
          </Box>
        ))}

        {success && (
          <Box marginTop={1}>
            <Text bold color={THEME.semantic.success}>
              ✔ {success}
            </Text>
          </Box>
        )}

        {failure && (
          <Box marginTop={1}>
            <Text bold color={THEME.semantic.error}>
              ✖ {failure}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
