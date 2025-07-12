import { BlobInfo, BlobClassification, BlobCategory, BlobImportance } from '../types/index.js';
import { WalrusClient } from '../utils/walrus-client.js';
import { detectWalrusSite } from './site-detector.js';

export class BlobClassifier {
  private walrusClient: WalrusClient;

  constructor(walrusClient: WalrusClient) {
    this.walrusClient = walrusClient;
  }

  async classifyBlob(blob: BlobInfo): Promise<BlobClassification> {
    const category = await this.determineCategory(blob);
    const importance = await this.determineImportance(blob, category);
    const referencedBy = await this.findReferences(blob.blobId);
    const canDelete = this.canSafelyDelete(blob, importance, referencedBy);

    return {
      blobId: blob.blobId,
      category,
      subcategory: await this.getSubcategory(blob, category),
      importance,
      canDelete,
      deleteReason: canDelete ? this.getDeleteReason(blob, importance) : undefined,
      sizeBytes: blob.size || 0,
      storageCost: blob.storageRebate,
      referencedBy,
      lastAccessed: this.estimateLastAccess(blob)
    };
  }

  async classifyBlobs(blobs: BlobInfo[]): Promise<BlobClassification[]> {
    const classifications = await Promise.allSettled(
      blobs.map(blob => this.classifyBlob(blob))
    );

    return classifications
      .filter((result): result is PromiseFulfilledResult<BlobClassification> => 
        result.status === 'fulfilled')
      .map(result => result.value);
  }

  async findDeletableBlobs(blobs: BlobInfo[]): Promise<BlobClassification[]> {
    const classifications = await this.classifyBlobs(blobs);
    return classifications.filter(c => c.canDelete);
  }

  async findWebsiteBlobs(blobs: BlobInfo[]): Promise<BlobClassification[]> {
    const classifications = await this.classifyBlobs(blobs);
    return classifications.filter(c => c.category === BlobCategory.WEBSITE);
  }

  private async determineCategory(blob: BlobInfo): Promise<BlobCategory> {
    if (!blob.contentType) {
      try {
        const content = await this.walrusClient.readBlob(blob.blobId);
        return this.categorizeFromContent(content);
      } catch {
        return BlobCategory.UNKNOWN;
      }
    }

    return this.categorizeFromContentType(blob.contentType);
  }

  private async determineImportance(blob: BlobInfo, category: BlobCategory): Promise<BlobImportance> {
    if (blob.isExpired) {
      return BlobImportance.DISPOSABLE;
    }

    if (category === BlobCategory.WEBSITE) {
      try {
        const content = await this.walrusClient.readBlob(blob.blobId);
        const siteDetection = await detectWalrusSite(content, blob.blobId);
        
        if (siteDetection.isWalrusSite && siteDetection.siteInfo) {
          return siteDetection.siteInfo.domain ? 
            BlobImportance.CRITICAL : 
            BlobImportance.IMPORTANT;
        }
      } catch {
        // If we can't read it, it might be corrupted
        return BlobImportance.LOW;
      }
    }

    const referencedBy = await this.findReferences(blob.blobId);
    if (referencedBy.length > 0) {
      return BlobImportance.IMPORTANT;
    }

    const age = this.getBlobAge(blob);
    if (age > 365) { // Older than 1 year
      return BlobImportance.LOW;
    } else if (age > 180) { // Older than 6 months
      return BlobImportance.NORMAL;
    }

    return BlobImportance.NORMAL;
  }

  private async getSubcategory(blob: BlobInfo, category: BlobCategory): Promise<string | undefined> {
    if (!blob.contentType) return undefined;

    const contentType = blob.contentType.toLowerCase();

    switch (category) {
      case BlobCategory.IMAGE:
        if (contentType.includes('png')) return 'PNG';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'JPEG';
        if (contentType.includes('gif')) return 'GIF';
        if (contentType.includes('svg')) return 'SVG';
        if (contentType.includes('webp')) return 'WebP';
        break;

      case BlobCategory.VIDEO:
        if (contentType.includes('mp4')) return 'MP4';
        if (contentType.includes('webm')) return 'WebM';
        if (contentType.includes('avi')) return 'AVI';
        if (contentType.includes('mov')) return 'MOV';
        break;

      case BlobCategory.DOCUMENT:
        if (contentType.includes('pdf')) return 'PDF';
        if (contentType.includes('word')) return 'Word';
        if (contentType.includes('text/plain')) return 'Text';
        if (contentType.includes('markdown')) return 'Markdown';
        break;

      case BlobCategory.ARCHIVE:
        if (contentType.includes('zip')) return 'ZIP';
        if (contentType.includes('tar')) return 'TAR';
        if (contentType.includes('rar')) return 'RAR';
        break;

      case BlobCategory.WEBSITE:
        try {
          const content = await this.walrusClient.readBlob(blob.blobId);
          const siteDetection = await detectWalrusSite(content, blob.blobId);
          if (siteDetection.isWalrusSite && siteDetection.siteInfo) {
            return siteDetection.siteInfo.isFileDirectory ? 'File Directory' : 'Website';
          }
        } catch {
          // Fallback
        }
        return contentType.includes('zip') ? 'ZIP Site' : 'HTML Page';
    }

    return undefined;
  }

