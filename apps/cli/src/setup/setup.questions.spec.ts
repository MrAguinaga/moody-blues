import { describe, expect, it } from 'vitest';

import { nextSetupQuestion, type QuestionKey } from './setup.questions';
import type { SetupValues } from './setup.types';

function sequence(known: SetupValues, replies: Partial<Record<QuestionKey, string | null>>) {
  const answers: SetupValues = { ...known };
  const answered = new Set<QuestionKey>();
  const asked: QuestionKey[] = [];

  for (let guard = 0; guard < 20; guard++) {
    const question = nextSetupQuestion(answers, answered);
    if (!question) break;
    asked.push(question.key);
    answered.add(question.key);
    const reply = replies[question.key];
    if (reply) {
      (answers as Record<string, string>)[question.key] = reply;
    }
  }
  return asked;
}

describe('nextSetupQuestion', () => {
  it('asks the full local questionnaire on a clean machine', () => {
    expect(
      sequence(
        {},
        {
          mode: 'local',
          rdApiToken: 't',
          adminUsername: 'a',
          adminPassword: 'p',
          opensubtitlesUsername: null,
          transcoding: 'off',
        },
      ),
    ).toEqual([
      'mode',
      'rdApiToken',
      'adminUsername',
      'adminPassword',
      'opensubtitlesUsername',
      'transcoding',
    ]);
  });

  it('asks the domain and the ACME email only in remote mode', () => {
    expect(
      sequence(
        { rdApiToken: 't', adminUsername: 'a', adminPassword: 'p', transcoding: 'off' },
        { mode: 'remote', domain: 'example.com', acmeEmail: null, opensubtitlesUsername: null },
      ),
    ).toEqual(['mode', 'domain', 'acmeEmail', 'opensubtitlesUsername']);
  });

  it('asks only for what is missing', () => {
    expect(
      sequence(
        {
          mode: 'remote',
          domain: 'example.com',
          acmeEmail: 'ops@example.com',
          transcoding: 'off',
          rdApiToken: 't',
          opensubtitlesUsername: 'u',
          opensubtitlesPassword: 'p',
        },
        { adminUsername: 'a', adminPassword: 'p' },
      ),
    ).toEqual(['adminUsername', 'adminPassword']);
  });

  it('asks for the OpenSubtitles password only after a username was given', () => {
    expect(
      sequence(
        {
          mode: 'local',
          rdApiToken: 't',
          adminUsername: 'a',
          adminPassword: 'p',
          transcoding: 'off',
        },
        { opensubtitlesUsername: 'subs', opensubtitlesPassword: 'secret' },
      ),
    ).toEqual(['opensubtitlesUsername', 'opensubtitlesPassword']);
  });

  it('returns nothing when everything is known', () => {
    expect(
      nextSetupQuestion(
        {
          mode: 'local',
          transcoding: 'off',
          rdApiToken: 't',
          adminUsername: 'a',
          adminPassword: 'p',
          opensubtitlesUsername: 'u',
          opensubtitlesPassword: 'p',
        },
        new Set(),
      ),
    ).toBeUndefined();
  });

  it('validates domains and emails', () => {
    const domain = nextSetupQuestion({ mode: 'remote' }, new Set());
    const email = nextSetupQuestion({ mode: 'remote', domain: 'example.com' }, new Set());

    expect(domain?.validate?.('example.com')).toBeUndefined();
    expect(domain?.validate?.('localhost')).toBeDefined();
    expect(email?.validate?.('ops@example.com')).toBeUndefined();
    expect(email?.validate?.('ops')).toBeDefined();
  });
});
