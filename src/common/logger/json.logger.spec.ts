import { JsonLogger } from './json.logger';

/** Yozilgan qatorlarni ushlab qoladi. */
function captureOutput(run: () => void): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  };

  try {
    run();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout, stderr };
}

describe('JsonLogger', () => {
  const logger = new JsonLogger(['error', 'warn', 'log']);

  it('bir qatorli JSON yozadi', () => {
    const { stdout } = captureOutput(() => logger.log('salom', 'Test'));

    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout)).toEqual({
      time: expect.any(String) as string,
      level: 'log',
      context: 'Test',
      message: 'salom',
    });
  });

  it('xatolikni stderr ga yozadi', () => {
    const { stdout, stderr } = captureOutput(() => logger.error('yomon', 'stack-here', 'Test'));

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toMatchObject({ level: 'error', stack: 'stack-here' });
  });

  it('yoqilmagan darajani yozmaydi', () => {
    const { stdout } = captureOutput(() => logger.debug("ko'rinmasin"));

    expect(stdout).toBe('');
  });

  it('Error obyektidan message va stack oladi', () => {
    const { stderr } = captureOutput(() => logger.error(new Error('portladi')));

    const record = JSON.parse(stderr) as { message: string; stack?: string };
    expect(record.message).toBe('Error: portladi');
    expect(record.stack).toContain('Error: portladi');
  });

  it('obyekt kelganda maxfiy qiymatlarni yashiradi', () => {
    // Nest global exception filtri aynan shunday chaqiradi — obyekt uzatadi.
    const { stderr } = captureOutput(() =>
      logger.error(
        { ctx: { api: { token: '111:SECRET' }, update: { message: { text: '654321' } } } },
        undefined,
        'ExceptionsHandler',
      ),
    );

    expect(stderr).not.toContain('SECRET');
    expect(stderr).not.toContain('654321');
  });

  it("har bir qator to'g'ri JSON bo'ladi", () => {
    const { stdout } = captureOutput(() => {
      logger.log('bir\nikki', 'Ctx');
      logger.log('uch');
    });

    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });
});
