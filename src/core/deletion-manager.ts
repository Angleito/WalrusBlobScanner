import { BlobInfo, BlobClassification, DeletionPlan, BlobCategory, BlobImportance } from '../types/index.js';
import { WalrusClient } from '../utils/walrus-client.js';
import { BlobClassifier } from './blob-classifier.js';

export class DeletionManager {
  private walrusClient: WalrusClient;
  private classifier: BlobClassifier;

  constructor(walrusClient: WalrusClient) {
    this.walrusClient = walrusClient;
    this.classifier = new BlobClassifier(walrusClient);
  }

  async createDeletionPlan(blobs: BlobInfo[], options: DeletionOptions = {}): Promise<DeletionPlan> {
    const classifications = await this.classifier.classifyBlobs(blobs);
    const deletableBlobs = classifications.filter(c => this.shouldDelete(c, options));

    const plan: DeletionPlan = {
      blobsToDelete: deletableBlobs.map(b => b.blobId),
      totalSizeReduction: deletableBlobs.reduce((sum, b) => sum + b.sizeBytes, 0),
      costSavings: deletableBlobs.reduce((sum, b) => sum + (b.storageCost || 0), 0),
      categories: Object.values(BlobCategory).reduce((acc, category) => {
        acc[category] = 0;
        return acc;
      }, {} as Record<BlobCategory, number>),
      warnings: []
    };

    // Count by category
    Object.values(BlobCategory).forEach(category => {
      plan.categories[category] = deletableBlobs.filter(b => b.category === category).length;
    });

    // Add warnings
    plan.warnings = this.generateWarnings(deletableBlobs, options);

    return plan;
  }

