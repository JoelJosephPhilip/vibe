import { injectable } from 'inversify';
import { Storage } from '@google-cloud/storage';
import { InternalServerError } from 'routing-controllers';
import { storageConfig } from '#root/config/storage.js';

@injectable()
export class CloudStorageService {
  private googleStorage: Storage;
  private anomalyBucketName: string;
  private aiServerBucketName: string;

  constructor() {
    this.googleStorage = new Storage({
      projectId: storageConfig.googleCloud.projectId
    });
    this.anomalyBucketName = storageConfig.googleCloud.anomalyBucketName;
    this.aiServerBucketName = storageConfig.googleCloud.aiServerBucketName;
  }

  /**
   * Upload anomaly to cloud storage
   */
  async uploadAnomaly(
    file: Express.Multer.File,
    userId: string,
    anomalyType: string,
    timestamp: Date,
    type: string,
  ): Promise<string> {
    const ext = type.split('/')[1];
    const filename = `${userId}/${anomalyType}/${timestamp.toISOString()}.${ext}`;
    const bucket = this.googleStorage.bucket(this.anomalyBucketName);
    const createdFile = bucket.file(filename);

    // Upload file with metadata
    await createdFile.save(file.buffer, {
      metadata: {
        contentType: 'application/octet-stream',
        anomalyType: anomalyType,
      },
    });

    return filename;
  }

  /**
   * Delete anomaly from cloud storage
   */
  async deleteAnomaly(fileName: string): Promise<void> {
    const bucket = this.googleStorage.bucket(this.anomalyBucketName);
    const file = bucket.file(fileName);

    try {
      await file.delete();
    } catch (error) {
      throw new InternalServerError(`Failed to delete image from cloud storage: ${error.message}`);
    }
  }

  async getSignedUrl(fileName: string): Promise<string> {
    const bucket = this.googleStorage.bucket(this.anomalyBucketName);
    const file = bucket.file(fileName);

    try {
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });
      return url;
    } catch (error) {
      throw new InternalServerError(`Failed to get signed URL: ${error.message}`);
    }
  }

  async uploadAudio(
    audio: Express.Multer.File,
    jobId: string,
  ) {
    const bucket = this.googleStorage.bucket(this.aiServerBucketName);
    const file = bucket.file(`audio/${jobId}.${audio.mimetype.split('/')[1]}`);

    try {
      await file.save(audio.buffer, {
        metadata: {
          contentType: audio.mimetype,
        }
      });
      return file.name;
    } catch (error) {
      throw new InternalServerError(`Failed to upload audio: ${error.message}`);
    }
  }

  /** Lets a caller check for an already-uploaded transcript before doing the
   * work to produce one — see LocalAudioExtractionService's captions
   * fast-path and LocalTranscriptionService's check for it. */
  async transcriptExists(jobId: string): Promise<boolean> {
    const bucket = this.googleStorage.bucket(this.aiServerBucketName);
    const [exists] = await bucket.file(`transcripts/${jobId}.json`).exists();
    return exists;
  }

  async uploadTranscript(
    transcript: object,
    jobId: string,
  ) {
    const bucket = this.googleStorage.bucket(this.aiServerBucketName);
    const file = bucket.file(`transcripts/${jobId}.json`);

    try {
      const jsonString = JSON.stringify(transcript, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');
      
      await file.save(buffer, {
        metadata: {
          contentType: 'application/json',
        }
      });
      return file.name;
    } catch (error) {
      throw new InternalServerError(`Failed to upload transcript: ${error.message}`);
    }
  }

  /** Same pattern as uploadTranscript, separate path — used by the local
   * QUESTION_GENERATION fallback (see LocalQuestionGenerationService). */
  async uploadQuestions(
    questions: object,
    jobId: string,
  ) {
    const bucket = this.googleStorage.bucket(this.aiServerBucketName);
    const file = bucket.file(`questions/${jobId}.json`);

    try {
      const jsonString = JSON.stringify(questions, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');

      await file.save(buffer, {
        metadata: {
          contentType: 'application/json',
        }
      });
      return file.name;
    } catch (error) {
      throw new InternalServerError(`Failed to upload questions: ${error.message}`);
    }
  }
}