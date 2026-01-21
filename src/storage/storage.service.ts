import { Injectable, Logger } from '@nestjs/common';
import { put } from '@vercel/blob';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async saveFile(
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ path: string; filename: string; size: number }> {
    try {
      this.logger.log(`Uploading file to Vercel Blob: ${filename}`);

      // Upload to Vercel Blob
      const blob = await put(filename, buffer, {
        access: 'public',
        contentType: mimeType,
      });

      this.logger.log(`File uploaded successfully: ${blob.url}`);

      return {
        path: blob.url, // Public URL from Vercel Blob
        filename: filename,
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload file to Vercel Blob: ${error.message}`,
      );
      throw error;
    }
  }
}
