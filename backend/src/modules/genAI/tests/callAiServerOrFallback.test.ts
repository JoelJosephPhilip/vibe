import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

const axiosGet = vi.fn();
vi.mock('axios', () => ({
  default: {get: (...args: unknown[]) => axiosGet(...args)},
}));

const {GenAIService} = await import('../services/GenAIService.js');
const {JobState, TaskType, TaskStatus} = await import(
  '../classes/transformers/GenAI.js'
);
const {aiConfig} = await import('#root/config/ai.js');

/** Minimal MongoDatabase stand-in: _withTransaction only needs a session. */
const fakeDb = {
  getClient: async () => ({
    startSession: () => ({
      startTransaction: () => undefined,
      commitTransaction: async () => undefined,
      abortTransaction: async () => undefined,
      endSession: async () => undefined,
      inTransaction: () => false,
    }),
  }),
};

function jobState(overrides: Partial<InstanceType<typeof JobState>>) {
  const state = new JobState();
  Object.assign(state, overrides);
  return state;
}

function makeService() {
  const repo = {
    getById: vi.fn(async () => ({_id: 'job-1', jobStatus: {}})),
    getTaskDataByJobId: vi.fn(async () => ({})),
    update: vi.fn(async (_id: string, job: unknown) => job),
    updateTaskData: vi.fn(async (_id: string, taskData: unknown) => taskData),
  };
  const sseService = {send: vi.fn()};
  const localTranscriptionService = {
    transcribe: vi.fn(async () => ({
      status: TaskStatus.COMPLETED,
      fileName: 'transcripts/job-1.json',
      fileUrl: 'https://storage.googleapis.com/bucket/transcripts/job-1.json',
    })),
  };
  const localQuestionGenerationService = {
    generate: vi.fn(async () => ({
      status: TaskStatus.COMPLETED,
      fileName: 'questions/job-1.json',
      fileUrl: 'https://storage.googleapis.com/bucket/questions/job-1.json',
      segmentMapUsed: [10, 20],
    })),
  };

  const service = new (GenAIService as any)(
    null, // webhookService — unused, _callAiServerOrFallback takes callWebhook directly
    repo, // genAIRepository
    null, // itemService
    null, // questionBankService
    null, // questionService
    null, // quizService
    fakeDb, // mongoDatabase
    null, // cloudStorageService
    sseService,
    localTranscriptionService,
    localQuestionGenerationService,
    null, // storage
  );

  return {
    service,
    repo,
    sseService,
    localTranscriptionService,
    localQuestionGenerationService,
  };
}

beforeEach(() => {
  axiosGet.mockReset();
  aiConfig.localFallbackEnabled = true;
});

afterEach(() => {
  aiConfig.localFallbackEnabled = true;
});

describe('_callAiServerOrFallback', () => {
  it('returns the webhook result directly when the AI server call succeeds — no fallback fires', async () => {
    const {service, localTranscriptionService, sseService} = makeService();
    const state = jobState({currentTask: TaskType.TRANSCRIPT_GENERATION, file: 'https://audio'});
    const callWebhook = vi.fn(async () => ({ok: true}));

    const result = await (service as any)._callAiServerOrFallback(
      'job-1',
      state,
      callWebhook,
    );

    expect(result).toEqual({ok: true});
    expect(localTranscriptionService.transcribe).not.toHaveBeenCalled();
    expect(sseService.send).not.toHaveBeenCalled();
  });

  it('falls back to LocalTranscriptionService for TRANSCRIPT_GENERATION when the webhook call throws', async () => {
    const {service, localTranscriptionService, sseService, repo} = makeService();
    const state = jobState({
      currentTask: TaskType.TRANSCRIPT_GENERATION,
      file: 'https://audio/job-1.mp3',
    });
    const callWebhook = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await (service as any)._callAiServerOrFallback(
      'job-1',
      state,
      callWebhook,
    );

    expect(localTranscriptionService.transcribe).toHaveBeenCalledWith(
      'job-1',
      'https://audio/job-1.mp3',
    );
    expect(sseService.send).toHaveBeenCalledWith(
      'job-1',
      'jobStatus',
      expect.objectContaining({task: TaskType.TRANSCRIPT_GENERATION, degraded: true}),
    );
    expect(result.status).toBe(TaskStatus.COMPLETED);
    // fed through the same sink a real webhook callback uses
    expect(repo.update).toHaveBeenCalled();
  });

  it('falls back to LocalQuestionGenerationService for QUESTION_GENERATION when the webhook call throws', async () => {
    const {service, localQuestionGenerationService, sseService} = makeService();
    axiosGet.mockResolvedValue({
      data: {chunks: [{timestamp: [0, 5], text: 'hello world'}]},
    });
    const state = jobState({
      currentTask: TaskType.QUESTION_GENERATION,
      file: 'https://transcript/job-1.json',
      segmentMap: [10, 20],
    });
    const callWebhook = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await (service as any)._callAiServerOrFallback(
      'job-1',
      state,
      callWebhook,
    );

    expect(localQuestionGenerationService.generate).toHaveBeenCalledWith(
      'job-1',
      [{timestamp: [0, 5], text: 'hello world'}],
      [10, 20],
      state.parameters ?? {},
    );
    expect(sseService.send).toHaveBeenCalledWith(
      'job-1',
      'jobStatus',
      expect.objectContaining({task: TaskType.QUESTION_GENERATION, degraded: true}),
    );
    expect(result.status).toBe(TaskStatus.COMPLETED);
  });

  it.each([TaskType.AUDIO_EXTRACTION, TaskType.SEGMENTATION, TaskType.UPLOAD_CONTENT])(
    'rethrows for %s — no local fallback exists for that stage',
    async task => {
      const {service, localTranscriptionService, localQuestionGenerationService, sseService} =
        makeService();
      const state = jobState({currentTask: task});
      const callWebhook = vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      });

      await expect(
        (service as any)._callAiServerOrFallback('job-1', state, callWebhook),
      ).rejects.toThrow('connect ECONNREFUSED');

      expect(localTranscriptionService.transcribe).not.toHaveBeenCalled();
      expect(localQuestionGenerationService.generate).not.toHaveBeenCalled();
      expect(sseService.send).not.toHaveBeenCalled();
    },
  );

  it('rethrows instead of falling back when localFallbackEnabled is false', async () => {
    aiConfig.localFallbackEnabled = false;
    const {service, localTranscriptionService} = makeService();
    const state = jobState({
      currentTask: TaskType.TRANSCRIPT_GENERATION,
      file: 'https://audio/job-1.mp3',
    });
    const callWebhook = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(
      (service as any)._callAiServerOrFallback('job-1', state, callWebhook),
    ).rejects.toThrow('connect ECONNREFUSED');
    expect(localTranscriptionService.transcribe).not.toHaveBeenCalled();
  });
});
