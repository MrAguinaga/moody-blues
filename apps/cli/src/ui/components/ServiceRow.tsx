import { Box, Text } from 'ink';
import React from 'react';

import { isServiceHealthy, type ServiceStatus } from '../../docker';
import { THEME } from '../theme';

export const SERVICE_COLUMNS = {
  state: 12,
  health: 11,
} as const;

interface ServiceRowProps {
  service: ServiceStatus;
  nameWidth: number;
}

function indicatorFor(service: ServiceStatus): { symbol: string; color: string } {
  if (isServiceHealthy(service)) {
    return { symbol: '●', color: THEME.semantic.success };
  }
  if (service.state === 'exited' || service.health === 'unhealthy') {
    return { symbol: '✖', color: THEME.semantic.error };
  }
  if (service.state === 'missing' || service.state === 'paused') {
    return { symbol: '○', color: THEME.semantic.muted };
  }
  return { symbol: '◐', color: THEME.semantic.warning };
}

export const ServiceRow: React.FC<ServiceRowProps> = ({ service, nameWidth }) => {
  const { symbol, color } = indicatorFor(service);

  return (
    <Box gap={1}>
      <Text color={color}>{symbol}</Text>
      <Text bold color={THEME.brand.metallic}>
        {service.service.padEnd(nameWidth)}
      </Text>
      <Text color={color}>{service.state.padEnd(SERVICE_COLUMNS.state)}</Text>
      <Text color={THEME.brand.metallicDark}>{service.health.padEnd(SERVICE_COLUMNS.health)}</Text>
      <Text color={THEME.brand.accent}>{service.publishedPorts.join(', ')}</Text>
    </Box>
  );
};
