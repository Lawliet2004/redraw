import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMath } from '../src/calculator.ts';

test('answers typed arithmetic locally with optional equals', () => {
  assert.equal(evaluateMath('2 + 3'), '5');
  assert.equal(evaluateMath('2 + 3 ='), '5');
  assert.equal(evaluateMath('0.1 + 0.2'), '0.3');
});

test('respects precedence, right associative powers and unary signs', () => {
  for (const [input, answer] of [['2 + 3 * 4', '14'], ['(2 + 3) * 4', '20'], ['2^3^2', '512'], ['-2^2', '-4'], ['2^-2', '0.25'], ['3 * -2', '-6'], ['50% * 200', '100']]) {
    assert.equal(evaluateMath(input), answer, input);
  }
});

test('supports explicit mathematical functions and constants in radians', () => {
  for (const [input, answer] of [['sqrt(9)', '3'], ['sin(pi/2)', '1'], ['cos(0)', '1'], ['tan(0)', '0'], ['abs(-3)', '3'], ['log(100)', '2'], ['ln(e)', '1'], ['1e-3 * 2', '0.002']]) {
    assert.equal(evaluateMath(input), answer, input);
  }
});

test('ignores notes and rejects unsafe or incomplete expressions', () => {
  for (const input of ['5', '-5', '(5)', 'What is 2 + 3?', 'hello', '2 +', '2 3', '2 = 3', '2 ==', 'Math.sqrt(9)', 'constructor(1)', 'process.exit()', '1;globalThis.x=2', '2\\u002b3', '2/*x*/+3', 'sqrt()', '2(3)', '']) {
    assert.equal(evaluateMath(input), null, input);
  }
});

test('rejects invalid domains and nonfinite intermediate values', () => {
  for (const input of ['1/0', '0/0', 'sqrt(-1)', 'ln(0)', 'log(-1)', '10^999', '(10^999)^0']) {
    assert.equal(evaluateMath(input), null, input);
  }
});

test('bounds input length, operation count and nesting', () => {
  assert.equal(evaluateMath('1+'.repeat(3000) + '1'), null);
  assert.equal(evaluateMath('1+'.repeat(300) + '1'), null);
  assert.equal(evaluateMath('('.repeat(80) + '1+2' + ')'.repeat(80)), null);
  assert.equal(evaluateMath('-'.repeat(100) + '2+3'), null);
});