  private async findReferences(blobId: string): Promise<string[]> {
    try {
      return await this.walrusClient.getBlobsReferencedBy(blobId);
    } catch {
      return [];
    }
  }

  private canSafelyDelete(blob: BlobInfo, importance: BlobImportance, referencedBy: string[]): boolean {
    if (!blob.isDeletable) return false;
    
    if (importance === BlobImportance.CRITICAL) return false;
    
    if (referencedBy.length > 0) return false;
    
    if (blob.isExpired) return true;
    
    if (importance === BlobImportance.DISPOSABLE) return true;
    
    if (importance === BlobImportance.LOW && this.getBlobAge(blob) > 365) return true;

    return false;
  }

  private getDeleteReason(blob: BlobInfo, importance: BlobImportance): string {
    if (blob.isExpired) {
      return 'Blob has expired';
    }

    if (importance === BlobImportance.DISPOSABLE) {
      return 'Marked as disposable';
    }

    if (importance === BlobImportance.LOW && this.getBlobAge(blob) > 365) {
      return 'Low importance and older than 1 year';
    }

    return 'Safe to delete based on analysis';
  }

  private getBlobAge(blob: BlobInfo): number {
    if (!blob.createdEpoch) return 0;
    
    const createdDate = new Date(blob.createdEpoch * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  private estimateLastAccess(blob: BlobInfo): Date | undefined {
    if (blob.createdEpoch) {
      return new Date(blob.createdEpoch * 24 * 60 * 60 * 1000);
    }
    return undefined;
  }

  private categorizeFromContentType(contentType: string): BlobCategory {
    const type = contentType.toLowerCase();

    if (type.includes('text/html') || 
        (type.includes('application/zip') && type.includes('site'))) {
      return BlobCategory.WEBSITE;
    }

    if (type.startsWith('image/')) return BlobCategory.IMAGE;
    if (type.startsWith('video/')) return BlobCategory.VIDEO;
    if (type.startsWith('audio/')) return BlobCategory.AUDIO;

    if (type.includes('pdf') || 
        type.includes('document') ||
        type.includes('text/') ||
        type.includes('application/msword') ||
        type.includes('application/vnd.openxmlformats')) {
      return BlobCategory.DOCUMENT;
    }

    if (type.includes('zip') || 
        type.includes('tar') ||
        type.includes('rar') ||
        type.includes('7z') ||
        type.includes('gzip')) {
      return BlobCategory.ARCHIVE;
    }

    if (type.includes('javascript') ||
        type.includes('typescript') ||
        type.includes('python') ||
        type.includes('json') ||
        type.includes('xml')) {
      return BlobCategory.CODE;
    }

    if (type.includes('application/') || 
        type.includes('binary')) {
      return BlobCategory.DATA;
    }

    return BlobCategory.UNKNOWN;
  }

  private categorizeFromContent(content: Buffer): BlobCategory {
    const signature = content.subarray(0, 16);

    // Check HTML signatures
    if (signature.includes(Buffer.from('<!DOCTYPE html', 'utf8')) || 
        signature.includes(Buffer.from('<html', 'utf8'))) {
      return BlobCategory.WEBSITE;
    }

    // Check ZIP signature
    if (signature[0] === 0x50 && signature[1] === 0x4B) {
      return BlobCategory.ARCHIVE; // Could be website or archive
    }

    // Check image signatures
    if (signature[0] === 0xFF && signature[1] === 0xD8) return BlobCategory.IMAGE; // JPEG
    if (signature[0] === 0x89 && signature[1] === 0x50) return BlobCategory.IMAGE; // PNG
    if (signature[0] === 0x47 && signature[1] === 0x49) return BlobCategory.IMAGE; // GIF

    // Check PDF
    if (signature.includes(Buffer.from('%PDF', 'utf8'))) {
      return BlobCategory.DOCUMENT;
    }

    // Try to parse as text
    const text = content.toString('utf8', 0, Math.min(512, content.length));
    
    try {
      JSON.parse(text);
      return BlobCategory.CODE;
    } catch {
      // Not JSON
    }

    if (text.includes('<html') || text.includes('<!DOCTYPE')) {
      return BlobCategory.WEBSITE;
    }

    return BlobCategory.UNKNOWN;
  }
}