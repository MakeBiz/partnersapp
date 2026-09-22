import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStatus, backoffSeconds, JOB_KINDS } from './jobs.js';

test('паузы между повторами растут', () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffSeconds), [30, 120, 480, 1920]);
});

test('статус заведения берётся по последней задаче каждого вида', () => {
  const s = onboardingStatus([
    { id: 1, kind: JOB_KINDS.BITRIX_PARTNER, status: 'failed', last_error: 'нет сети', attempts: 5 },
    { id: 4, kind: JOB_KINDS.BITRIX_PARTNER, status: 'done', attempts: 1, result: { contactId: 7 } },
    { id: 2, kind: JOB_KINDS.TG_GROUP, status: 'pending', attempts: 0 },
    { id: 3, kind: JOB_KINDS.EMAIL_INVITE, status: 'failed', last_error: 'SMTP', attempts: 1 },
  ], { inviteUsed: true, hasEmail: true });
  assert.equal(s.crm.state, 'done');
  assert.equal(s.crm.result.contactId, 7);
  assert.equal(s.chat.state, 'pending');
  assert.equal(s.email.state, 'failed');
  assert.equal(s.email.error, 'SMTP');
  assert.equal(s.cabinet.state, 'done');
});

test('без почты письмо пропущено, без задач шаг не запускался', () => {
  const s = onboardingStatus([], { hasEmail: false });
  assert.equal(s.email.state, 'skipped');
  assert.equal(s.crm.state, 'none');
  assert.equal(s.cabinet.state, 'pending');
});
