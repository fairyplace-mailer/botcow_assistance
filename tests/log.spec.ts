import {
  clearRecentRunEvents,
  getRecentRunEvents,
  logInfo,
  logWarn,
  MAX_RECENT_RUN_EVENTS,
} from '../src/backend/log';

describe('log ring buffer', () => {
  beforeEach(() => {
    clearRecentRunEvents();
    jest.restoreAllMocks();
  });

  test('stores structured events per run', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await logInfo('assistant_round_start', {
      traceId: 'run_1',
      round: 1,
      responseId: 'resp_1',
    });

    const events = getRecentRunEvents('run_1');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        event: 'assistant_round_start',
        payload: expect.objectContaining({
          traceId: 'run_1',
          round: 1,
          responseId: 'resp_1',
        }),
      }),
    );
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  test('ring buffer keeps only last MAX_RECENT_RUN_EVENTS entries', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (let i = 1; i <= MAX_RECENT_RUN_EVENTS + 5; i += 1) {
      await logWarn('assistant_tool_ok', {
        traceId: 'run_2',
        round: i,
      });
    }

    const events = getRecentRunEvents('run_2');
    expect(events).toHaveLength(MAX_RECENT_RUN_EVENTS);
    expect(events[0]?.payload.round).toBe(6);
    expect(events.at(-1)?.payload.round).toBe(MAX_RECENT_RUN_EVENTS + 5);
    expect(warnSpy).toHaveBeenCalledTimes(MAX_RECENT_RUN_EVENTS + 5);
  });
});
