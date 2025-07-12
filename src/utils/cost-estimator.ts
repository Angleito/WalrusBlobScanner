import { spawn } from 'child_process';
import { BlobInfo } from '../types/index.js';

export interface CostEstimate {
  blobId: string;
  storageRebate: number;
  estimatedGasCost: number;
  netRefund: number;
  deletable: boolean;
  reason?: string;
}

export interface BatchCostEstimate {
  totalBlobs: number;
  totalStorageRebate: number;
  totalEstimatedGas: number;
  totalNetRefund: number;
  batches: {
    batchNumber: number;
    blobCount: number;
    estimatedGas: number;
    netRefund: number;
  }[];
}

export class CostEstimator {
  private static readonly GAS_PER_DELETION = 0.005; // Estimated SUI per deletion
  private static readonly STORAGE_REBATE_RATE = 0.99; // 99% rebate rate

  async estimateDeletionCosts(blobs: BlobInfo[]): Promise<CostEstimate[]> {
    const estimates: CostEstimate[] = [];

    for (const blob of blobs) {
      const estimate = await this.estimateSingleBlobCost(blob);
      estimates.push(estimate);
    }

    return estimates;
  }

  async estimateBatchCosts(
    deletableBlobs: CostEstimate[], 
    batchSize: number = 10
  ): Promise<BatchCostEstimate> {
    const totalBlobs = deletableBlobs.length;
    const totalStorageRebate = deletableBlobs.reduce((sum, blob) => sum + blob.storageRebate, 0);
    const totalEstimatedGas = deletableBlobs.reduce((sum, blob) => sum + blob.estimatedGasCost, 0);
    const totalNetRefund = totalStorageRebate - totalEstimatedGas;

    const batches = [];
    for (let i = 0; i < totalBlobs; i += batchSize) {
      const batchBlobs = deletableBlobs.slice(i, i + batchSize);
      const batchGas = batchBlobs.reduce((sum, blob) => sum + blob.estimatedGasCost, 0);
      const batchRebate = batchBlobs.reduce((sum, blob) => sum + blob.storageRebate, 0);
      
      batches.push({
        batchNumber: Math.floor(i / batchSize) + 1,
        blobCount: batchBlobs.length,
        estimatedGas: batchGas,
        netRefund: batchRebate - batchGas
      });
    }

    return {
      totalBlobs,
      totalStorageRebate,
      totalEstimatedGas,
      totalNetRefund,
      batches
    };
  }

  private async estimateSingleBlobCost(blob: BlobInfo): Promise<CostEstimate> {
    const estimate: CostEstimate = {
      blobId: blob.blobId,
      storageRebate: 0,
      estimatedGasCost: CostEstimator.GAS_PER_DELETION,
      netRefund: 0,
      deletable: false
    };

    try {
      // Check if blob is deletable by querying the Sui object
      if (blob.suiObjectId) {
        const objectInfo = await this.getSuiObjectInfo(blob.suiObjectId);
        
        // Check for deletable flag and storage rebate
        if (objectInfo) {
          estimate.deletable = this.checkDeletableFlag(objectInfo);
          estimate.storageRebate = this.extractStorageRebate(objectInfo);
          estimate.netRefund = estimate.storageRebate - estimate.estimatedGasCost;

          if (!estimate.deletable) {
            estimate.reason = 'Blob was not created with --deletable flag';
          }
        } else {
          estimate.reason = 'Could not fetch blob object information';
        }
      } else {
        estimate.reason = 'No Sui object ID available';
      }
    } catch (error) {
      estimate.reason = `Error checking blob: ${error}`;
    }

    return estimate;
  }

  private async getSuiObjectInfo(objectId: string): Promise<any> {
    try {
      const output = await this.runSuiCommand(['client', 'object', objectId, '--json']);
      return JSON.parse(output);
    } catch (error) {
      return null;
    }
  }

  private checkDeletableFlag(objectInfo: any): boolean {
    // Check if the object has a deletable field set to true
    try {
      const fields = objectInfo?.data?.content?.fields;
      return fields?.deletable === true || fields?.is_deletable === true;
    } catch (error) {
      return false;
    }
  }

  private extractStorageRebate(objectInfo: any): number {
    try {
      // Look for storage rebate in the object
      const fields = objectInfo?.data?.content?.fields;
      const storageRebate = fields?.storage_rebate || fields?.storageRebate || 0;
      
      // Convert from MIST to SUI (1 SUI = 1e9 MIST)
      if (typeof storageRebate === 'string') {
        return parseInt(storageRebate) / 1e9;
      } else if (typeof storageRebate === 'number') {
        return storageRebate / 1e9;
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }

  private runSuiCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('sui', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Sui command failed with code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }
}