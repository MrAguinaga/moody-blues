import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { isServiceHealthy, type StackStatus } from '../../docker';
import { Banner } from '../components/Banner';
import { SERVICE_COLUMNS, ServiceRow } from '../components/ServiceRow';
import { THEME } from '../theme';

export interface StackStatusViewProps {
  version?: string;
  heading: string;
  status?: StackStatus;
  busy?: string;
  failure?: string;
  onQuit?: () => void;
}

export const StackStatusView: React.FC<StackStatusViewProps> = ({
  version,
  heading,
  status,
  busy,
  failure,
  onQuit,
}) => {
  useInput(
    (input) => {
      if (input === 'q') {
        onQuit?.();
      }
    },
    { isActive: onQuit !== undefined },
  );

  const services = status?.services ?? [];
  const nameWidth = Math.max(0, ...services.map((service) => service.service.length));
  const healthyCount = services.filter(isServiceHealthy).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner version={version} />

      <Box flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold underline color={THEME.brand.primaryLight}>
            {heading}
          </Text>
        </Box>

        {services.length > 0 && (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text> </Text>
              <Text color={THEME.brand.metallicDark}>{'SERVICE'.padEnd(nameWidth)}</Text>
              <Text color={THEME.brand.metallicDark}>{'STATE'.padEnd(SERVICE_COLUMNS.state)}</Text>
              <Text color={THEME.brand.metallicDark}>
                {'HEALTH'.padEnd(SERVICE_COLUMNS.health)}
              </Text>
              <Text color={THEME.brand.metallicDark}>PORTS</Text>
            </Box>
            {services.map((service) => (
              <ServiceRow key={service.service} service={service} nameWidth={nameWidth} />
            ))}
          </Box>
        )}

        {busy && (
          <Box marginTop={services.length > 0 ? 1 : 0}>
            <Text color={THEME.brand.accent}>
              <Spinner type="dots" /> {busy}
            </Text>
          </Box>
        )}

        {!busy && !failure && status && (
          <Box marginTop={1}>
            {status.allHealthy ? (
              <Text bold color={THEME.semantic.success}>
                ✔ All {services.length} services are healthy.
              </Text>
            ) : (
              <Text bold color={THEME.semantic.warning}>
                ⚠ {healthyCount} of {services.length} services are healthy.
              </Text>
            )}
          </Box>
        )}

        {failure && (
          <Box marginTop={1}>
            <Text bold color={THEME.semantic.error}>
              ✖ {failure}
            </Text>
          </Box>
        )}

        {onQuit && (
          <Box marginTop={1}>
            <Text color={THEME.brand.metallicDark}>Press </Text>
            <Text bold color={THEME.brand.accent}>
              [q]
            </Text>
            <Text color={THEME.brand.metallicDark}> to exit.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
