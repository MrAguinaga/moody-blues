import { Box, Text } from 'ink';
import React from 'react';

import { APP_META, LOGO_LINES, THEME } from '../theme';

interface BannerProps {
  version?: string;
}

export const Banner: React.FC<BannerProps> = ({ version = '0.1.0' }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <Text key={index} color={THEME.brand.logoGradient[index]}>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginTop={1} gap={1}>
        <Text bold color={THEME.brand.primary}>
          {APP_META.name}
        </Text>
        <Text color={THEME.brand.metallicDark}>—</Text>
        <Text color={THEME.brand.metallic}>{APP_META.tagline}</Text>
        <Text color={THEME.brand.accent}>v{version}</Text>
      </Box>
    </Box>
  );
};
