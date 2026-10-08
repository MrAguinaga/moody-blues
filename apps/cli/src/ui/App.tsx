import { Box, Text, useApp, useInput } from 'ink';
import React, { useCallback, useState } from 'react';

import type { CheckContext, SystemReport } from '../checks';
import { Banner } from './components/Banner';
import { THEME } from './theme';
import { MainMenuView } from './views/MainMenuView';
import { PreflightView } from './views/PreflightView';

export type CliMode = 'check' | 'welcome';

export interface AppProps {
  mode?: CliMode;
  version?: string;
  context?: CheckContext;
  onCompleted?: (report: SystemReport) => void;
}

export const App: React.FC<AppProps> = ({
  mode = 'welcome',
  version = '0.1.0',
  context,
  onCompleted,
}) => {
  const { exit } = useApp();
  const [report, setReport] = useState<SystemReport | null>(null);

  const handlePreflightComplete = useCallback(
    (completedReport: SystemReport) => {
      setReport(completedReport);
      onCompleted?.(completedReport);

      if (mode === 'check') {
        setTimeout(() => {
          exit();
        }, 100);
      }
    },
    [mode, onCompleted, exit],
  );

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner version={version} />

      <PreflightView context={context} onComplete={handlePreflightComplete} />

      {mode === 'welcome' && report && (
        <>
          {report.allPassed && <MainMenuView />}
          <Box marginTop={1}>
            <Text color={THEME.brand.metallicDark}>Press </Text>
            <Text bold color={THEME.brand.accent}>
              [q]
            </Text>
            <Text color={THEME.brand.metallicDark}> to exit.</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
