import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  nextSetupQuestion,
  type QuestionKey,
  type SetupInput,
  type SetupIssue,
  type SetupResolution,
  type SetupValues,
} from '../../setup';
import { Banner } from '../components/Banner';
import { SelectPrompt } from '../components/SelectPrompt';
import { TextPrompt } from '../components/TextPrompt';
import { THEME } from '../theme';

const SECRET_PLACEHOLDER = '••••••••';

interface AnsweredLine {
  label: string;
  display: string;
}

export interface SetupWizardViewProps {
  version?: string;
  draft?: SetupValues;
  autoConfirm: boolean;
  resolve: (answers: SetupValues) => Promise<SetupResolution>;
  onConfirm: (input: SetupInput) => void;
  onCancel: () => void;
  onFailed: (issues: SetupIssue[]) => void;
}

type Stage = 'asking' | 'resolving' | 'confirming';

function summaryLines(input: SetupInput): AnsweredLine[] {
  const { config, secrets } = input;
  const lines: AnsweredLine[] = [
    { label: 'Mode', display: config.mode },
    { label: 'Domain', display: config.domain },
  ];
  if (config.mode === 'remote') {
    lines.push({ label: 'ACME email', display: config.acme.email ?? 'not set' });
  }
  lines.push(
    { label: 'Transcoding', display: config.transcoding },
    {
      label: 'Storage (Real-Debrid mount)',
      display: config.storage.enabled ? 'enabled' : 'disabled (FUSE unavailable on this host)',
    },
    { label: 'Real-Debrid token', display: SECRET_PLACEHOLDER },
    { label: 'Admin username', display: secrets.adminUsername },
    { label: 'Admin password', display: SECRET_PLACEHOLDER },
    {
      label: 'OpenSubtitles',
      display: secrets.opensubtitlesUsername ? secrets.opensubtitlesUsername : 'not set',
    },
  );
  return lines;
}

export const SetupWizardView: React.FC<SetupWizardViewProps> = ({
  version,
  draft,
  autoConfirm,
  resolve,
  onConfirm,
  onCancel,
  onFailed,
}) => {
  const [answers, setAnswers] = useState<SetupValues>({});
  const [answered, setAnswered] = useState<ReadonlySet<QuestionKey>>(new Set());
  const [history, setHistory] = useState<AnsweredLine[]>([]);
  const [stage, setStage] = useState<Stage>('asking');
  const [input, setInput] = useState<SetupInput | undefined>();
  const [pendingPassword, setPendingPassword] = useState<string | undefined>();
  const [passwordNotice, setPasswordNotice] = useState<string | undefined>();
  const resolving = useRef(false);

  const question = useMemo(
    () => (draft ? nextSetupQuestion({ ...draft, ...answers }, answered) : undefined),
    [draft, answers, answered],
  );

  useEffect(() => {
    if (stage !== 'asking' || question || resolving.current) {
      return;
    }
    resolving.current = true;
    setStage('resolving');

    void resolve(answers).then((resolution) => {
      if (!resolution.complete) {
        onFailed(resolution.issues);
        return;
      }
      if (autoConfirm) {
        onConfirm(resolution.input);
        return;
      }
      setInput(resolution.input);
      setStage('confirming');
    });
  }, [stage, question, resolve, answers, autoConfirm, onConfirm, onFailed]);

  const record = (key: QuestionKey, label: string, value: string, display: string) => {
    setAnswered((current) => new Set(current).add(key));
    if (value !== '') {
      setAnswers((current) => ({ ...current, [key]: value }));
    }
    setHistory((current) => [...current, { label, display: value === '' ? 'skipped' : display }]);
  };

  const renderQuestion = () => {
    if (!question) {
      return null;
    }

    if (question.kind === 'select') {
      const options = question.options ?? [];
      return (
        <SelectPrompt
          key={question.key}
          label={question.label}
          options={options}
          onSubmit={(value) =>
            record(
              question.key,
              question.label,
              value,
              options.find((option) => option.value === value)?.label ?? value,
            )
          }
        />
      );
    }

    if (question.kind === 'password') {
      const confirming = pendingPassword !== undefined;
      return (
        <TextPrompt
          key={`${question.key}-${confirming ? 'confirm' : 'first'}`}
          label={confirming ? `Confirm ${question.label.toLowerCase()}` : question.label}
          mask
          notice={passwordNotice}
          onSubmit={(value) => {
            if (!confirming) {
              setPasswordNotice(undefined);
              setPendingPassword(value);
              return;
            }
            if (value !== pendingPassword) {
              setPendingPassword(undefined);
              setPasswordNotice('The passwords did not match, enter the password again');
              return;
            }
            setPendingPassword(undefined);
            setPasswordNotice(undefined);
            record(question.key, question.label, value, SECRET_PLACEHOLDER);
          }}
        />
      );
    }

    return (
      <TextPrompt
        key={question.key}
        label={question.label}
        hint={question.hint}
        mask={question.kind === 'secret'}
        required={!question.optional}
        validate={question.validate}
        onSubmit={(value) =>
          record(
            question.key,
            question.label,
            value,
            question.kind === 'secret' ? SECRET_PLACEHOLDER : value,
          )
        }
      />
    );
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner version={version} />

      <Box flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold underline color={THEME.brand.primaryLight}>
            Moody Blues setup
          </Text>
        </Box>

        {history.map((line, index) => (
          <Text key={index}>
            <Text color={THEME.semantic.success}>✔ </Text>
            <Text color={THEME.brand.metallic}>{line.label}: </Text>
            <Text color={THEME.brand.primaryLight}>{line.display}</Text>
          </Text>
        ))}

        {stage === 'asking' && <Box marginTop={history.length > 0 ? 1 : 0}>{renderQuestion()}</Box>}

        {stage === 'resolving' && (
          <Box marginTop={1}>
            <Text color={THEME.brand.accent}>
              <Spinner type="dots" /> Checking the host...
            </Text>
          </Box>
        )}

        {stage === 'confirming' && input && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={THEME.brand.primaryLight}>
              Summary
            </Text>
            {summaryLines(input).map((line) => (
              <Text key={line.label}>
                <Text color={THEME.brand.metallicDark}> {line.label}: </Text>
                <Text color={THEME.brand.metallic}>{line.display}</Text>
              </Text>
            ))}
            <Box marginTop={1}>
              <SelectPrompt
                label="Provision the stack with these settings?"
                options={[
                  { value: 'confirm', label: 'Continue' },
                  { value: 'cancel', label: 'Cancel' },
                ]}
                onSubmit={(value) => (value === 'confirm' ? onConfirm(input) : onCancel())}
              />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
