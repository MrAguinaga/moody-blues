import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import type { DoctorResult } from '../../doctor';
import { Banner } from '../components/Banner';
import { DoctorItem } from '../components/DoctorItem';
import { THEME } from '../theme';

export interface DoctorSummaryLine {
  text: string;
  tone: 'success' | 'warning' | 'error';
}

export interface DoctorViewProps {
  version?: string;
  results: DoctorResult[];
  busy?: string;
  notes?: string[];
  summary?: DoctorSummaryLine;
}

export const DoctorView: React.FC<DoctorViewProps> = ({
  version,
  results,
  busy,
  notes = [],
  summary,
}) => (
  <Box flexDirection="column" paddingX={1}>
    <Banner version={version} />

    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold underline color={THEME.brand.primaryLight}>
          Doctor
        </Text>
      </Box>

      <Box flexDirection="column">
        {results.map((result) => (
          <DoctorItem key={result.id} result={result} />
        ))}
      </Box>

      {notes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {notes.map((note) => (
            <Text key={note} color={THEME.brand.metallic}>
              {note}
            </Text>
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

      {summary && (
        <Box marginTop={1}>
          <Text bold color={THEME.semantic[summary.tone]}>
            {summary.text}
          </Text>
        </Box>
      )}
    </Box>
  </Box>
);
