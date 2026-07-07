import axios from 'axios';
import FormData from 'form-data';

export class TelegramStorageService {
  private botToken: string;
  private channelId: string;
  private apiBaseUrl: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.channelId = process.env.TELEGRAM_CHANNEL_ID || '';
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;

    if (!this.botToken || !this.channelId) {
      throw new Error('Missing core Telegram credentials in backend configurations!');
    }
  }

  /**
   * Uploads a raw binary segment buffer straight into your private storage layer
   */
  async uploadChunk(chunkBuffer: Buffer, chunkName: string): Promise<string> {
    try {
      const form = new FormData();
      form.append('chat_id', this.channelId);
      form.append('document', chunkBuffer, { filename: chunkName });

      const response = await axios.post(`${this.apiBaseUrl}/sendDocument`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (!response.data.ok) {
        throw new Error(`Telegram rejected asset push: ${response.data.description}`);
      }

      // Extract the permanent unique global file_id resource string
      return response.data.result.document.file_id;
    } catch (error) {
      console.error('Failed processing chunk upload to Telegram storage:', error);
      throw error;
    }
  }

  /**
   * Resolves a target asset pointer and pipes its raw data straight back down to the pipeline request
   */
  async getChunkStream(fileId: string): Promise<Buffer> {
    try {
      // Step A: Request the temporary direct absolute download path from Telegram
      const fileMetadata = await axios.get(`${this.apiBaseUrl}/getFile`, {
        params: { file_id: fileId },
      });

      if (!fileMetadata.data.ok) {
        throw new Error('Failed to resolve internal file routing index pointer.');
      }

      const filePath = fileMetadata.data.result.file_path;
      
      // Step B: Download the source data bytes from Telegram's resource cloud
      const downloadResponse = await axios.get(
        `https://api.telegram.org/file/bot${this.botToken}/${filePath}`,
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(downloadResponse.data);
    } catch (error) {
      console.error('Failed fetching data track from asset distribution network:', error);
      throw error;
    }
  }
}