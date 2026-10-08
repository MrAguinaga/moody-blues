import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';

import { DEFAULT_CHECKS, runPreflightChecks, type SystemReport } from '../../checks';
import { CheckItem } from '../components/CheckItem';
import { THEME } from '../theme';

interface PreflightViewProps {
  onComplete?: (report: SystemReport) => void;
}

export const PreflightView: React.FC<PreflightViewProps> = ({ onComplete }) => {
  const [report, setReport] = useState<SystemReport>(() => ({
    timestamp: new Date().toISOString(),
    allPassed: false,
    hasWarnings: false,
    hasErrors: false,
    checks: DEFAULT_CHECKS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      status: 'pending',
    })),
  }));

  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function execute() {
      const finalReport = await runPreflightChecks((updatedReport) => {
        if (isMounted) {
          setReport({ ...updatedReport });
        }
      });

      if (isMounted) {
        setIsCompleted(true);
        onComplete?.(finalReport);
      }
    }

    void execute();

    return () => {
      isMounted = false;
    };
  }, [onComplete]);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold underline color={THEME.brand.primaryLight}>
          Host System Pre-flight Checks:
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        {report.checks.map((check) => (
          <CheckItem key={check.id} check={check} />
        ))}
      </Box>

      {isCompleted && (
        <Box marginTop={1} flexDirection="column">
          {report.allPassed && !report.hasWarnings && (
            <Text bold color={THEME.semantic.success}>
              ✔ Host environment meets all requirements.
            </Text>
          )}

          {report.allPassed && report.hasWarnings && (
            <Text bold color={THEME.semantic.warning}>
              ⚠ Checks completed with warnings. Review the notices above.
            </Text>
          )}

          {report.hasErrors && (
            <Text bold color={THEME.semantic.error}>
              ✖ Critical issues detected. Resolve the reported errors before proceeding.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
