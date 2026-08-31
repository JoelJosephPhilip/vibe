import { injectable, inject } from 'inversify';
import { WebhookService } from './WebhookService.js';
import { SseService } from './sseService.js';
import { LocalTranscriptionService } from './LocalTranscriptionService.js';
import { LocalQuestionGenerationService } from './LocalQuestionGenerationService.js';
import { LocalAudioExtractionService } from './LocalAudioExtractionService.js';
import { LocalSegmentationService } from './LocalSegmentationService.js';
import { LocalCoursePlanService } from './LocalCoursePlanService.js';
import { LocalTranscriptFormatService, ConvertToChunksResult } from './LocalTranscriptFormatService.js';
import { GENAI_TYPES } from '../types.js';
import { JobBody } from '../classes/validators/GenAIValidators.js';
import { GenAIRepository } from '../repositories/providers/mongodb/GenAIRepository.js';
import { BaseService } from '#root/shared/classes/BaseService.js';
import { ItemType, MongoDatabase } from '#root/shared/index.js';
import { GLOBAL_TYPES } from '#root/types.js';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from 'routing-controllers';
import {
  audioData,
  contentUploadData,
  CourseSectionPlan,
  GenAIBody,
  JobState,
  JobStatus,
  questionGenerationData,
  QuestionGenerationParameters,
  segmentationData,
  SegmentationParameters,
  TaskData,
  TaskStatus,
  TaskType,
  TranscriptParameters,
  trascriptGenerationData,
  UploadParameters,
} from '../classes/transformers/GenAI.js';
import { QuestionFactory } from '#root/modules/quizzes/classes/index.js';
import { CreateItemBody } from '#root/modules/courses/classes/index.js';
import { COURSES_TYPES } from '#root/modules/courses/types.js';
import { ItemService } from '#root/modules/courses/services/ItemService.js';
import { ModuleService } from '#root/modules/courses/services/ModuleService.js';
import { SectionService } from '#root/modules/courses/services/SectionService.js';
import { CourseService } from '#root/modules/courses/services/CourseService.js';
import { Course } from '#root/modules/courses/classes/transformers/Course.js';
import { CreateModuleBody } from '#root/modules/courses/classes/validators/ModuleValidators.js';
import { CreateSectionBody } from '#root/modules/courses/classes/validators/SectionValidators.js';
import { CourseBody } from '#root/modules/courses/classes/validators/CourseValidators.js';
import { QuestionBank } from '#root/modules/quizzes/classes/transformers/QuestionBank.js';
import { QUIZZES_TYPES } from '#root/modules/quizzes/types.js';
import {
  QuestionBankService,
  QuizService,
} from '#root/modules/quizzes/services/index.js';
import { QuestionService } from '#root/modules/quizzes/services/QuestionService.js';
import { Storage } from '@google-cloud/storage';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { aiConfig } from '#root/config/ai.js';
import { appConfig } from '#root/config/app.js';
import { ANOMALIES_TYPES } from '#root/modules/anomalies/types.js';
import { CloudStorageService } from '#root/modules/anomalies/index.js';
import { storageConfig } from '#root/config/storage.js';
import { extractVideoKey } from '../utils/videoKey.js';
import { ObjectId } from 'mongodb';

type BloomLevelKey =
  | 'knowledge'
  | 'understanding'
  | 'application'
  | 'analysis'
  | 'evaluation'
  | 'creation'
  | 'unclassified';

@injectable()
export class GenAIService extends BaseService {
  constructor(
    @inject(GENAI_TYPES.WebhookService)
    private readonly webhookService: WebhookService,

    @inject(GENAI_TYPES.GenAIRepository)
    private readonly genAIRepository: GenAIRepository,

    @inject(COURSES_TYPES.ItemService)
    private readonly itemService: ItemService,

    @inject(QUIZZES_TYPES.QuestionBankService)
    private readonly questionBankService: QuestionBankService,

    @inject(QUIZZES_TYPES.QuestionService)
    private readonly questionService: QuestionService,

    @inject(QUIZZES_TYPES.QuizService)
    private readonly quizService: QuizService,

    @inject(GLOBAL_TYPES.Database)
    private readonly mongoDatabase: MongoDatabase,

    @inject(ANOMALIES_TYPES.CloudStorageService)
    private readonly cloudStorageService: CloudStorageService,

    @inject(GENAI_TYPES.SseService)
    private readonly sseService: SseService,

    @inject(GENAI_TYPES.LocalTranscriptionService)
    private readonly localTranscriptionService: LocalTranscriptionService,

    @inject(GENAI_TYPES.LocalQuestionGenerationService)
    private readonly localQuestionGenerationService: LocalQuestionGenerationService,

    @inject(GENAI_TYPES.LocalAudioExtractionService)
    private readonly localAudioExtractionService: LocalAudioExtractionService,

    @inject(GENAI_TYPES.LocalSegmentationService)
    private readonly localSegmentationService: LocalSegmentationService,

    @inject(GENAI_TYPES.LocalCoursePlanService)
    private readonly localCoursePlanService: LocalCoursePlanService,

    @inject(GENAI_TYPES.LocalTranscriptFormatService)
    private readonly localTranscriptFormatService: LocalTranscriptFormatService,

    @inject(COURSES_TYPES.ModuleService)
    private readonly moduleService: ModuleService,

    @inject(COURSES_TYPES.SectionService)
    private readonly sectionService: SectionService,

    @inject(COURSES_TYPES.CourseService)
    private readonly courseService: CourseService,

    private storage = new Storage({
      projectId: appConfig.firebase.projectId,
    }),
  ) {
    super(mongoDatabase);
  }

  /**
   * Start a new genAI job
   * @param jobData Job configuration data
   * @returns Created job data
   */
  async startJob(
    userId: string,
    jobData: JobBody,
    audio?: Express.Multer.File,
  ): Promise<{ jobId: string }> {
    return this._withTransaction(async session => {
      const jobId = await this.genAIRepository.save(
        userId,
        jobData,
        audio ? true : false,
        jobData.transcript ? true : false,
        session,
      );
      if (audio) {
        // check file type (audio/)
        if (!audio.mimetype.startsWith('audio/')) {
          throw new BadRequestError(
            'Invalid file type. Please upload an audio file.',
          );
        }
        // store on buckets
        const fileName = await this.cloudStorageService.uploadAudio(
          audio,
          jobId,
        );
        await this.genAIRepository.createTaskDataWithAudio(
          jobId,
          fileName,
          `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`,
          session,
        );
      } else if (jobData.transcript) {
        const fileName = await this.cloudStorageService.uploadTranscript(
          jobData.transcript,
          jobId,
        );
        await this.genAIRepository.createTaskDataWithTranscript(
          jobId,
          fileName,
          `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`,
          session,
        );
      } else {
        await this.genAIRepository.createTaskData(jobId, session);
      }

      return { jobId };
    });
  }

