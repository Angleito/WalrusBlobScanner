import { spawn } from 'child_process';
import chalk from 'chalk';
import { CostEstimate } from './cost-estimator.js';

export interface DeletionResult {
  blobId: string;
  success: boolean;
  transactionHash?: string;
  actualGasCost?: number;
  actualStorageRefund?: number;
  error?: string;
}

export interface BatchResult {
  batchNumber: number;
  results: DeletionResult[];
  totalGasUsed: number;
  totalRefundReceived: number;
  netRefund: number;
  batchTransactionHash?: string;
}

export class DeletionExecutor {
  async deleteBlobBatch(
    blobs: CostEstimate[], 
    batchNumber: number,
    showProgress: boolean = true
  ): Promise<BatchResult> {
    const results: DeletionResult[] = [];
    let totalGasUsed = 0;
    let totalRefundReceived = 0;

    if (showProgress) {
      console.log(chalk.blue(`\n🚀 Batch ${batchNumber}: Processing ${blobs.length} blobs...`));
    }

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      
      if (showProgress) {
        const progress = Math.round(((i + 1) / blobs.length) * 100);
        const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
        process.stdout.write(`\r[${progressBar}] ${progress}% | Deleting ${blob.blobId.slice(0, 8)}...`);
      }

      try {
        const result = await this.deleteSingleBlob(blob.blobId);
        results.push(result);

        if (result.success) {
          totalGasUsed += result.actualGasCost || 0;
          totalRefundReceived += result.actualStorageRefund || 0;
        }
      } catch (error) {
        results.push({
          blobId: blob.blobId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    if (showProgress) {
      process.stdout.write('\n');
    }

    const netRefund = totalRefundReceived - totalGasUsed;
    
    if (showProgress) {
      const successCount = results.filter(r => r.success).length;
      const refundColor = netRefund > 0 ? chalk.green : chalk.red;
      console.log(chalk.green(`✓ Batch ${batchNumber} complete: ${successCount}/${blobs.length} deleted`));
      console.log(refundColor(`  Net refund: ${netRefund > 0 ? '+' : ''}${netRefund.toFixed(4)} SUI`));
    }

    return {
      batchNumber,
      results,
      totalGasUsed,
      totalRefundReceived,
      netRefund
    };
  }

  private async deleteSingleBlob(blobId: string): Promise<DeletionResult> {
    try {
      // Use walrus delete with JSON output
      const deleteOutput = await this.runWalrusCommand(['delete', '--blob-id', blobId, '--json']);
      const deleteResult = JSON.parse(deleteOutput);

      if (deleteResult.status === 'success' || deleteResult.success) {
        const transactionHash = deleteResult.transaction_hash || deleteResult.tx_hash;
        
        // Get detailed transaction info from Sui
        let actualGasCost = 0;
        let actualStorageRefund = 0;

        if (transactionHash) {
          try {
            const txInfo = await this.getTransactionInfo(transactionHash);
            actualGasCost = this.extractGasCost(txInfo);
            actualStorageRefund = this.extractStorageRefund(txInfo);
          } catch (error) {
            // Continue even if we can't get detailed transaction info
          }
        }

        return {
          blobId,
          success: true,
          transactionHash,
          actualGasCost,
          actualStorageRefund
        };
      } else {
        return {
          blobId,
          success: false,
          error: deleteResult.error || 'Deletion failed'
        };
      }
    } catch (error) {
      return {
        blobId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getTransactionInfo(transactionHash: string): Promise<any> {
    try {
      const output = await this.runSuiCommand(['client', 'tx-block', transactionHash, '--json']);
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Failed to get transaction info: ${error}`);
    }
  }

  private extractGasCost(txInfo: any): number {
    try {
      // Extract gas cost from transaction effects
      const gasUsed = txInfo?.effects?.gasUsed?.computationCost || 
                     txInfo?.effects?.gasUsed?.totalCost || 0;
      
      // Convert from MIST to SUI
      return typeof gasUsed === 'string' ? parseInt(gasUsed) / 1e9 : gasUsed / 1e9;
    } catch (error) {
      return 0;
    }
  }

  private extractStorageRefund(txInfo: any): number {
    try {
      // Extract storage rebate from transaction effects
      const storageRebate = txInfo?.effects?.gasUsed?.storageRebate || 0;
      
      // Convert from MIST to SUI
      return typeof storageRebate === 'string' ? parseInt(storageRebate) / 1e9 : storageRebate / 1e9;
    } catch (error) {
      return 0;
    }
  }

  private runWalrusCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('walrus', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      
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
          reject(new Error(stderr || `Walrus command failed with code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
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