  async executeDeletionPlan(plan: DeletionPlan, confirmCallback?: (blobId: string) => Promise<boolean>): Promise<DeletionResult> {
    const result: DeletionResult = {
      successful: [],
      failed: [],
      skipped: [],
      totalDeleted: 0,
      totalSizeFreed: 0,
      totalCostSaved: 0
    };

    for (const blobId of plan.blobsToDelete) {
      try {
        // Optional confirmation for each blob
        if (confirmCallback) {
          const confirmed = await confirmCallback(blobId);
          if (!confirmed) {
            result.skipped.push(blobId);
            continue;
          }
        }

        // Perform the deletion
        const success = await this.deleteBlobSafely(blobId);
        
        if (success) {
          result.successful.push(blobId);
          result.totalDeleted++;
          
          // Find the blob info to calculate savings
          const blobClassification = await this.findBlobClassification(blobId);
          if (blobClassification) {
            result.totalSizeFreed += blobClassification.sizeBytes;
            result.totalCostSaved += blobClassification.storageCost || 0;
          }
        } else {
          result.failed.push({ blobId, error: 'Deletion failed' });
        }
      } catch (error) {
        result.failed.push({ 
          blobId, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    return result;
  }

  async deleteBlobSafely(blobId: string): Promise<boolean> {
    try {
      // Double-check the blob is safe to delete
      const blobInfo = await this.getBlobInfo(blobId);
      if (!blobInfo) {
        throw new Error('Blob not found');
      }

      if (!blobInfo.isDeletable) {
        throw new Error('Blob is not deletable');
      }

      // Check for references one more time
      const references = await this.walrusClient.getBlobsReferencedBy(blobId);
      if (references.length > 0) {
        throw new Error('Blob is still referenced by other blobs');
      }

      // Perform the actual deletion
      return await this.walrusClient.deleteBlob(blobId);
    } catch (error) {
      console.error(`Failed to safely delete blob ${blobId}:`, error);
      return false;
    }
  }

  async analyzeStorageCleanup(blobs: BlobInfo[]): Promise<CleanupAnalysis> {
    const classifications = await this.classifier.classifyBlobs(blobs);
    
    const analysis: CleanupAnalysis = {
      totalBlobs: blobs.length,
      totalSize: blobs.reduce((sum, b) => sum + (b.size || 0), 0),
      categories: Object.values(BlobCategory).reduce((acc, category) => {
        acc[category] = { count: 0, size: 0, deletable: 0, deletableSize: 0 };
        return acc;
      }, {} as Record<BlobCategory, { count: number; size: number; deletable: number; deletableSize: number; }>),
      recommendations: []
    };

    // Group by category
    Object.values(BlobCategory).forEach(category => {
      const categoryBlobs = classifications.filter(c => c.category === category);
      analysis.categories[category] = {
        count: categoryBlobs.length,
        size: categoryBlobs.reduce((sum, b) => sum + b.sizeBytes, 0),
        deletable: categoryBlobs.filter(b => b.canDelete).length,
        deletableSize: categoryBlobs.filter(b => b.canDelete).reduce((sum, b) => sum + b.sizeBytes, 0)
      };
    });

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(classifications);

    return analysis;
  }

  private shouldDelete(classification: BlobClassification, options: DeletionOptions): boolean {
    if (!classification.canDelete) return false;

    // Check category filters
    if (options.excludeCategories?.includes(classification.category)) {
      return false;
    }

    if (options.includeCategories && !options.includeCategories.includes(classification.category)) {
      return false;
    }

    // Check importance filters
    if (options.maxImportance) {
      const importanceOrder = [
        BlobImportance.DISPOSABLE,
        BlobImportance.LOW,
        BlobImportance.NORMAL,
        BlobImportance.IMPORTANT,
        BlobImportance.CRITICAL
      ];
      
      const blobImportanceIndex = importanceOrder.indexOf(classification.importance);
      const maxImportanceIndex = importanceOrder.indexOf(options.maxImportance);
      
      if (blobImportanceIndex > maxImportanceIndex) {
        return false;
      }
    }

    // Check size filters
    if (options.minSizeBytes && classification.sizeBytes < options.minSizeBytes) {
      return false;
    }

    if (options.maxSizeBytes && classification.sizeBytes > options.maxSizeBytes) {
      return false;
    }

    return true;
  }

  private generateWarnings(deletableBlobs: BlobClassification[], options: DeletionOptions): string[] {
    const warnings: string[] = [];

    const websiteBlobs = deletableBlobs.filter(b => b.category === BlobCategory.WEBSITE);
    if (websiteBlobs.length > 0) {
      warnings.push(`${websiteBlobs.length} website(s) will be deleted`);
    }

    const importantBlobs = deletableBlobs.filter(b => b.importance === BlobImportance.IMPORTANT);
    if (importantBlobs.length > 0) {
      warnings.push(`${importantBlobs.length} important blob(s) will be deleted`);
    }

    const largeBlobs = deletableBlobs.filter(b => b.sizeBytes > 10 * 1024 * 1024); // > 10MB
    if (largeBlobs.length > 0) {
      warnings.push(`${largeBlobs.length} large blob(s) (>10MB) will be deleted`);
    }

    if (deletableBlobs.length > 50) {
      warnings.push(`Large number of blobs to delete (${deletableBlobs.length})`);
    }

    return warnings;
  }

  private generateRecommendations(classifications: BlobClassification[]): CleanupRecommendation[] {
    const recommendations: CleanupRecommendation[] = [];

    // Expired blobs
    const expiredBlobs = classifications.filter(c => c.deleteReason?.includes('expired'));
    if (expiredBlobs.length > 0) {
      recommendations.push({
        type: 'immediate',
        description: `Delete ${expiredBlobs.length} expired blob(s)`,
        impact: 'High',
        blobIds: expiredBlobs.map(b => b.blobId)
      });
    }

    // Old low-importance blobs
    const oldLowImportance = classifications.filter(c => 
      c.importance === BlobImportance.LOW && c.deleteReason?.includes('older than 1 year')
    );
    if (oldLowImportance.length > 0) {
      recommendations.push({
        type: 'suggested',
        description: `Consider deleting ${oldLowImportance.length} old, low-importance blob(s)`,
        impact: 'Medium',
        blobIds: oldLowImportance.map(b => b.blobId)
      });
    }

    // Large files that aren't websites
    const largeNonWebsite = classifications.filter(c => 
      c.sizeBytes > 50 * 1024 * 1024 && // > 50MB
      c.category !== BlobCategory.WEBSITE &&
      c.importance !== BlobImportance.CRITICAL
    );
    if (largeNonWebsite.length > 0) {
      recommendations.push({
        type: 'review',
        description: `Review ${largeNonWebsite.length} large file(s) (>50MB) for potential deletion`,
        impact: 'High',
        blobIds: largeNonWebsite.map(b => b.blobId)
      });
    }

    return recommendations;
  }

  private async getBlobInfo(blobId: string): Promise<BlobInfo | null> {
    return await this.walrusClient.getBlobInfo(blobId);
  }

  private async findBlobClassification(blobId: string): Promise<BlobClassification | null> {
    try {
      const blobInfo = await this.getBlobInfo(blobId);
      if (!blobInfo) return null;
      return await this.classifier.classifyBlob(blobInfo);
    } catch {
      return null;
    }
  }
}

export interface DeletionOptions {
  includeCategories?: BlobCategory[];
  excludeCategories?: BlobCategory[];
  maxImportance?: BlobImportance;
  minSizeBytes?: number;
  maxSizeBytes?: number;
}

export interface DeletionResult {
  successful: string[];
  failed: { blobId: string; error: string }[];
  skipped: string[];
  totalDeleted: number;
  totalSizeFreed: number;
  totalCostSaved: number;
}

export interface CleanupAnalysis {
  totalBlobs: number;
  totalSize: number;
  categories: Record<BlobCategory, {
    count: number;
    size: number;
    deletable: number;
    deletableSize: number;
  }>;
  recommendations: CleanupRecommendation[];
}

export interface CleanupRecommendation {
  type: 'immediate' | 'suggested' | 'review';
  description: string;
  impact: 'Low' | 'Medium' | 'High';
  blobIds: string[];
}