import { chooseModel } from '../src/backend/modelRouter';

describe('modelRouter.chooseModel (gpt-5.4 family)', () => {
  const mk = (userText: unknown, extra: any[] = []) => [
    ...extra,
    { role: 'user', content: userText },
  ];

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  test('1) empty input -> mini none / no-user-text', () => {
    const res = chooseModel([]);
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('no-user-text');
  });

  test('2) short general question -> mini low / short-general-request', () => {
    const res = chooseModel(mk('Сколько времени займет деплой?'));
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('short-general-request');
  });

  test('3) simple codegen -> mini low/medium / codegen-or-refactor', () => {
    const res = chooseModel(mk('Напиши функцию на TypeScript: function sum(a,b) { return a+b }'));
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('codegen-or-refactor');
  });

  test('4) short refactor -> mini medium / codegen-or-refactor', () => {
    const res = chooseModel(mk('Рефакторни эту функцию, сделай чище. ```ts\nexport function a(x:number){return x+1}\n```'));
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('codegen-or-refactor');
  });

  test('5) long refactor -> full high / codegen-or-refactor-long-or-complex', () => {
    const long = '```ts\n' + 'const x = 1;\n'.repeat(400) + '```\nРефакторни файл целиком';
    const res = chooseModel(mk(long));
    expect(res.model).toBe('gpt-5.4');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('codegen-or-refactor-long-or-complex');
  });

  test('6) stack trace -> full xhigh/high / deep-code-debug-review', () => {
    const txt = `TypeError: Cannot read properties of undefined\n    at foo (/app/x.js:10:5)\n    at bar (/app/y.js:20:1)\nError: boom\nTraceback (most recent call last):\n`;
    const res = chooseModel(mk(txt));
    expect(res.model).toBe('gpt-5.4');
    expect(['medium', 'high', 'xhigh']).toContain(res.reasoning?.effort);
    expect(res.reason).toBe('deep-code-debug-review');
  });

  test('7) large diff review -> full high/xhigh / deep-code-debug-review', () => {
    const diff = '```diff\n' + '@@ -1,1 +1,1 @@\n'.repeat(6) + '+ new\n- old\n```\nпосмотри diff и сделай review';
    const res = chooseModel(mk(diff));
    expect(res.model).toBe('gpt-5.4');
    expect(['medium', 'high', 'xhigh']).toContain(res.reasoning?.effort);
    expect(res.reason).toBe('deep-code-debug-review');
  });

  test('8) architecture question -> full high / architecture-or-design', () => {
    const res = chooseModel(mk('Как лучше спроектировать архитектуру слоев и boundaries? Trade-offs, DDD.'));
    expect(res.model).toBe('gpt-5.4');
    expect(res.reasoning?.effort).toBe('high');
    expect(res.reason).toBe('architecture-or-design');
  });

  test('9) extraction to JSON -> nano none/low / classification-or-extraction-or-ranking', () => {
    const res = chooseModel(mk('Извлеки поля name,email и верни JSON.'));
    expect(res.model).toBe('gpt-5.4-nano');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('classification-or-extraction-or-ranking');
  });

  test('10) ranking -> nano none/low / classification-or-extraction-or-ranking', () => {
    const res = chooseModel(mk('Сравни и ранжируй варианты A,B,C по релевантности. Верни список.'));
    expect(res.model).toBe('gpt-5.4-nano');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('classification-or-extraction-or-ranking');
  });

  test('11) PM/status request -> mini low/medium / pm-or-status-or-ci-cd-or-deploy', () => {
    const res = chooseModel(mk('Дай статус по issue #123 и следующий шаг.'));
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('pm-or-status-or-ci-cd-or-deploy');
  });

  test('12) deploy / Vercel logs -> mini medium / pm-or-status-or-ci-cd-or-deploy', () => {
    const txt = 'Vercel deployment log: build failed. workflow CI failed.\n' + 'line\n'.repeat(200);
    const res = chooseModel(mk(txt));
    expect(res.model).toBe('gpt-5.4-mini');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('pm-or-status-or-ci-cd-or-deploy');
  });

  test('13) multi-message long context -> full medium/high / long-context-general', () => {
    const msgs = Array.from({ length: 35 }).map((_, i) => ({
      role: i % 3 === 0 ? 'assistant' : 'user',
      content: 'контекст '.repeat(50),
    }));
    msgs.push({ role: 'user', content: 'Продолжай, но учти весь контекст' });
    const res = chooseModel(msgs as any);
    expect(res.model).toBe('gpt-5.4');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('long-context-general');
  });

  test('14) mixed: short code + severe error -> full high/xhigh / deep-code-debug-review', () => {
    const txt = '```ts\nconsole.log(1)\n```\nError: connection refused\nTypeError: x is not a function\n    at foo (a:1:1)';
    const res = chooseModel(mk(txt));
    expect(res.model).toBe('gpt-5.4');
    expect(['high', 'xhigh']).toContain(res.reasoning?.effort);
    expect(res.reason).toBe('deep-code-debug-review');
  });

  test('15) mixed: extraction request with a code snippet -> nano none/low / classification-or-extraction-or-ranking', () => {
    const txt = 'Извлеки поля и верни JSON. ```ts\nconst user = {name:"a", email:"b"}\n```';
    const res = chooseModel(mk(txt));
    expect(res.model).toBe('gpt-5.4-nano');
    expect(res.reasoning).toBeUndefined();
    expect(res.reason).toBe('classification-or-extraction-or-ranking');
  });

  test('16) repo-wide strong_spec audit -> full medium/high/xhigh / repo-audit-or-spec-compliance', () => {
    const txt =
      'Work in repo fairyplace-mailer/botcow_assistance branch provecta. Make a full audit against docs/strong_spec.md. Check strict mode. Do not change anything.';
    const res = chooseModel(mk(txt));
    expect(res.model).toBe('gpt-5.4');
    expect(['medium', 'high', 'xhigh']).toContain(res.reasoning?.effort);
    expect(res.reason).toBe('repo-audit-or-spec-compliance');
  });


  test('18) strong_spec and Responses API mention alone do not force repo audit', () => {
    const txt =
      'Сделай бота стабильным и работоспособным. Если есть конфликт между кодом, docs/strong_spec.md и strong mode Responses API, соблюдай приоритет спецификации.';
    const res = chooseModel(mk(txt));
    expect(res.reason).not.toBe('repo-audit-or-spec-compliance');
  });

  test('17) explicit backend hints for multi-file and long context escalate routing', () => {
    const res = chooseModel(mk('Сделай изменения', []), {
      multiFileIntent: true,
      longContextSize: 9000,
      toolHeavy: true,
    });
    expect(res.model).toBe('gpt-5.4');
    expect(res.reasoning?.effort).toBe('high');
    expect(res.reason).toBe('architecture-or-design');
  });

});
