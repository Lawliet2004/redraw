const functions: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  abs: Math.abs, log: Math.log10, ln: Math.log,
};

/** Evaluate a bounded arithmetic expression, never executable JavaScript.
 * Percent is postfix division by 100; trigonometric functions use radians.
 * Ordinary numbers are ignored so writing a note does not create an answer.
 */
export function evaluateMath(input: string): string | null {
  if (input.length > 2048) return null;
  const source = input.trim().replace(/=$/, '').trim();
  let position = 0;
  let operations = 0;
  let depth = 0;
  const invalid = () => { throw new Error('Invalid arithmetic expression'); };
  const space = () => { while (/\s/.test(source[position] ?? '') && position < source.length) position++; };
  const take = (token: string) => {
    space();
    if (source[position] !== token) return false;
    position++;
    return true;
  };
  const finite = (value: number) => Number.isFinite(value) ? value : invalid();
  const operation = (value: number) => {
    if (++operations > 128) invalid();
    return finite(value);
  };
  const nested = (parse: () => number): number => {
    if (++depth > 32) invalid();
    const value = parse();
    depth--;
    return value;
  };
  const primary = (): number => {
    space();
    if (take('(')) {
      const value = nested(expression);
      if (!take(')')) invalid();
      return value;
    }
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(position));
    if (numeric) {
      position += numeric[0].length;
      return finite(Number(numeric[0]));
    }
    const identifier = /^[a-z]+/i.exec(source.slice(position));
    if (!identifier) return invalid();
    position += identifier[0].length;
    const name = identifier[0].toLowerCase();
    if (name === 'pi') return Math.PI;
    if (name === 'e') return Math.E;
    if (!Object.prototype.hasOwnProperty.call(functions, name) || !take('(')) return invalid();
    const value = nested(expression);
    if (!take(')')) invalid();
    return operation(functions[name](value));
  };
  const power = (): number => {
    let value = primary();
    while (take('%')) value = operation(value / 100);
    if (take('^')) value = operation(value ** nested(unary));
    return value;
  };
  const unary = (): number => {
    if (take('+')) return nested(unary);
    if (take('-')) return -nested(unary);
    return power();
  };
  const product = (): number => {
    let value = unary();
    while (true) {
      if (take('*')) value = operation(value * unary());
      else if (take('/')) value = operation(value / unary());
      else return value;
    }
  };
  const expression = (): number => {
    let value = product();
    while (true) {
      if (take('+')) value = operation(value + product());
      else if (take('-')) value = operation(value - product());
      else return value;
    }
  };
  try {
    const value = expression();
    space();
    if (position !== source.length || operations === 0) return null;
    return String(Number(value.toPrecision(12)));
  } catch {
    return null;
  }
}