  async abortTask(jobId: string): Promise<void> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError(`Job with ID ${jobId} not found`);
      }

      // Check which task is currently running
      let runningTask: TaskType | null = null;

      if (job.jobStatus.audioExtraction === TaskStatus.RUNNING) {
        runningTask = TaskType.AUDIO_EXTRACTION;
      } else if (job.jobStatus.transcriptGeneration === TaskStatus.RUNNING) {
        runningTask = TaskType.TRANSCRIPT_GENERATION;
      } else if (job.jobStatus.segmentation === TaskStatus.RUNNING) {
        runningTask = TaskType.SEGMENTATION;
      } else if (job.jobStatus.questionGeneration === TaskStatus.RUNNING) {
        runningTask = TaskType.QUESTION_GENERATION;
      } else if (job.jobStatus.uploadContent === TaskStatus.RUNNING) {
        runningTask = TaskType.UPLOAD_CONTENT;
      }

      if (!runningTask) {
        throw new BadRequestError(`No running tasks found for job ID ${jobId}`);
      }

      if (runningTask === TaskType.UPLOAD_CONTENT) {
        throw new InternalServerError('Task upload content cannot be aborted');
      }

      await this.webhookService.abortTask(jobId);
      await this.updateJob(jobId, runningTask, {
        status: TaskStatus.ABORTED,
        error: 'Task aborted by user',
      });
    });
  }

  removeUndefined(obj: any) {
    if (!obj) return null;
    return Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v !== undefined),
    );
  }

  async approveTaskToStart(
    jobId: string,
    userId: string,
    usePrevious?: number,
    parameters?: Partial<
      | TranscriptParameters
      | SegmentationParameters
      | QuestionGenerationParameters
      | UploadParameters
    >,
  ): Promise<any> {
    // Same split as rerunTask below: only the guard checks and parameter
    // bookkeeping are transactional. uploadContent (and the webhook/
    // fallback call for every other task type) is long-running network
    // work that doesn't use this transaction's session, so wrapping it
    // here just re-creates the exact long-held-transaction hang
    // uploadContent's own internal restructuring was meant to eliminate --
    // this is the primary path callers use to start UPLOAD_CONTENT (not
    // just the rerunTask retry path), so it needs the same fix.
    const {jobState, isUploadContentRun} = await this._withTransaction(
      async session => {
        const job = await this.genAIRepository.getById(jobId, session);
        if (!job) {
          throw new NotFoundError(`Job with ID ${jobId} not found`);
        }
        // if (job.userId !== userId) {
        //   throw new NotFoundError(`User with ID ${userId} does not have permission to approve this job`);
        // }
        const jobState = await this.getJobState(jobId, usePrevious);
        jobState.parameters = {
          ...jobState.parameters,
          ...this.removeUndefined(parameters),
        };
        if (jobState.taskStatus == TaskStatus.COMPLETED) {
          throw new BadRequestError(
            `The task ${jobState.currentTask} for job ID ${jobId} is already completed, you can either rerun the task or approve to move to the next taask.`,
          );
        }
        if (jobState.currentTask === TaskType.UPLOAD_CONTENT) {
          // Persist upload parameters to DB before content upload
          let resolvedUploadParameters = {
            ...job.uploadParameters,
          } as UploadParameters;

          if (parameters) {
            resolvedUploadParameters = {
              ...job.uploadParameters,
              ...this.removeUndefined(parameters as Partial<UploadParameters>),
            };

            // Keep upload destination stable for the life of this job.
            // UI-provided module/section at upload time should not redirect content elsewhere.
            if (job.uploadParameters.moduleId) {
              resolvedUploadParameters.moduleId = job.uploadParameters.moduleId;
            }
            if (job.uploadParameters.sectionId) {
              resolvedUploadParameters.sectionId = job.uploadParameters.sectionId;
            }
            // Same for an auto-created course/version once uploadContent has
            // persisted one -- a stray override shouldn't fork a job onto a
            // second course mid-pipeline.
            if (job.uploadParameters.courseId) {
              resolvedUploadParameters.courseId = job.uploadParameters.courseId;
            }
            if (job.uploadParameters.versionId) {
              resolvedUploadParameters.versionId = job.uploadParameters.versionId;
            }

            await this.genAIRepository.update(jobId, {
              uploadParameters: resolvedUploadParameters,
            }, session);
          }

          jobState.parameters = resolvedUploadParameters;
          return {jobState, isUploadContentRun: true};
        }
        return {jobState, isUploadContentRun: false};
      },
    );

    if (isUploadContentRun) {
      return this.uploadContent(jobId, jobState);
    }
    // Direct call, replaced below by a fallback-aware wrapper:
    // return this.webhookService.approveTaskStart(jobId, jobState);
    return this._callAiServerOrFallback(jobId, jobState, (id, state) =>
      this.webhookService.approveTaskStart(id, state),
    );
  }

  async rerunTask(
    jobId: string,
    userId: string,
    usePrevious?: number,
    parameters?: Partial<
      | TranscriptParameters
      | SegmentationParameters
      | QuestionGenerationParameters
      | UploadParameters
    >,
  ): Promise<any> {
    // Only the guard checks and the parameter bookkeeping below need to be
    // transactional; the actual dispatch (uploadContent, or the webhook/
    // fallback call for every other task type) is long-running network work
    // that was never part of what needed atomicity here, so it now runs
    // after this transaction has already committed -- same reasoning as
    // uploadContent's own transaction split above.
    const {jobState, isUploadContentRerun} = await this._withTransaction(
      async session => {
        const job = await this.genAIRepository.getById(jobId, session);
        if (!job) {
          throw new NotFoundError(`Job with ID ${jobId} not found`);
        }
        // if (job.userId !== userId) {
        //   throw new NotFoundError(`User with ID ${userId} does not have permission to approve this job`);
        // }
        const jobState = await this.getJobState(jobId, usePrevious);
        // UPLOAD_CONTENT stuck at RUNNING (see uploadContent's own RUNNING
        // guard) has no other recovery path -- abortTask explicitly refuses
        // to abort it. rerunTask is an explicit, deliberate caller action,
        // unlike approveTaskToStart's silent auto-retry, so it's the one
        // place allowed to force a retry out of RUNNING for this task
        // specifically.
        const isStuckUploadRerun =
          jobState.currentTask === TaskType.UPLOAD_CONTENT &&
          jobState.taskStatus === TaskStatus.RUNNING;
        if (
          jobState.taskStatus !== TaskStatus.COMPLETED &&
          jobState.taskStatus !== TaskStatus.FAILED &&
          jobState.taskStatus !== TaskStatus.ABORTED &&
          !isStuckUploadRerun
        ) {
          throw new BadRequestError(
            `The task ${jobState.currentTask} for job ID ${jobId} has not been completed yet, please approve the task to start.`,
          );
        }
        if (isStuckUploadRerun) {
          // uploadContent() has its own RUNNING guard (it's what got us
          // stuck in the first place) -- bypassing rerunTask's gate above
          // isn't enough, that guard would immediately throw again since
          // jobStatus.uploadContent is still RUNNING from the abandoned
          // attempt. Reset it here, inside this transaction, so the call
          // below starts clean.
          job.jobStatus.uploadContent = TaskStatus.WAITING;
          await this.genAIRepository.update(jobId, job, session);
        }
        jobState.parameters = {
          ...jobState.parameters,
          ...this.removeUndefined(parameters),
        };
        if (jobState.currentTask === TaskType.UPLOAD_CONTENT) {
          // Persist upload parameters to DB before content upload
          let resolvedUploadParameters = {
            ...job.uploadParameters,
          } as UploadParameters;

          if (parameters) {
            resolvedUploadParameters = {
              ...job.uploadParameters,
              ...this.removeUndefined(parameters as Partial<UploadParameters>),
            };

            // Keep upload destination stable for the life of this job.
            if (job.uploadParameters.moduleId) {
              resolvedUploadParameters.moduleId = job.uploadParameters.moduleId;
            }
            if (job.uploadParameters.sectionId) {
              resolvedUploadParameters.sectionId = job.uploadParameters.sectionId;
            }
            // Same for an auto-created course/version once uploadContent has
            // persisted one -- a stray override on retry shouldn't fork the
            // job onto a second course mid-pipeline.
            if (job.uploadParameters.courseId) {
              resolvedUploadParameters.courseId = job.uploadParameters.courseId;
            }
            if (job.uploadParameters.versionId) {
              resolvedUploadParameters.versionId = job.uploadParameters.versionId;
            }

            await this.genAIRepository.update(jobId, {
              uploadParameters: resolvedUploadParameters,
            }, session);
          }

          jobState.parameters = resolvedUploadParameters;
          return {jobState, isUploadContentRerun: true};
        }
        return {jobState, isUploadContentRerun: false};
      },
    );

    if (isUploadContentRerun) {
      return this.uploadContent(jobId, jobState);
    }
    // Direct call, replaced below by a fallback-aware wrapper:
    // return this.webhookService.rerunTask(jobId, jobState);
    return this._callAiServerOrFallback(jobId, jobState, (id, state) =>
      this.webhookService.rerunTask(id, state),
    );
  }

  /**
   * Try the real AI server first; on failure (it lives on a private Tailscale
   * network unreachable from environments without VPN access — see WebhookService),
   * fall back to a local implementation for the stage that failed
   * (AUDIO_EXTRACTION via yt-dlp, TRANSCRIPT_GENERATION via whisper.cpp,
   * SEGMENTATION via embeddings + PELT changepoint detection,
   * QUESTION_GENERATION via MiniMax). UPLOAD_CONTENT has no local fallback
   * (it's a pure DB write, never routed through here — see approveTaskToStart)
   * and any unrecognized task rethrows the original error. The fallback
   * result is fed through the same updateJob(jobId, task, data) sink a real
   * webhook callback would use, after announcing degraded mode over SSE so
   * the UI can warn the user first.
   */
  // Coalesces concurrent fallback calls for the same (jobId, task): a client
  // that times out and retries (or a double-click) would otherwise fire a
  // second yt-dlp/whisper invocation while the first is still running.
  // Confirmed live: repeated client-side retries against one job fired
  // overlapping yt-dlp calls that contributed to tripping YouTube's rate
  // limit, and overlapping whisper calls that raced on the model-file
  // existence check. Keyed by task rather than just jobId since different
  // stages for the same job are independent and shouldn't block each other.
  private static readonly inFlightFallbacks = new Map<string, Promise<any>>();

  private async _callAiServerOrFallback(
    jobId: string,
    jobState: JobState,
    callWebhook: (jobId: string, jobState: JobState) => Promise<any>,
  ): Promise<any> {
    try {
      return await callWebhook(jobId, jobState);
    } catch (err) {
      const task = jobState.currentTask;
      const fallbackCapable =
        task === TaskType.AUDIO_EXTRACTION ||
        task === TaskType.TRANSCRIPT_GENERATION ||
        task === TaskType.SEGMENTATION ||
        task === TaskType.QUESTION_GENERATION;
      if (!aiConfig.localFallbackEnabled || !fallbackCapable) {
        throw err;
      }

      const inFlightKey = `${jobId}:${task}`;
      const existing = GenAIService.inFlightFallbacks.get(inFlightKey);
      if (existing) {
        return existing;
      }

      this.sseService.send(jobId, 'jobStatus', {
        task,
        status: TaskStatus.RUNNING,
        degraded: true,
        reason: 'External AI server unreachable — using local fallback.',
      });

      const runPromise = (async () => {
        const fallbackData = await this._runLocalFallback(jobId, jobState, task);
        await this.updateJob(jobId, task, fallbackData);
        return fallbackData;
      })();
      GenAIService.inFlightFallbacks.set(inFlightKey, runPromise);
      try {
        return await runPromise;
      } finally {
        GenAIService.inFlightFallbacks.delete(inFlightKey);
      }
    }
  }

  private async _runLocalFallback(
    jobId: string,
    jobState: JobState,
    task: TaskType,
  ): Promise<audioData | trascriptGenerationData | segmentationData | questionGenerationData> {
    if (task === TaskType.AUDIO_EXTRACTION) {
      if (!jobState.url) {
        return {
          status: TaskStatus.FAILED,
          error: 'No video URL available for the local audio-extraction fallback.',
        };
      }
      return this.localAudioExtractionService.extract(jobId, jobState.url);
    }

    if (task === TaskType.TRANSCRIPT_GENERATION) {
      if (!jobState.file) {
        return {
          status: TaskStatus.FAILED,
          error: 'No audio file available for the local transcription fallback.',
        };
      }
      return this.localTranscriptionService.transcribe(jobId, jobState.file);
    }

    if (task === TaskType.SEGMENTATION) {
      if (!jobState.file) {
        return {
          status: TaskStatus.FAILED,
          error: 'No transcript file available for the local segmentation fallback.',
          segmentationMap: [],
        };
      }
      const chunks = await this.fetchTranscriptChunks(jobState.file);
      const params = (jobState.parameters ?? {}) as SegmentationParameters;
      const result = await this.localSegmentationService.segment(chunks, params);
      // getJobState() reads QUESTION_GENERATION's input transcript back off
      // this field (task.segmentation[last].transcriptFileUrl) -- confirmed
      // live: LocalSegmentationService itself never sees the URL (only the
      // already-fetched chunks), so without this the next stage fails with
      // "No transcript file or segment map available" despite segmentation
      // having just succeeded.
      return { ...result, transcriptFileUrl: jobState.file };
    }

    // QUESTION_GENERATION
    if (!jobState.file || !jobState.segmentMap) {
      return {
        status: TaskStatus.FAILED,
        error: 'No transcript file or segment map available for the local question-generation fallback.',
        segmentMapUsed: jobState.segmentMap ?? [],
      };
    }
    const chunks = await this.fetchTranscriptChunks(jobState.file);
    const transcriptChunks = chunks.map(c => ({
      timestamp: [c.start, c.end] as [number, number | null],
      text: c.text,
    }));
    const params = (jobState.parameters ?? {}) as QuestionGenerationParameters;
    return this.localQuestionGenerationService.generate(
      jobId,
      transcriptChunks,
      jobState.segmentMap,
      params,
    );
  }

  async approveTaskContinue(jobId: string): Promise<void> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError(`Job with ID ${jobId} not found`);
      }
      if (job.jobStatus.uploadContent === TaskStatus.COMPLETED) {
      } else if (job.jobStatus.questionGeneration === TaskStatus.COMPLETED) {
        job.jobStatus.uploadContent = TaskStatus.WAITING;
      } else if (job.jobStatus.segmentation === TaskStatus.COMPLETED) {
        job.jobStatus.questionGeneration = TaskStatus.WAITING;
      } else if (job.jobStatus.transcriptGeneration === TaskStatus.COMPLETED) {
        job.jobStatus.segmentation = TaskStatus.WAITING;
      } else if (job.jobStatus.audioExtraction === TaskStatus.COMPLETED) {
        job.jobStatus.transcriptGeneration = TaskStatus.WAITING;
      } else {
        throw new NotFoundError(`No active tasks found for job ID ${jobId}`);
      }
      const updatedJob = await this.genAIRepository.update(jobId, job, session);
      if (!updatedJob) {
        throw new InternalServerError(`Failed to update job with ID ${jobId}`);
      }
    });
  }

  /**
   * Get job status by ID
   * @param jobId The jobjobState ID to retrieve status for
   * @returns Job status data
   */
  async getJobStatus(jobId: string): Promise<GenAIBody> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError('job with the given Id not found');
      }
      job._id = job._id.toString();
      return job;
    });
  }

  /**
   * Get task status by job ID and task type
   * @param jobId The job ID to retrieve task status for
   * @param type The type of task to retrieve status for
   * @returns Task status data
   */
  // async getTaskStatus(
  //   jobId: string,
  //   type: TaskType,
  // ): Promise<
  //   | audioData[]
  //   | trascriptGenerationData[]
  //   | segmentationData[]
  //   | questionGenerationData[]
  //   | contentUploadData[]
  // > {
  //   return this._withTransaction(async session => {
  //     const taskData = await this.genAIRepository.getTaskDataByJobId(
  //       jobId,
  //       session,
  //     );
  //     if (!taskData) {
  //       throw new NotFoundError(`Task data for job ID ${jobId} not found`);
  //     }
  //     switch (type) {
  //       case TaskType.AUDIO_EXTRACTION:
  //         return taskData.audioExtraction;
  //       case TaskType.TRANSCRIPT_GENERATION:
  //         return taskData.transcriptGeneration;
  //       case TaskType.SEGMENTATION:
  //         return taskData.segmentation;
  //       case TaskType.QUESTION_GENERATION:
  //         return taskData.questionGeneration;
  //       case TaskType.UPLOAD_CONTENT:
  //         return taskData.uploadContent;
  //       default:
  //         throw new BadRequestError(`Invalid task type: ${type}`);
  //     }
  //   });
  // }

  async getTaskStatus(
    jobId: string,
    type: TaskType,
  ): Promise<any> {
    return this._withTransaction(async session => {

      const taskData = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );

      if (!taskData) {
        return {
          task: type,
          status: "WAITING",
          message: "Job not initialized yet"
        };
      }

      let result;

      switch (type) {
        case TaskType.AUDIO_EXTRACTION:
          result = taskData.audioExtraction;
          break;
        case TaskType.TRANSCRIPT_GENERATION:
          result = taskData.transcriptGeneration;
          break;
        case TaskType.SEGMENTATION:
          result = taskData.segmentation;
          break;
        case TaskType.QUESTION_GENERATION:
          result = taskData.questionGeneration;
          break;
        case TaskType.UPLOAD_CONTENT:
          result = taskData.uploadContent;
          break;
        default:
          throw new BadRequestError(`Invalid task type: ${type}`);
      }

      if (!result) {
        return {
          task: type,
          status: "WAITING"
        };
      }

      return result;
    });
  }

  async editSegmentMap(
    jobId: string,
    segmentMap: Array<number>,
    index?: number,
  ): Promise<void> {
    return this._withTransaction(async session => {
      const task = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!task) {
        throw new NotFoundError(`Task data for job ID ${jobId} not found`);
      }

      // Initialize segmentation array if it doesn't exist 
      if (!task.segmentation || task.segmentation.length === 0) {
        const lastTranscript = task.transcriptGeneration?.[task.transcriptGeneration.length - 1];
        task.segmentation = [
          {
            status: TaskStatus.COMPLETED,
            segmentationMap: segmentMap,
            transcriptFileUrl: lastTranscript?.fileUrl,
          },
        ];
      } else {
        const resolvedIndex =
          index !== undefined ? index : task.segmentation.length - 1;

        if (resolvedIndex < 0 || resolvedIndex >= task.segmentation.length) {
          throw new BadRequestError(
            `Invalid index: ${resolvedIndex}. Segmentation has ${task.segmentation.length} items.`,
          );
        }

        task.segmentation[resolvedIndex].segmentationMap = segmentMap;
      }

      const updatedTask = await this.genAIRepository.updateTaskData(
        jobId,
        task,
        session,
      );
      if (!updatedTask) {
        throw new InternalServerError(
          `Failed to update task for job ID ${jobId}`,
        );
      }
      const job = await this.genAIRepository.getById(jobId, session);
      if (job) {
        job.jobStatus.segmentation = TaskStatus.COMPLETED;
        // Optionally set the next task to WAITING if it was PENDING -- but
        // not when a coursePlan is attached: that PENDING state is the
        // course-structure preview gate (see JobStatus.tsx's driver and
        // CourseStructurePreview), and a merge/split edit here is exactly
        // the in-preview action that gate exists to allow before the user
        // explicitly approves. Auto-advancing on every edit was confirmed
        // live to skip the approval step entirely.
        if (
          job.jobStatus.questionGeneration === TaskStatus.PENDING &&
          !job.coursePlan
        ) {
          job.jobStatus.questionGeneration = TaskStatus.WAITING;
        }
        await this.genAIRepository.update(jobId, job, session);
      }
    });
  }

  async editQuestionData(
    jobId: string,
    questionData: JSON,
    index?: number,
  ): Promise<void> {
    return this._withTransaction(async session => {
      const task = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!task) {
        throw new NotFoundError(`Task data for job ID ${jobId} not found`);
      }

      // ✅ Default to last index if not specified
      const resolvedIndex =
        index !== undefined ? index : task.questionGeneration.length - 1;

      if (
        resolvedIndex < 0 ||
        resolvedIndex >= task.questionGeneration.length
      ) {
        throw new BadRequestError(
          `Invalid index: ${resolvedIndex}. questionGeneration has ${task.questionGeneration.length} items.`,
        );
      }

      const fileName = task.questionGeneration[resolvedIndex].fileName;
      let newFileName: string;

      if (/_updated(?:_\d+)?\.json$/.test(fileName)) {
        newFileName = fileName.replace(
          /_updated(?:_(\d+))?\.json$/,
          (match, p1) => {
            const nextNum = p1 ? parseInt(p1, 10) + 1 : 1;
            return `_updated_${nextNum}.json`;
          },
        );
      } else {
        newFileName = fileName.replace(/\.json$/, '_updated.json');
      }

      const data = JSON.stringify(questionData);

      await this.storage
        .bucket(appConfig.firebase.storageBucket)
        .file(newFileName)
        .save(Buffer.from(data), { contentType: 'application/json' });

      task.questionGeneration[resolvedIndex].fileName = newFileName;
      task.questionGeneration[
        resolvedIndex
      ].fileUrl = `https://storage.googleapis.com/${appConfig.firebase.storageBucket}/${newFileName}`;

      await this.genAIRepository.updateTaskData(jobId, task, session);
    });
  }

  async editTranscript(
    jobId: string,
    transcript: JSON,
    index: number,
  ): Promise<void> {
    return this._withTransaction(async session => {
      const task = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!task) {
        throw new NotFoundError(`Task data for job ID ${jobId} not found`);
      }
      const fileName = task.transcriptGeneration[index].fileName;
      let newFileName: string;
      if (/_updated(?:_\d+)?\.json$/.test(fileName)) {
        newFileName = fileName.replace(
          /_updated(?:_(\d+))?\.json$/,
          (match, p1) => {
            const nextNum = p1 ? parseInt(p1, 10) + 1 : 1;
            return `_updated_${nextNum}.json`;
          },
        );
      } else {
        newFileName = fileName.replace(/\.json$/, '_updated.json');
      }
      const data = JSON.stringify(transcript);
      await this.storage
        .bucket(appConfig.firebase.storageBucket)
        .file(newFileName)
        .save(Buffer.from(data), { contentType: 'application/json' });
      task.transcriptGeneration[index].fileName = newFileName;
      task.transcriptGeneration[
        index
      ].fileUrl = `https://storage.googleapis.com/${appConfig.firebase.storageBucket}/${newFileName}`;
      await this.genAIRepository.updateTaskData(jobId, task, session);
    });
  }

  /**
   * Course-structure preview shown before UPLOAD_CONTENT runs (see
   * GENAI_COURSE_PREVIEW_PLAN.md). Self-healing: only generates AI
   * name/description for segmentEnds that don't already have a stored plan
   * entry, so a merge/split (via editSegmentMap) only costs LLM calls for the
   * boundaries that actually changed -- untouched segments, including any the
   * user hand-edited, keep their existing entry.
   */
  async getCoursePlan(jobId: string): Promise<{
    moduleName: string;
    moduleDescription: string;
    courseName?: string;
    courseDescription?: string;
    versionName?: string;
    videoUrl: string;
    questionsPerQuiz?: number;
    maxAttempts?: number;
    sections: Array<{
      segmentStart: number;
      segmentEnd: number;
      name: string;
      description: string;
      transcriptExcerpt: string;
    }>;
  }> {
    const job = await this._withTransaction(session =>
      this.genAIRepository.getById(jobId, session),
    );
    if (!job) {
      throw new NotFoundError(`GenAI job ${jobId} not found`);
    }
    const task = await this.genAIRepository.getTaskDataByJobId(jobId);
    const segmentation = task?.segmentation?.[task.segmentation.length - 1];
    const segmentMap: number[] = segmentation?.segmentationMap ?? [];
    if (segmentMap.length === 0) {
      throw new BadRequestError(
        `Job ${jobId} has no segmentation yet -- the course plan can only be previewed after SEGMENTATION completes.`,
      );
    }

    const chunks = segmentation?.transcriptFileUrl
      ? await this.fetchTranscriptChunks(segmentation.transcriptFileUrl)
      : [];
    const transcriptChunks = chunks.map(c => ({
      timestamp: [c.start, c.end] as [number, number | null],
      text: c.text,
    }));

    const existingByEnd = new Map(
      (job.coursePlan?.sections ?? []).map(s => [s.segmentEnd, s]),
    );
    const missingEnds = segmentMap.filter(end => !existingByEnd.has(end));
    if (missingEnds.length > 0) {
      const generated = await this.localCoursePlanService.generateSectionPlans(
        transcriptChunks,
        missingEnds,
      );
      for (const plan of generated) {
        existingByEnd.set(plan.segmentEnd, plan);
      }
    }
    // Prune entries for segment boundaries that no longer exist (merge/split).
    // Every entry in segmentMap is now guaranteed present: it either already
    // existed in existingByEnd or was just generated for a missingEnd above.
    const sections: CourseSectionPlan[] = segmentMap.map(end => existingByEnd.get(end)!);

    let moduleName = job.coursePlan?.moduleName;
    let moduleDescription = job.coursePlan?.moduleDescription ?? '';
    if (!moduleName) {
      const generatedModule = await this.localCoursePlanService.generateModulePlan(
        sections.map(s => s.name),
      );
      moduleName = generatedModule.name;
      moduleDescription = generatedModule.description;
    }

    // Only relevant for jobs with no pre-existing courseId/versionId --
    // reuses the module LLM output rather than a second prompt, since a
    // single-video course-generation job's course and module are, in
    // practice, the same thing.
    const hasRealCourse =
      !!job.uploadParameters?.courseId && !!job.uploadParameters?.versionId;
    let courseName = job.coursePlan?.courseName;
    let courseDescription = job.coursePlan?.courseDescription ?? '';
    let versionName = job.coursePlan?.versionName;
    if (!hasRealCourse) {
      if (!courseName) {
        courseName = moduleName;
        courseDescription = moduleDescription;
      }
      if (!versionName) versionName = 'v1';
    }

    job.coursePlan = {
      moduleName,
      moduleDescription,
      sections,
      ...(hasRealCourse ? {} : { courseName, courseDescription, versionName }),
    };
    await this._withTransaction(session =>
      this.genAIRepository.update(jobId, job, session),
    );

    let previousEnd = 0;
    return {
      moduleName,
      moduleDescription,
      ...(hasRealCourse ? {} : { courseName, courseDescription, versionName }),
      videoUrl: job.url,
      questionsPerQuiz: job.uploadParameters?.questionsPerQuiz,
      maxAttempts: job.uploadParameters?.maxAttempts,
      sections: sections.map(s => {
        const segmentStart = previousEnd;
        previousEnd = s.segmentEnd;
        const transcriptExcerpt = transcriptChunks
          .filter(c => c.timestamp[0] >= segmentStart && c.timestamp[0] < s.segmentEnd)
          .map(c => c.text)
          .join(' ')
          .slice(0, 400);
        return { segmentStart, segmentEnd: s.segmentEnd, name: s.name, description: s.description, transcriptExcerpt };
      }),
    };
  }

  async updateCoursePlan(
    jobId: string,
    body: {
      moduleName?: string;
      moduleDescription?: string;
      courseName?: string;
      courseDescription?: string;
      versionName?: string;
      sections: CourseSectionPlan[];
    },
  ): Promise<void> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError(`GenAI job ${jobId} not found`);
      }
      const hasRealCourse =
        !!job.uploadParameters?.courseId && !!job.uploadParameters?.versionId;
      job.coursePlan = {
        moduleName: body.moduleName ?? job.coursePlan?.moduleName ?? 'Module',
        moduleDescription: body.moduleDescription ?? job.coursePlan?.moduleDescription ?? '',
        sections: body.sections,
        ...(hasRealCourse ? {} : {
          courseName: body.courseName ?? job.coursePlan?.courseName,
          courseDescription: body.courseDescription ?? job.coursePlan?.courseDescription ?? '',
          versionName: body.versionName ?? job.coursePlan?.versionName,
        }),
      };
      await this.genAIRepository.update(jobId, job, session);
    });
  }

  // Stateless: no job exists yet at this point in the flow (a teacher
  // pastes a raw transcript on the create-job form before submitting), so
  // this just converts text and returns it -- the caller feeds the result
  // straight into startJob's existing transcript field.
  async convertTranscript(rawText: string): Promise<ConvertToChunksResult> {
    return this.localTranscriptFormatService.convertToChunks(rawText);
  }

  async getAllTasksStatus(jobId: string): Promise<any> {
    return this._withTransaction(async session => {
      const taskData = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!taskData) {
        throw new NotFoundError(`Task data for job ID ${jobId} not found`);
      }
      taskData._id = taskData._id.toString();
      return taskData;
    });
  }

  /**
   * Cut points a teacher can snap a segment boundary to, for one video.
   *
   * The instructor dashboard sets start/end times by typing them; this gives it
   * the timeline positions worth snapping to. Two sources, both already
   * produced by the AI pipeline and until now reachable only if you knew the
   * job id:
   *   - `segmentationMap` — topic boundaries, the better snap target
   *   - transcript chunk ends — sentence-ish ends, plus the text to show at the
   *     cut so the teacher reads where they are landing instead of guessing
   *
   * Always resolves rather than throwing for the "no data" cases: a video that
   * never went through the AI workflow is the normal state, not an error, and
   * the picker degrades to plain nudge controls. The distinct `status` values
   * let the UI say which it is.
   */
  async getVideoSnapPoints(
    videoUrl: string,
    canAccess: (courseId?: string, versionId?: string) => boolean,
  ): Promise<{
    status: 'READY' | 'PENDING' | 'NO_JOB' | 'NO_ACCESS';
    videoKey: string;
    jobId: string | null;
    segmentBoundaries: number[];
    chunks: {start: number; end: number | null; text: string}[];
  }> {
    const videoKey = extractVideoKey(videoUrl);
    if (!videoKey) {
      throw new BadRequestError(
        'Could not identify a video from the given url',
      );
    }

    const empty = {videoKey, jobId: null, segmentBoundaries: [], chunks: []};

    // DB work only — the transcript download happens after this closure so a
    // slow GCS fetch cannot hold a Mongo session open.
    const resolved = await this._withTransaction(async session => {
      const jobs = await this.genAIRepository.findRecentByVideoKey(
        videoKey,
        10,
        session,
      );
      if (jobs.length === 0) return {outcome: 'NO_JOB' as const};

      const permitted = jobs.filter(job =>
        canAccess(
          job.uploadParameters?.courseId,
          job.uploadParameters?.versionId,
        ),
      );
      if (permitted.length === 0) return {outcome: 'NO_ACCESS' as const};

      // Newest first, but the newest job is often a failed re-run sitting on
      // top of a good one — so take the newest that actually produced data.
      for (const job of permitted) {
        const taskData = await this.genAIRepository.getTaskDataByJobId(
          job._id.toString(),
          session,
        );
        if (!taskData) continue;

        const segmentBoundaries = this.latestOf(
          taskData.segmentation,
          entry => entry?.segmentationMap?.length > 0,
        )?.segmentationMap;

        const transcriptFileUrl = this.latestOf(
          taskData.transcriptGeneration,
          entry => Boolean(entry?.fileUrl),
        )?.fileUrl;

        if (segmentBoundaries || transcriptFileUrl) {
          return {
            outcome: 'FOUND' as const,
            jobId: job._id.toString(),
            segmentBoundaries: segmentBoundaries ?? [],
            transcriptFileUrl,
          };
        }
      }

      // Jobs exist and are readable, but none has finished a task we can use.
      return {outcome: 'PENDING' as const, jobId: permitted[0]._id.toString()};
    });

    if (resolved.outcome === 'NO_JOB') return {...empty, status: 'NO_JOB'};
    if (resolved.outcome === 'NO_ACCESS') return {...empty, status: 'NO_ACCESS'};
    if (resolved.outcome === 'PENDING') {
      return {...empty, status: 'PENDING', jobId: resolved.jobId};
    }

    const chunks = resolved.transcriptFileUrl
      ? await this.fetchTranscriptChunks(resolved.transcriptFileUrl)
      : [];

    return {
      status: 'READY',
      videoKey,
      jobId: resolved.jobId,
      segmentBoundaries: this.normalizeBoundaries(resolved.segmentBoundaries),
      chunks,
    };
  }

  /** Last entry satisfying `predicate` — task data arrays append on each re-run. */
  private latestOf<T>(entries: T[] | undefined, predicate: (e: T) => boolean) {
    if (!Array.isArray(entries)) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (predicate(entries[i])) return entries[i];
    }
    return undefined;
  }

  /** Strictly increasing, finite, non-negative seconds. */
  private normalizeBoundaries(values: number[] | undefined): number[] {
    if (!Array.isArray(values)) return [];
    const clean = values
      .map(Number)
      .filter(n => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    return clean.filter((n, i) => i === 0 || n !== clean[i - 1]);
  }

  /**
   * Transcript JSON lives in the storage bucket, one file per job, and is
   * immutable once written — `editTranscript` writes a new `_updated` file
   * rather than overwriting. That makes it safe to cache by url.
   */
  private async fetchTranscriptChunks(
    fileUrl: string,
  ): Promise<{start: number; end: number | null; text: string}[]> {
    const cached = GenAIService.transcriptCache.get(fileUrl);
    if (cached && Date.now() - cached.at < GenAIService.TRANSCRIPT_CACHE_TTL_MS) {
      return cached.chunks;
    }

    let raw: any;
    try {
      const response = await axios.get(fileUrl, {timeout: 20000});
      raw = typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data;
    } catch {
      // A missing or unreachable transcript costs the teacher snap points, not
      // the ability to edit timestamps — so this degrades rather than throws.
      return [];
    }

    const source = Array.isArray(raw?.chunks) ? raw.chunks : [];
    const chunks = source
      .map((chunk: any) => {
        const [start, end] = Array.isArray(chunk?.timestamp)
          ? chunk.timestamp
          : [];
        /*
         * Whisper leaves the final chunk's end null; keep it null rather than
         * inventing a boundary the teacher could snap to. Checked before the
         * cast because `Number(null)` is 0, which is both finite and a
         * plausible-looking timestamp.
         */
        const hasEnd = end !== null && end !== undefined && end !== '';
        const hasStart = start !== null && start !== undefined && start !== '';
        return {
          // NaN here is what the filter below drops the chunk on.
          start: hasStart ? Number(start) : Number.NaN,
          end: hasEnd && Number.isFinite(Number(end)) ? Number(end) : null,
          text: typeof chunk?.text === 'string' ? chunk.text.trim() : '',
        };
      })
      .filter(chunk => Number.isFinite(chunk.start) && chunk.start >= 0)
      .sort((a, b) => a.start - b.start);

    if (GenAIService.transcriptCache.size >= GenAIService.TRANSCRIPT_CACHE_MAX) {
      GenAIService.transcriptCache.clear();
    }
    GenAIService.transcriptCache.set(fileUrl, {chunks, at: Date.now()});

    return chunks;
  }

  private static readonly TRANSCRIPT_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly TRANSCRIPT_CACHE_MAX = 50;
  private static readonly transcriptCache = new Map<
    string,
    {chunks: {start: number; end: number | null; text: string}[]; at: number}
  >();

  async deleteJob(userId: string, jobId: string): Promise<void> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError(`Job with ID ${jobId} not found`);
      }
      if (job.userId?.toString() !== userId) {
        throw new ForbiddenError(
          `User with ID ${userId} does not have permission to delete this job`,
        );
      }
      await this.genAIRepository.deleteById(jobId, session);
    });
  }

  async getAllJobsData(userId: string): Promise<any> {
    return this._withTransaction(async session => {
      const jobs = await this.genAIRepository.getAllByUserId(userId, session);
      jobs.forEach(j => {
        j._id = j._id.toString();
      });
      return jobs;
    });
  }

  /**
   * Update job status based on webhook data
   * @param jobId The job ID
   * @param jobData Updated job data
   * @returns Updated job information
   */
  async updateJob(
    jobId: string,
    task: string,
    jobData?:
      | audioData
      | trascriptGenerationData
      | segmentationData
      | questionGenerationData
      | contentUploadData,
  ): Promise<any> {
    return this._withTransaction(async session => {
      // Retrieve existing job
      const job = await this.genAIRepository.getById(jobId, session);
      const taskData = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!job || !taskData) {
        throw new NotFoundError(`Job with ID ${jobId} not found`);
      }
      if (
        jobData.status === TaskStatus.COMPLETED ||
        jobData.status === TaskStatus.FAILED ||
        jobData.status === TaskStatus.ABORTED
      ) {
        switch (task) {
          case TaskType.AUDIO_EXTRACTION:
            job.jobStatus.audioExtraction = jobData.status;
            if (taskData.audioExtraction) {
              taskData.audioExtraction.push({ ...(jobData as audioData) });
            } else {
              taskData.audioExtraction = [{ ...(jobData as audioData) }];
            }
            break;
          case TaskType.TRANSCRIPT_GENERATION:
            job.jobStatus.transcriptGeneration = jobData.status;
            if (taskData.transcriptGeneration) {
              taskData.transcriptGeneration.push({
                ...(jobData as trascriptGenerationData),
              });
            } else {
              taskData.transcriptGeneration = [
                { ...(jobData as trascriptGenerationData) },
              ];
            }
            break;
          case TaskType.SEGMENTATION:
            job.jobStatus.segmentation = jobData.status;
            if (taskData.segmentation) {
              taskData.segmentation.push({ ...(jobData as segmentationData) });
            } else {
              taskData.segmentation = [{ ...(jobData as segmentationData) }];
            }
            break;
          case TaskType.QUESTION_GENERATION:
            job.jobStatus.questionGeneration = jobData.status;
            if (taskData.questionGeneration) {
              taskData.questionGeneration.push({
                ...(jobData as questionGenerationData),
              });
            } else {
              taskData.questionGeneration = [
                { ...(jobData as questionGenerationData) },
              ];
            }
            break;
        }
      } else {
        switch (task) {
          case TaskType.AUDIO_EXTRACTION:
            job.jobStatus.audioExtraction = jobData.status;
            break;
          case TaskType.TRANSCRIPT_GENERATION:
            job.jobStatus.transcriptGeneration = jobData.status;
            break;
          case TaskType.SEGMENTATION:
            job.jobStatus.segmentation = jobData.status;
            break;
          case TaskType.QUESTION_GENERATION:
            job.jobStatus.questionGeneration = jobData.status;
            break;
        }
      }
      // Update job and task data
      const updatedJob = await this.genAIRepository.update(jobId, job, session);
      const updatedTaskData = await this.genAIRepository.updateTaskData(
        jobId,
        taskData,
        session,
      );
      if (!updatedJob || !updatedTaskData) {
        throw new NotFoundError(
          `Failed to update job or task data for job ID ${jobId}`,
        );
      }
    });
  }

  async getJobState(jobId: string, usePrevious?: number): Promise<JobState> {
    return this._withTransaction(async session => {
      const job = await this.genAIRepository.getById(jobId, session);
      if (!job) {
        throw new NotFoundError(`Job with ID ${jobId} not found`);
      }
      const task = await this.genAIRepository.getTaskDataByJobId(
        jobId,
        session,
      );
      if (!task) {
        throw new NotFoundError(`Task data for job ID ${jobId} not found`);
      }
      const jobState = new JobState();
      if (
        !(
          job.jobStatus.audioExtraction === TaskStatus.PENDING ||
          job.jobStatus.audioExtraction === TaskStatus.RUNNING
        )
      ) {
        jobState.currentTask = TaskType.AUDIO_EXTRACTION;
        // AUDIO_EXTRACTION has no earlier stage to defer to — a fresh job's
        // audioExtraction defaults to WAITING (see JobStatus's constructor),
        // so nulling currentTask here meant no fresh job's first stage could
        // ever be approved via approveTaskToStart, with or without a working
        // AI server. Confirmed live: a brand-new job (nothing pre-provided)
        // always hit this and got a null currentTask.
        // if (job.jobStatus.audioExtraction === TaskStatus.WAITING)
        //   jobState.currentTask = null;
        jobState.taskStatus = job.jobStatus.audioExtraction;
        jobState.url = job.url;
      }
      if (
        !(
          job.jobStatus.transcriptGeneration === TaskStatus.PENDING ||
          job.jobStatus.transcriptGeneration === TaskStatus.RUNNING
        )
      ) {
        jobState.currentTask = TaskType.TRANSCRIPT_GENERATION;
        // Same bug as AUDIO_EXTRACTION above, not actually "correct as-is"
        // like the old comment here claimed — approveTaskContinue sets a
        // stage's status to WAITING specifically to mean "prior stage just
        // completed, this one is now ready to approve," so deferring
        // currentTask back to the PRIOR stage here means approveTaskToStart
        // silently re-runs the prior (already-completed) stage instead of
        // starting this one. Confirmed live: with transcriptGeneration
        // WAITING (freshly set by approveTaskContinue) and audioExtraction
        // COMPLETED, calling approve/start re-triggered AUDIO_EXTRACTION's
        // fallback again instead of starting transcription.
        // if (job.jobStatus.transcriptGeneration === TaskStatus.WAITING)
        //   jobState.currentTask = TaskType.AUDIO_EXTRACTION;
        jobState.taskStatus = job.jobStatus.transcriptGeneration;
        jobState.parameters = job.transcriptParameters;
        if (task.audioExtraction)
          jobState.file =
            task.audioExtraction[
              usePrevious ? usePrevious : task.audioExtraction.length - 1
            ]?.fileUrl;
      }
      if (
        !(
          job.jobStatus.segmentation === TaskStatus.PENDING ||
          job.jobStatus.segmentation === TaskStatus.RUNNING
        )
      ) {
        jobState.currentTask = TaskType.SEGMENTATION;
        // Same fix as TRANSCRIPT_GENERATION above — see that block's comment.
        // if (job.jobStatus.segmentation === TaskStatus.WAITING)
        //   jobState.currentTask = TaskType.TRANSCRIPT_GENERATION;
        jobState.taskStatus = job.jobStatus.segmentation;
        jobState.parameters = job.segmentationParameters;
        jobState.file =
          task.transcriptGeneration[
            usePrevious ? usePrevious : task.transcriptGeneration.length - 1
          ]?.fileUrl;
      }
      if (
        !(
          job.jobStatus.questionGeneration === TaskStatus.PENDING ||
          job.jobStatus.questionGeneration === TaskStatus.RUNNING
        )
      ) {
        jobState.currentTask = TaskType.QUESTION_GENERATION;
        // Same fix as TRANSCRIPT_GENERATION above — see that block's comment.
        // if (job.jobStatus.questionGeneration === TaskStatus.WAITING)
        //   jobState.currentTask = TaskType.SEGMENTATION;
        jobState.taskStatus = job.jobStatus.questionGeneration;
        jobState.parameters = job.questionGenerationParameters;
        jobState.file =
          task.segmentation[
            usePrevious ? usePrevious : task.segmentation.length - 1
          ]?.transcriptFileUrl;
        jobState.segmentMap =
          task.segmentation[
            usePrevious ? usePrevious : task.segmentation.length - 1
          ]?.segmentationMap;

        // questionsPerQuiz is a per-section count the caller sets once for the
        // whole job (see UploadParameters.questionsPerQuiz); SOL is the local
        // fallback's total-questions-for-the-whole-job knob (see
        // LocalQuestionGenerationService.generateItems). Multiplying by the
        // segment count here is what makes "3 questions per section" actually
        // generate 3 per section instead of leaving SOL undefined and
        // collapsing to 1 per segment -- this also reaches the real AI server,
        // since jobState.parameters is what gets forwarded to it too.
        const perQuiz = job.uploadParameters?.questionsPerQuiz;
        if (perQuiz && jobState.segmentMap?.length) {
          jobState.parameters = {
            ...job.questionGenerationParameters,
            SOL: perQuiz * jobState.segmentMap.length,
          };
        }
      }
      if (
        job.jobStatus.audioExtraction === TaskStatus.COMPLETED &&
        job.jobStatus.transcriptGeneration === TaskStatus.COMPLETED &&
        job.jobStatus.segmentation === TaskStatus.COMPLETED &&
        job.jobStatus.questionGeneration === TaskStatus.COMPLETED &&
        job.jobStatus.uploadContent !== TaskStatus.PENDING
      ) {
        jobState.currentTask = TaskType.UPLOAD_CONTENT;
        jobState.taskStatus = job.jobStatus.uploadContent;
        jobState.parameters = job.uploadParameters;
        jobState.file =
          task.questionGeneration[
            usePrevious ? usePrevious : task.questionGeneration.length - 1
          ]?.fileUrl;
        jobState.segmentMap =
          task.questionGeneration[
            usePrevious ? usePrevious : task.questionGeneration.length - 1
          ]?.segmentMapUsed;
      }
      if (
        jobState.currentTask !== TaskType.AUDIO_EXTRACTION &&
        jobState.currentTask
      ) {
        if (!(jobState.file || jobState.segmentMap)) {
          throw new BadRequestError(
            `No file URL found for the current task: ${jobState.currentTask}`,
          );
        }
      }
      return jobState;
    });
  }

  secondsToTimeString(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    // Format with leading zeros and 3 decimal places for seconds
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      secs.toFixed(3).padStart(6, '0'),
    ].join(':');
  }

  async uploadContent(jobId: string, jobState: JobState): Promise<any> {
    // Idempotency guard: approveTaskToStart calls this any time
    // jobStatus.uploadContent isn't COMPLETED (see getJobState), which
    // includes WAITING -- confirmed live: item creation below goes through
    // ItemService's own separate transaction per item, so those commits
    // survive even when this method's own transaction never reaches its
    // final commit (e.g. the process is killed mid-request). That left
    // jobStatus.uploadContent stuck at WAITING with the items already
    // created, and every retry re-ran the whole loop, duplicating every
    // video/quiz item. Marking RUNNING immediately, outside the main
    // transaction, closes that window for ordinary retries.
    // ponytail: doesn't make item creation itself atomic with the status
    // write (would need ItemService.createItem to join this transaction),
    // so a run that crashes mid-loop still leaves partial items with status
    // stuck at RUNNING -- recoverable via rerunTask (see its explicit
    // RUNNING carve-out for UPLOAD_CONTENT below), not automatically.
    await this._withTransaction(async session => {
      const preCheck = await this.genAIRepository.getById(jobId, session);
      if (preCheck?.jobStatus?.uploadContent === TaskStatus.RUNNING) {
        throw new BadRequestError(
          `Upload content for job ID ${jobId} is already in progress. If it appears stuck, use rerunTask to force a retry.`,
        );
      }
      preCheck.jobStatus.uploadContent = TaskStatus.RUNNING;
      await this.genAIRepository.update(jobId, preCheck, session);
    });
    // Deliberately NOT one big transaction around the whole loop below.
    // Every module/section/item/question-bank create already runs its own
    // independent transaction (see comment above), so the outer transaction
    // bought no atomicity for any of that -- it only held a MongoDB session
    // open for the entire loop's duration (minutes, for a multi-segment
    // video: confirmed live, a 13-section upload sat with the outer
    // transaction open for over 50 minutes without completing or erroring).
    // MongoDB aborts transactions past transactionLifetimeLimitSeconds
    // (60s default) server-side; whether that produces a driver-visible
    // retry or a silently-hung session on a dead transaction, wrapping ~150
    // sequential network round-trips in one transaction was never going to
    // finish reliably. The only two things that actually need atomicity are
    // the setup read and the final status write, both bookended in their
    // own short transactions below, matching the RUNNING-guard above.
    const jobData = await this.genAIRepository.getById(jobId);
    {
      const normalizeBloomLevel = (input: unknown): BloomLevelKey => {
        if (typeof input === 'number') {
          if (input === 1) return 'knowledge';
          if (input === 2) return 'understanding';
          if (input === 3) return 'application';
          if (input === 4) return 'analysis';
          if (input === 5) return 'evaluation';
          if (input === 6) return 'creation';
          return 'unclassified';
        }

        const normalized = String(input || '')
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '');

        if (
          normalized === 'knowledge' ||
          normalized === 'remember' ||
          normalized === 'remembering' ||
          normalized === 'recall' ||
          normalized === '1' ||
          normalized === 'l1' ||
          normalized === 'level1'
        ) {
          return 'knowledge';
        }

        if (
          normalized === 'understanding' ||
          normalized === 'understand' ||
          normalized === 'comprehension' ||
          normalized === '2' ||
          normalized === 'l2' ||
          normalized === 'level2'
        ) {
          return 'understanding';
        }

        if (
          normalized === 'application' ||
          normalized === 'apply' ||
          normalized === '3' ||
          normalized === 'l3' ||
          normalized === 'level3'
        ) {
          return 'application';
        }

        if (
          normalized === 'analysis' ||
          normalized === 'analyze' ||
          normalized === 'analytical' ||
          normalized === '4' ||
          normalized === 'l4' ||
          normalized === 'level4'
        ) {
          return 'analysis';
        }

        if (
          normalized === 'evaluation' ||
          normalized === 'evaluate' ||
          normalized === '5' ||
          normalized === 'l5' ||
          normalized === 'level5'
        ) {
          return 'evaluation';
        }

        if (
          normalized === 'creation' ||
          normalized === 'create' ||
          normalized === 'synthesis' ||
          normalized === '6' ||
          normalized === 'l6' ||
          normalized === 'level6'
        ) {
          return 'creation';
        }

        return 'unclassified';
      };
      const extractBloomLevel = (question: any): BloomLevelKey => {
        const candidates: unknown[] = [
          question?.bloomLevel,
          question?.question?.bloomLevel,
          question?.level,
          question?.question?.level,
          question?.bloom,
          question?.question?.bloom,
          question?.taxonomy?.bloomLevel,
          question?.metadata?.bloomLevel,
          question?.question?.metadata?.bloomLevel,
        ];

        for (const candidate of candidates) {
          if (candidate && typeof candidate === 'object') {
            const objectLevel = normalizeBloomLevel(
              (candidate as any).level ?? (candidate as any).name,
            );
            if (objectLevel !== 'unclassified') {
              return objectLevel;
            }
          }

          const level = normalizeBloomLevel(candidate);
          if (level !== 'unclassified') {
            return level;
          }
        }

        return 'unclassified';
      };

      const allocateBloomCountsForAttempt = (
        bankQuestionCounts: Array<{ bloomLevel: BloomLevelKey; availableCount: number }>,
        distribution?: {
          knowledge: number;
          understanding: number;
          application: number;
          analysis?: number;
          evaluation?: number;
          creation?: number;
        },
      ): Record<BloomLevelKey, number> => {
        const allocations: Record<BloomLevelKey, number> = {
          knowledge: 0,
          understanding: 0,
          application: 0,
          analysis: 0,
          evaluation: 0,
          creation: 0,
          unclassified: 0,
        };

        const eligibleBanks = bankQuestionCounts.filter(bank => bank.availableCount > 0);
        if (!eligibleBanks.length) {
          return allocations;
        }

        const percentageByBloom: Record<BloomLevelKey, number> = {
          knowledge: distribution?.knowledge ?? 0,
          understanding: distribution?.understanding ?? 0,
          application: distribution?.application ?? 0,
          analysis: distribution?.analysis ?? 0,
          evaluation: distribution?.evaluation ?? 0,
          creation: distribution?.creation ?? 0,
          unclassified: 0,
        };

        const totalVisibleQuestions = eligibleBanks.reduce(
          (sum, bank) => sum + bank.availableCount,
          0,
        );
        const activeTotalPercentage = eligibleBanks.reduce(
          (sum, bank) => sum + (percentageByBloom[bank.bloomLevel] || 0),
          0,
        );

        const weighted = eligibleBanks.map(bank => {
          const percentage = activeTotalPercentage > 0
            ? (percentageByBloom[bank.bloomLevel] || 0) / activeTotalPercentage
            : 1 / eligibleBanks.length;
          const expected = totalVisibleQuestions * percentage;
          const base = Math.min(bank.availableCount, Math.floor(expected));
          return {
            bloomLevel: bank.bloomLevel,
            availableCount: bank.availableCount,
            allocated: base,
            remainder: expected - Math.floor(expected),
          };
        });

        let remaining = totalVisibleQuestions - weighted.reduce((sum, bank) => sum + bank.allocated, 0);

        weighted
          .slice()
          .sort((left, right) => right.remainder - left.remainder)
          .forEach(bank => {
            if (remaining <= 0) return;
            if (bank.allocated >= bank.availableCount) return;
            bank.allocated += 1;
            remaining -= 1;
          });

        if (remaining > 0) {
          weighted.forEach(bank => {
            while (remaining > 0 && bank.allocated < bank.availableCount) {
              bank.allocated += 1;
              remaining -= 1;
            }
          });
        }

        weighted.forEach(bank => {
          allocations[bank.bloomLevel] = bank.allocated;
        });

        return allocations;
      };

      try {
        if (!jobData) {
          throw new NotFoundError(`Job with ID ${jobId} not found`);
        }
        let allQuestionsData: any[] = [];
        const uploadParams =
          (jobState.parameters as UploadParameters) ?? jobData.uploadParameters;
        // Alias, not copy: jobData is written back wholesale on both the
        // success and failure paths below. Without this, those writes use
        // whatever jobData.uploadParameters was at the top of this
        // function -- before the course/module auto-create blocks below
        // ever ran -- and silently clobber the courseId/versionId/moduleId
        // those blocks just persisted back to the DB (confirmed live: the
        // course got created correctly, but the job's own record of its ID
        // was overwritten back to null by this method's own completion
        // write).
        jobData.uploadParameters = uploadParams;
        const curatedQuestions = uploadParams?.questions;

        // Prefer curated questions from the upload payload when provided.
        if (Array.isArray(curatedQuestions) && curatedQuestions.length > 0) {
          allQuestionsData = curatedQuestions;
        } else {
          // Fallback to generated questions file when no curated payload is provided.
          try {
            const agent =
              appConfig.isProduction || appConfig.isStaging
                ? new SocksProxyAgent(aiConfig.proxyAddress)
                : undefined;

            const axiosOptions = {
              httpAgent: agent,
              httpsAgent: agent,
            };

            // Confirmed live on Render (NODE_ENV=staging, no Tailscale/SOCKS
            // proxy running there): this URL is always a plain public GCS
            // link, whether from the real AI server or the local fallback --
            // routing it through the proxy unconditionally in
            // production/staging fails outright wherever that proxy isn't
            // actually running. Falls back to a direct request rather than
            // changing the production/staging path itself, since it's not
            // clear from this code alone why the proxy was required there in
            // the first place (network egress restriction? IP allowlisting
            // on the bucket?) -- this only kicks in when the proxied attempt
            // fails, so real production behavior is unchanged if it was
            // relying on that.
            let response;
            try {
              response = await axios.get(jobState.file, axiosOptions);
            } catch (proxyError) {
              if (!agent) throw proxyError;
              response = await axios.get(jobState.file);
            }
            if (response.data) {
              allQuestionsData = response.data;
            } else {
              throw new Error(
                'JSON file must contain segmentsMap and questionsData',
              );
            }
          } catch (error) {
            throw new Error(
              `Failed to fetch or parse questions file from URL: ${jobState.file}. Error: ${error}`,
            );
          }
        }
        const questionsGroupedBySegment: Record<string, any[]> = {};
        if (Array.isArray(allQuestionsData)) {
          for (const question of allQuestionsData) {
            const segId = (question as any).segmentId;
            if (!questionsGroupedBySegment[segId]) {
              questionsGroupedBySegment[segId] = [];
            }
            questionsGroupedBySegment[segId].push(question);
          }
        }

        // Prepare tracking arrays
        const createdVideoItemsInfo: Array<{
          id?: string;
          name: string;
          segmentId: string;
          startTime: string;
          endTime: string;
          points: number;
        }> = [];
        const createdQuizItemsInfo: Array<{
          id?: string;
          name: string;
          segmentId: string;
          questionCount: number;
        }> = [];
        const createdQuestionBanksInfo: Array<{
          id: string;
          name: string;
          segmentId: string;
          bloomLevel: string;
          questionCount: number;
          questionIds: string[];
        }> = [];

        let previousSegmentEndTime = 0.0;

        // Auto-create mode: jobData.coursePlan (see GenAIController's
        // course-plan endpoints) means the user approved an AI-generated
        // module + one section per segment, instead of uploading into a
        // pre-existing section. Falls back to the original
        // moduleId/sectionId-from-uploadParameters behavior when no plan is
        // attached, so AISectionPage/AiWorkflow's existing pre-existing-section
        // flow is untouched.
        const coursePlan = jobData.coursePlan;
        // courseId/versionId are meant to travel together (one identifies
        // a course, the other a specific version of it) -- supplying only
        // one is always a mistake, never a valid "auto-create just the
        // missing half" request, since a version can't be auto-created
        // into an arbitrary existing course without knowing which module/
        // section structure it should match. Catch that here rather than
        // silently falling through to the auto-create branch below, which
        // would otherwise create a whole new, unrelated course and quietly
        // discard the one ID the caller did supply.
        if (
          (uploadParams.courseId && !uploadParams.versionId) ||
          (!uploadParams.courseId && uploadParams.versionId)
        ) {
          throw new BadRequestError(
            'courseId and versionId must be provided together, or both left empty to auto-create a new course.',
          );
        }
        // Same deferred-creation idea as the module block below, one level
        // up: a job started from just a YouTube URL (no pre-existing
        // course) carries a proposed courseName/versionName in coursePlan
        // (see getCoursePlan's course-level self-heal); the real Course +
        // CourseVersion only get created here, on approval.
        if (coursePlan && (!uploadParams.courseId || !uploadParams.versionId)) {
          try {
            const course = new Course({
              name: coursePlan.courseName || coursePlan.moduleName,
              description: coursePlan.courseDescription || coursePlan.moduleDescription || '',
            } as CourseBody);
            const createdCourse = await this.courseService.createCourse(
              course,
              coursePlan.versionName || 'v1',
              coursePlan.courseDescription || '',
              jobData.userId.toString(),
              [],
              false,
              0,
            );
            uploadParams.courseId = createdCourse._id.toString();
            uploadParams.versionId = createdCourse.versions.at(-1).toString();
          } catch (err) {
            throw new BadRequestError(
              `Could not auto-create course "${coursePlan.courseName}": ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // Idempotency: persist immediately, same reasoning as the
          // RUNNING-guard write at the top of this method -- without this, a
          // rerunTask retry after a mid-loop crash would see no courseId in
          // job.uploadParameters and create a second course.
          await this._withTransaction(session =>
            this.genAIRepository.update(
              jobId,
              { uploadParameters: { ...uploadParams } },
              session,
            ),
          );
        }

        let moduleIdForUpload = (jobState.parameters as UploadParameters).moduleId;
        if (coursePlan && !moduleIdForUpload) {
          try {
            const moduleBody = new CreateModuleBody();
            moduleBody.name = coursePlan.moduleName;
            moduleBody.description = coursePlan.moduleDescription || 'Auto-generated module.';
            const versionAfterModule = await this.moduleService.createModule(
              (jobState.parameters as UploadParameters).versionId,
              moduleBody,
            );
            const newModule = versionAfterModule.modules
              .filter(m => !m.isDeleted)
              .at(-1);
            moduleIdForUpload = newModule.moduleId.toString();
          } catch (err) {
            throw new BadRequestError(
              `Could not auto-create module "${coursePlan.moduleName}": ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // Mutate the canonical object (not just the DB write below) --
          // uploadParams is what the completion write at the end of this
          // method persists via its jobData alias, so without this the
          // intermediate write here would get clobbered right back to null
          // the same way courseId/versionId were before that alias fix.
          uploadParams.moduleId = moduleIdForUpload;
          // Idempotency, same as the course block above -- a pre-existing
          // gap this closes: without persisting moduleId back, a retry
          // after a mid-loop crash would create a second module too.
          await this._withTransaction(session =>
            this.genAIRepository.update(
              jobId,
              { uploadParameters: { ...uploadParams } },
              session,
            ),
          );
        }

        for (const currentSegmentId of jobState.segmentMap) {
          const segmentStartTime = previousSegmentEndTime;
          const currentSegmentEndTime = currentSegmentId;

          // In auto-create mode, each segment gets its own new section --
          // created here, immediately before its items, because
          // SectionService.createSection refuses to create a new section
          // while the previous one is still empty of items.
          let sectionIdForSegment = (jobState.parameters as UploadParameters).sectionId;
          const planEntry = coursePlan?.sections.find(s => s.segmentEnd === currentSegmentId);
          if (coursePlan) {
            const sectionName = planEntry?.name ?? `Section ${createdVideoItemsInfo.length + 1}`;
            try {
              const sectionBody = new CreateSectionBody();
              sectionBody.name = sectionName;
              sectionBody.description = planEntry?.description || 'Auto-generated section.';
              const versionAfterSection = await this.sectionService.createSection(
                (jobState.parameters as UploadParameters).versionId,
                moduleIdForUpload,
                sectionBody,
              );
              const moduleAfterSection = versionAfterSection.modules.find(
                m => m.moduleId.toString() === moduleIdForUpload,
              );
              const newSection = moduleAfterSection.sections
                .filter(s => !s.isDeleted)
                .at(-1);
              sectionIdForSegment = newSection.sectionId.toString();
            } catch (err) {
              throw new BadRequestError(
                `Could not auto-create section "${sectionName}": ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          // Create Video Item for the segment
          const videoSegName = planEntry?.name
            ?? (jobData.uploadParameters.videoItemBaseName
              ? jobData.uploadParameters.videoItemBaseName
              : `Video`);

          // An uploaded video's playback URL is a time-boxed grant (see
          // VideoAssetController.getPlaybackUrl) -- baking one into the item
          // would go stale. Uploaded videos are referenced by assetId
          // instead, the same way the course-video-library flow already
          // does it (VideoDetailsPayloadValidator), and a fresh grant is
          // resolved at watch-time.
          const videoItemBody: CreateItemBody = {
            name: videoSegName,
            description: planEntry?.description || `Video content`,
            type: ItemType.VIDEO,
            videoDetails: jobData.videoAssetId
              ? {
                  source: 'GCS',
                  assetId: jobData.videoAssetId,
                  startTime: this.secondsToTimeString(segmentStartTime),
                  endTime: this.secondsToTimeString(currentSegmentEndTime),
                  points: 10,
                }
              : {
                  URL: jobData.url,
                  startTime: this.secondsToTimeString(segmentStartTime),
                  endTime: this.secondsToTimeString(currentSegmentEndTime),
                  points: 10,
                },
          };
          const createdVideoItem = await this.itemService.createItem(
            (jobState.parameters as UploadParameters).versionId,
            moduleIdForUpload,
            sectionIdForSegment,
            videoItemBody,
          );
          createdVideoItemsInfo.push({
            id: createdVideoItem.createdItem?._id?.toString(),
            name: videoSegName,
            segmentId: String(currentSegmentId),
            startTime: this.secondsToTimeString(segmentStartTime),
            endTime: this.secondsToTimeString(currentSegmentEndTime),
            points: 10,
          });

          // Create Question Bank and Questions for the segment
          const questionsForSegment =
            questionsGroupedBySegment[currentSegmentId] || [];
          if (questionsForSegment.length > 0) {
            // Always enable Smart Bloom mode if flag is set, regardless of Bloom level tags
            const isSmartBloom = !!(
              jobData.questionGenerationParameters?.smartBloom?.enabled ||
              uploadParams?.smartBloomEnabled
            );

            if (isSmartBloom) {
              // Initialize bloom level buckets
              const questionsGroupedByBloom: Record<BloomLevelKey, any[]> = {
                knowledge: [],
                understanding: [],
                application: [],
                analysis: [],
                evaluation: [],
                creation: [],
                unclassified: [],
              };

              // First pass: group by existing Bloom levels
              for (const question of questionsForSegment) {
                const bloomLevel = extractBloomLevel(question);
                questionsGroupedByBloom[bloomLevel].push(question);
              }

              // Second pass: redistribute unclassified questions across all Bloom levels
              // using weighted distribution to match instructor's intended Bloom percentages
              if (questionsGroupedByBloom.unclassified.length > 0) {
                const bloomDistribution = jobData.questionGenerationParameters?.smartBloom?.distribution || {
                  knowledge: 40,
                  understanding: 35,
                  application: 25,
                  analysis: 0,
                  evaluation: 0,
                  creation: 0,
                };

                // Calculate total distribution percentage
                const totalDistPercent = Object.values(bloomDistribution).reduce((sum, pct) => sum + pct, 0);
                const bloomLevels: BloomLevelKey[] = ['knowledge', 'understanding', 'application', 'analysis', 'evaluation', 'creation'];

                // Distribute unclassified questions based on the distribution percentages
                const unclassifiedQuestions = questionsGroupedByBloom.unclassified;
                let qIndex = 0;

                for (const bloomLevel of bloomLevels) {
                  const distribution = bloomDistribution[bloomLevel] || 0;
                  if (distribution === 0) continue;

                  // Calculate how many unclassified questions should go to this level
                  const proportion = distribution / totalDistPercent;
                  const countForThisLevel = Math.round(proportion * unclassifiedQuestions.length);

                  for (let i = 0; i < countForThisLevel && qIndex < unclassifiedQuestions.length; i++) {
                    questionsGroupedByBloom[bloomLevel].push(unclassifiedQuestions[qIndex]);
                    qIndex++;
                  }
                }

                // Assign remaining questions using round-robin as fallback
                if (qIndex < unclassifiedQuestions.length) {
                  let fallbackIndex = 0;
                  for (; qIndex < unclassifiedQuestions.length; qIndex++) {
                    const assignedBloom = bloomLevels[fallbackIndex % bloomLevels.length];
                    questionsGroupedByBloom[assignedBloom].push(unclassifiedQuestions[qIndex]);
                    fallbackIndex++;
                  }
                }

                questionsGroupedByBloom.unclassified = [];
              }

              const segmentQuestionBanks: Array<{
                id: string;
                bloomLevel: BloomLevelKey;
                questionCount: number;
              }> = [];
              let totalQuestionsForSegment = 0;

              // Create a Question Bank for EVERY Bloom level (including empty ones for consistency)
              const allBloomLevels: BloomLevelKey[] = [
                'knowledge',
                'understanding',
                'application',
                'analysis',
                'evaluation',
                'creation',
              ];

              for (const bloomLevel of allBloomLevels) {
                const bloomQuestions = questionsGroupedByBloom[bloomLevel] || [];
                const questionBankName = `Question Bank - Segment (${segmentStartTime} - ${currentSegmentEndTime}) - ${bloomLevel.toUpperCase()}`;
                const questionBank = new QuestionBank({
                  title: questionBankName,
                  description: `Question bank for video segment from ${segmentStartTime} to ${currentSegmentEndTime} (Bloom: ${bloomLevel}).`,
                  courseId: new ObjectId(
                    (jobState.parameters as UploadParameters).courseId,
                  ),
                  courseVersionId: new ObjectId(
                    (jobState.parameters as UploadParameters).versionId,
                  ),
                  questions: [],
                  tags: [
                    `segment_${currentSegmentId}`,
                    `bloom_${bloomLevel}`,
                    'ai_generated',
                  ],
                  points: 5,
                });

                const questionBankId = await this.questionBankService.create(
                  questionBank,
                );

                const createdQuestionIds: string[] = [];
                for (const questionData of bloomQuestions) {
                  try {
                    const hint = questionData?.question?.hint;
                    const MAX_HINT_LENGTH = 80;
                    const safeHint =
                      hint && typeof hint === 'string' && hint.length > MAX_HINT_LENGTH
                        ? hint.substring(0, MAX_HINT_LENGTH - 3) + '...'
                        : hint;

                    const questionnew = QuestionFactory.createQuestion(
                      {
                        question: {
                          ...questionData.question,
                          hint: safeHint,
                          bloomLevel,
                          points: questionData.question.points || 5,
                        },
                        solution: questionData.solution,
                      },
                      jobData.userId.toString(),
                    );

                    const questionId = await this.questionService.create(
                      questionnew,
                    );
                    createdQuestionIds.push(questionId);

                    await this.questionBankService.addQuestion(
                      questionBankId,
                      questionId,
                    );
                  } catch (questionError) {
                    console.warn(
                      `Failed to create question for segment ${currentSegmentId} and bloom ${bloomLevel}:`,
                      questionError,
                    );
                  }
                }

                totalQuestionsForSegment += createdQuestionIds.length;
                segmentQuestionBanks.push({
                  id: questionBankId,
                  bloomLevel,
                  questionCount: createdQuestionIds.length,
                });

                createdQuestionBanksInfo.push({
                  id: questionBankId,
                  name: questionBankName,
                  segmentId: String(currentSegmentId),
                  bloomLevel,
                  questionCount: createdQuestionIds.length,
                  questionIds: createdQuestionIds,
                });
              }

            const quizSegName = planEntry?.name
              ? `${planEntry.name} Quiz`
              : (jobData.uploadParameters.quizItemBaseName
                ? jobData.uploadParameters.quizItemBaseName
                : `Quiz`);

            const quizItemBody: CreateItemBody = {
              name: quizSegName,
              description: `Quiz for video segment from ${segmentStartTime} to ${currentSegmentEndTime}. This quiz's points are based on its questions.`,
              type: ItemType.QUIZ,
              quizDetails: {
                passThreshold: 0.7,
                maxAttempts: (jobState.parameters as UploadParameters).maxAttempts ?? 1000,
                quizType: 'NO_DEADLINE',
                approximateTimeToComplete: '00:05:00',
                allowPartialGrading: true,
                allowSkip: false,
                allowHint: true,
                showCorrectAnswersAfterSubmission: true,
                showExplanationAfterSubmission: true,
                showScoreAfterSubmission: true,
                questionVisibility: totalQuestionsForSegment,
                releaseTime: new Date(),
                deadline: undefined,
              },
            };

            const createdQuizItem = await this.itemService.createItem(
              (jobState.parameters as UploadParameters).versionId,
              moduleIdForUpload,
              sectionIdForSegment,
              quizItemBody,
            );

            // Link each Bloom-specific QuestionBank to the Quiz
            const quizId = createdQuizItem.createdItem?._id?.toString();
            if (quizId) {
              const bloomCountsForAttempt = allocateBloomCountsForAttempt(
                segmentQuestionBanks.map(bank => ({
                  bloomLevel: bank.bloomLevel,
                  availableCount: bank.questionCount,
                })),
                jobData.questionGenerationParameters?.smartBloom?.distribution,
              );

              for (const bank of segmentQuestionBanks) {
                try {
                  await this.quizService.addQuestionBank(quizId, {
                    bankId: bank.id,
                    count: bloomCountsForAttempt[bank.bloomLevel],
                    tags: [`bloom_${bank.bloomLevel}`, 'ai_generated'],
                  });
                } catch (linkError) {
                  console.warn(
                    `Failed to link question bank ${bank.id} to quiz ${quizId}:`,
                    linkError,
                  );
                }
              }
            }

            createdQuizItemsInfo.push({
              id: createdQuizItem.createdItem?._id?.toString(),
              name: quizSegName,
              segmentId: String(currentSegmentId),
              questionCount: totalQuestionsForSegment,
            });
            } else {
              // Original single-bank path (AiWorkflow and other non-SmartBloom workflows)
              const legacyBankName = `Question Bank - Segment (${segmentStartTime} - ${currentSegmentEndTime})`;
              const legacyQuestionBank = new QuestionBank({
                title: legacyBankName,
                description: `Question bank for video segment from ${segmentStartTime} to ${currentSegmentEndTime}.`,
                courseId: new ObjectId(
                  (jobState.parameters as UploadParameters).courseId,
                ),
                courseVersionId: new ObjectId(
                  (jobState.parameters as UploadParameters).versionId,
                ),
                questions: [],
                tags: [`segment_${currentSegmentId}`, 'ai_generated'],
                points: 5,
              });

              const legacyBankId = await this.questionBankService.create(
                legacyQuestionBank,
              );

              const legacyQuestionIds: string[] = [];
              for (const questionData of questionsForSegment) {
                try {
                  const hint = questionData?.question?.hint;
                  const MAX_HINT_LENGTH = 80;
                  const safeHint =
                    hint &&
                    typeof hint === 'string' &&
                    hint.length > MAX_HINT_LENGTH
                      ? hint.substring(0, MAX_HINT_LENGTH - 3) + '...'
                      : hint;

                  const legacyQuestion = QuestionFactory.createQuestion(
                    {
                      question: {
                        ...questionData.question,
                        hint: safeHint,
                        points: questionData.question.points || 5,
                      },
                      solution: questionData.solution,
                    },
                    jobData.userId.toString(),
                  );

                  const questionId = await this.questionService.create(
                    legacyQuestion,
                  );
                  legacyQuestionIds.push(questionId);

                  await this.questionBankService.addQuestion(
                    legacyBankId,
                    questionId,
                  );
                } catch (questionError) {
                  console.warn(
                    `Failed to create question for segment ${currentSegmentId}:`,
                    questionError,
                  );
                }
              }

              const legacyQuizName = planEntry?.name
                ? `${planEntry.name} Quiz`
                : (jobData.uploadParameters.quizItemBaseName
                  ? jobData.uploadParameters.quizItemBaseName
                  : `Quiz`);

              const legacyQuizItemBody: CreateItemBody = {
                name: legacyQuizName,
                description: `Quiz for video segment from ${segmentStartTime} to ${currentSegmentEndTime}. This quiz's points are based on its questions.`,
                type: ItemType.QUIZ,
                quizDetails: {
                  passThreshold: 0.7,
                  maxAttempts: (jobState.parameters as UploadParameters).maxAttempts ?? 1000,
                  quizType: 'NO_DEADLINE',
                  approximateTimeToComplete: '00:05:00',
                  allowPartialGrading: true,
                  allowSkip: false,
                  allowHint: true,
                  showCorrectAnswersAfterSubmission: true,
                  showExplanationAfterSubmission: true,
                  showScoreAfterSubmission: true,
                  questionVisibility: legacyQuestionIds.length,
                  releaseTime: new Date(),
                  deadline: undefined,
                },
              };

              const legacyQuizItem = await this.itemService.createItem(
                (jobState.parameters as UploadParameters).versionId,
                moduleIdForUpload,
                sectionIdForSegment,
                legacyQuizItemBody,
              );

              const legacyQuizId = legacyQuizItem.createdItem?._id?.toString();
              if (legacyQuizId) {
                await this.quizService.addQuestionBank(legacyQuizId, {
                  bankId: legacyBankId,
                  count: jobData.uploadParameters.questionsPerQuiz ?? 2,
                  tags: ['AI Generated'],
                });
              }

              createdQuestionBanksInfo.push({
                id: legacyBankId,
                name: legacyBankName,
                segmentId: String(currentSegmentId),
                bloomLevel: 'n/a',
                questionCount: legacyQuestionIds.length,
                questionIds: legacyQuestionIds,
              });

              createdQuizItemsInfo.push({
                id: legacyQuizItem.createdItem?._id?.toString(),
                name: legacyQuizName,
                segmentId: String(currentSegmentId),
                questionCount: legacyQuestionIds.length,
              });
            }
          }

          previousSegmentEndTime = currentSegmentEndTime;
        }
        jobData.jobStatus.uploadContent = TaskStatus.COMPLETED;
        await this._withTransaction(async session => {
          const taskDAta = await this.genAIRepository.getTaskDataByJobId(
            jobId,
            session,
          );
          if (!taskDAta.uploadContent) {
            taskDAta.uploadContent = [{ status: TaskStatus.COMPLETED }];
          }
          taskDAta.uploadContent.push({
            status: TaskStatus.COMPLETED,
          });
          await this.genAIRepository.updateTaskData(jobId, taskDAta, session);
          await this.genAIRepository.update(jobId, jobData, session);
        });
        return {
          message:
            'Video items, Quiz items, and Question banks for segments generated successfully from video.',
          videoURL: jobData.url,
          generatedItemsSummary: {
            totalSegmentsProcessed: jobState.segmentMap.length,
            totalVideoItemsCreated: createdVideoItemsInfo.length,
            totalQuizItemsCreated: createdQuizItemsInfo.length,
            totalQuestionBanksCreated: createdQuestionBanksInfo.length,
            totalQuestionsGenerated: createdQuestionBanksInfo.reduce(
              (sum, bank) => sum + bank.questionCount,
              0,
            ),
          },
          createdVideoItems: createdVideoItemsInfo,
          createdQuizItems: createdQuizItemsInfo,
          createdQuestionBanks: createdQuestionBanksInfo,
        };
      } catch (error) {
        jobData.jobStatus.uploadContent = TaskStatus.FAILED;
        await this._withTransaction(async session => {
          await this.genAIRepository.update(jobId, jobData, session);
          const taskDAta = await this.genAIRepository.getTaskDataByJobId(
            jobId,
            session,
          );
          if (!taskDAta) {
            throw new NotFoundError(`Task data for job ID ${jobId} not found`);
          }
          if (!taskDAta.uploadContent) {
            taskDAta.uploadContent = [
              { status: TaskStatus.FAILED, error: error.message },
            ];
          }
          taskDAta.uploadContent.push({
            status: TaskStatus.FAILED,
            error: error.message,
          });
          await this.genAIRepository.updateTaskData(jobId, taskDAta, session);
        });
        console.error(`Error during content upload for job ${jobId}:`, error);
        throw new InternalServerError(
          `Failed to upload content for job ${jobId}: ${error.message}`,
        );
      }
    }
  }
}
