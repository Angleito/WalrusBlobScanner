import { WalrusClient } from '../utils/walrus-client.js';
import { BlobInfo, BlobAnalysis } from '../types/index.js';
import { detectWalrusSite } from './site-detector.js';
import mimeTypes from 'mime-types';

export class BlobReader {
  private walrusClient: WalrusClient;

  constructor(aggregatorUrl?: string) {
    this.walrusClient = new WalrusClient(aggregatorUrl);
  }

  async readBlob(blobId: string): Promise<Buffer> {
    return this.walrusClient.readBlob(blobId);
  }

  async getBlobInfo(blobId: string): Promise<BlobInfo | null> {
    return this.walrusClient.getBlobInfo(blobId);
  }

  async analyzeBlob(blobId: string): Promise<BlobAnalysis> {
    const blobInfo = await this.getBlobInfo(blobId);
    if (!blobInfo) {
      throw new Error(`Blob ${blobId} not found`);
    }

    const content = await this.readBlob(blobId);
    const contentType = this.detectContentType(content, blobInfo.contentType);
    
    const analysis: BlobAnalysis = {
      blobId,
      isWalrusSite: false,
      contentType
    };

    if (this.couldBeWalrusSite(content, contentType)) {
      const siteDetection = await detectWalrusSite(content, blobId);
      analysis.isWalrusSite = siteDetection.isWalrusSite;
      analysis.siteInfo = siteDetection.siteInfo;
      analysis.structure = siteDetection.structure;
    }

    return analysis;
  }

  async analyzeBlobBatch(blobIds: string[]): Promise<BlobAnalysis[]> {
    const results = await Promise.allSettled(
      blobIds.map(blobId => this.analyzeBlob(blobId))
    );

    return results
      .filter((result): result is PromiseFulfilledResult<BlobAnalysis> => 
        result.status === 'fulfilled')
      .map(result => result.value);
  }

  async scanForWalrusSites(limit?: number): Promise<BlobAnalysis[]> {
    const allBlobs = await this.walrusClient.listBlobs();
    const activeBlobs = allBlobs.filter(blob => !blob.isExpired);
    
    const blobsToScan = limit ? activeBlobs.slice(0, limit) : activeBlobs;
    const analyses = await this.analyzeBlobBatch(
      blobsToScan.map(blob => blob.blobId)
    );

    return analyses.filter(analysis => analysis.isWalrusSite);
  }

  private detectContentType(content: Buffer, providedType?: string): string {
    if (providedType && providedType !== 'application/octet-stream') {
      return providedType;
    }

    const signature = content.subarray(0, 16);
    
    if (signature.includes(Buffer.from('<!DOCTYPE html', 'utf8')) || 
        signature.includes(Buffer.from('<html', 'utf8'))) {
      return 'text/html';
    }
    
    if (signature.includes(Buffer.from('PK', 'utf8'))) {
      return 'application/zip';
    }
    
    try {
      JSON.parse(content.toString('utf8'));
      return 'application/json';
    } catch {
      // Not JSON
    }

    if (this.isTextContent(content)) {
      return 'text/plain';
    }

    return 'application/octet-stream';
  }

  private couldBeWalrusSite(content: Buffer, contentType: string): boolean {
    if (contentType === 'application/zip') return true;
    if (contentType === 'text/html') return true;
    if (contentType === 'application/json') return true;
    
    if (this.isTextContent(content)) {
      const text = content.toString('utf8');
      return text.includes('index.html') || 
             text.includes('<!DOCTYPE html') ||
             text.includes('<html');
    }

    return false;
  }

  private isTextContent(content: Buffer): boolean {
    const sample = content.subarray(0, 1024);
    const nonTextBytes = sample.filter(byte => 
      byte < 32 && byte !== 9 && byte !== 10 && byte !== 13
    ).length;
    
    return nonTextBytes / sample.length < 0.3;
  }
}