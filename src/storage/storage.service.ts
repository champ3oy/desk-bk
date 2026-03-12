import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.getOrThrow('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
    this.baseUrl = this.configService.getOrThrow('AWS_S3_PUBLIC_BASE_URL');
  }

  async saveFile(
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ path: string; filename: string; size: number }> {
    const ext = path.extname(filename);
    const key = `uploads/${uuidv4()}${ext}`;

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    };

    try {
      this.logger.log(`Uploading file to S3: ${filename} → ${key}`);
      await this.s3.send(new PutObjectCommand(params));

      const publicUrl = `${this.baseUrl.replace(/\/$/, '')}/${key}`;
      this.logger.log(`File uploaded successfully: ${publicUrl}`);

      return {
        path: publicUrl,
        filename: key,
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${error.message}`);
      throw error;
    }
  }
}
