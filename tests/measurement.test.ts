import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBloodPressure } from '../src/lib/measurement';

test('parses an entire integer reading with optional whitespace and mmHg', () => {
  for (const input of ['165/100', '  165 / 100  ', '\t165/100 mmHg\n', '165/100mmHg']) {
    assert.deepEqual(parseBloodPressure(input), { systolic: 165, diastolic: 100 });
  }
});

test('normalizes Arabic-Indic and Eastern Arabic-Indic digits, including mixed input', () => {
  for (const input of ['١٦٥/١٠٠', '۱۶۵/۱۰۰ mmHg', '1٦۵ / ١0۰']) {
    assert.deepEqual(parseBloodPressure(input), { systolic: 165, diastolic: 100 });
  }
});

test('accepts the format sanity bounds without clinical interpretation', () => {
  assert.deepEqual(parseBloodPressure('40/20'), { systolic: 40, diastolic: 20 });
  assert.deepEqual(parseBloodPressure('300/200'), { systolic: 300, diastolic: 200 });
});

test('rejects ambiguous text, additional numbers, decimals and alternate units', () => {
  for (const input of [
    '', ' ', '165', '/100', '165/', '165 100', '165:100',
    'BP 165/100', '165/100 today', '165/100 120/80', '165/100\n120/80',
    '165/100/80', '165/100 1', '165.0/100', '165/100.0',
    '١٦٥٫٠/١٠٠', '+165/100', '-165/100', '1e2/80',
    '165/100 kPa', '165/100 mm Hg', '165/100 mmHg mmHg',
  ]) {
    assert.throws(() => parseBloodPressure(input), /format/i, input);
  }
});

test('rejects unordered values and out-of-bounds data without rescaling', () => {
  for (const input of ['100/165', '100/100', '39/20', '301/100', '165/19', '250/201', '0/0', '16/10', '999999999999999999999/100']) {
    assert.throws(() => parseBloodPressure(input), /format/i, input);
  }
});
