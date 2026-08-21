import { Test } from '@nestjs/testing';
import { StaleVoteSweeper } from './stale-vote.sweeper';
import { VoteService } from './vote.service';

const voteServiceMock = { failStaleVotes: jest.fn() };

describe('StaleVoteSweeper', () => {
  let sweeper: StaleVoteSweeper;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    voteServiceMock.failStaleVotes.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [StaleVoteSweeper, { provide: VoteService, useValue: voteServiceMock }],
    }).compile();
    sweeper = moduleRef.get(StaleVoteSweeper);
  });

  afterEach(() => {
    sweeper.onModuleDestroy();
    jest.useRealTimers();
  });

  it('20 daqiqadan eski yozuvlarni yopadi', async () => {
    jest.setSystemTime(new Date('2026-08-21T12:00:00Z'));

    await sweeper.sweep();

    expect(voteServiceMock.failStaleVotes).toHaveBeenCalledWith(new Date('2026-08-21T11:40:00Z'));
  });

  it('davriy ishga tushadi', async () => {
    sweeper.onModuleInit();

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(voteServiceMock.failStaleVotes).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(voteServiceMock.failStaleVotes).toHaveBeenCalledTimes(2);
  });

  it('tozalash yiqilsa ilova ishlashda davom etadi', async () => {
    voteServiceMock.failStaleVotes.mockRejectedValue(new Error('DB uzildi'));

    await expect(sweeper.sweep()).resolves.toBeUndefined();
  });

  it("to'xtatilgandan keyin ishlamaydi", async () => {
    sweeper.onModuleInit();
    sweeper.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(voteServiceMock.failStaleVotes).not.toHaveBeenCalled();
  });

  it("timer unref qilinadi — process chiqishiga to'sqinlik qilmasin", () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as never);

    sweeper.onModuleInit();

    // `unref()` qilinmasa ilova hech qachon o'z-o'zidan to'xtamasdi.
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });
});
