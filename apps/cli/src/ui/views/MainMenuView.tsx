import { Box, Text } from 'ink';
import React from 'react';

import { THEME } from '../theme';

export const MainMenuView: React.FC = () => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold underline color={THEME.brand.primaryLight}>
          Available Commands:
        </Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Box gap={2}>
          <Text bold color={THEME.brand.accent}>
            moody-blues check
          </Text>
          <Text color={THEME.brand.metallic}>— Run host system pre-flight checks</Text>
        </Box>
        <Box gap={2}>
          <Text bold color={THEME.brand.accent}>
            moody-blues setup
          </Text>
          <Text color={THEME.brand.metallic}>— Interactive setup and provisioning wizard</Text>
        </Box>
        <Box gap={2}>
          <Text bold color={THEME.brand.accent}>
            moody-blues start
          </Text>
          <Text color={THEME.brand.metallic}>— Start container stack and verify healthchecks</Text>
        </Box>
        <Box gap={2}>
          <Text bold color={THEME.brand.accent}>
            moody-blues status
          </Text>
          <Text color={THEME.brand.metallic}>— Interactive services status dashboard</Text>
        </Box>
        <Box gap={2}>
          <Text bold color={THEME.brand.accent}>
            moody-blues stop
          </Text>
          <Text color={THEME.brand.metallic}>— Gracefully stop all services</Text>
        </Box>
      </Box>
    </Box>
  );
};
