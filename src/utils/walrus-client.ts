import { spawn } from 'child_process';
import axios from 'axios';
import { BlobInfo } from '../types/index.js';
import { DEFAULT_AGGREGATOR_URL } from '../config/walrus.js';
import { SuiClient } from '@mysten/sui.js/client';

export class WalrusClient {
  private aggregatorUrl: string;
  private suiClient?: SuiClient;

  constructor(aggregatorUrl: string = DEFAULT_AGGREGATOR_URL, suiRpcUrl?: string) {
    this.aggregatorUrl = aggregatorUrl;
    if (suiRpcUrl) {
      this.suiClient = new SuiClient({ url: suiRpcUrl });
    }
  }

  async readBlob(blobId: string): Promise<Buffer> {
    try {
      // Clean up blob ID - remove 0x prefix if present for the API
      const cleanBlobId = blobId.startsWith('0x') ? blobId.slice(2) : blobId;
      const response = await axios.get(`${this.aggregatorUrl}/v1/${cleanBlobId}`, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      return Buffer.from(response.data);
    } catch (error) {
      throw new Error(`Failed to read blob ${blobId}: ${error}`);
    }
  }

  async getBlobInfo(blobId: string): Promise<BlobInfo | null> {
    try {
      // Clean up blob ID - remove 0x prefix if present for the API
      const cleanBlobId = blobId.startsWith('0x') ? blobId.slice(2) : blobId;
      const response = await axios.head(`${this.aggregatorUrl}/v1/${cleanBlobId}`);
      
      return {
        blobId,
        size: parseInt(response.headers['content-length'] || '0'),
        contentType: response.headers['content-type'],
        isExpired: false
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to get blob info for ${blobId}: ${error}`);
    }
  }

  async listBlobs(): Promise<BlobInfo[]> {
    return new Promise((resolve, reject) => {
      const walrusProcess = spawn('walrus', ['list-blobs', '--json'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      walrusProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      walrusProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      walrusProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Walrus CLI failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          const blobs: BlobInfo[] = result.blobs?.map((blob: any) => ({
            blobId: blob.blob_id,
            size: blob.size,
            isExpired: blob.end_epoch ? blob.end_epoch < Date.now() / 1000 : false,
            endEpoch: blob.end_epoch,
            isDeletable: blob.deletable,
            suiObjectId: blob.sui_object_id
          })) || [];
          
          resolve(blobs);
        } catch (parseError) {
          reject(new Error(`Failed to parse walrus output: ${parseError}`));
        }
      });

      walrusProcess.on('error', (error) => {
        reject(new Error(`Failed to execute walrus CLI: ${error}`));
      });
    });
  }

  async storeBlob(filePath: string, epochs: number = 100): Promise<string> {
    return new Promise((resolve, reject) => {
      const walrusProcess = spawn('walrus', ['store', filePath, '--epochs', epochs.toString(), '--json'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      walrusProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      walrusProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      walrusProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Walrus store failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result.blob_id || result.newlyCreated?.blobObject?.blobId);
        } catch (parseError) {
          reject(new Error(`Failed to parse store result: ${parseError}`));
        }
      });
    });
  }

  async listBlobsForWallet(walletAddress: string): Promise<BlobInfo[]> {
    if (!this.suiClient) {
      throw new Error('Sui client not initialized. Provide suiRpcUrl in constructor.');
    }

    try {
      // First, get all objects owned by the wallet without filtering
      // We'll filter for Walrus objects manually
      const ownedObjects = await this.suiClient.getOwnedObjects({
        owner: walletAddress,
        options: {
          showContent: true,
          showType: true,
          showDisplay: true
        }
      });

      const blobInfos: BlobInfo[] = [];

      for (const obj of ownedObjects.data) {
        if (obj.data?.content?.dataType === 'moveObject' && obj.data?.type) {
          const objectType = obj.data.type;
          
          // Check if this is a Walrus blob object
          // The type might be something like: 0x<package>::storage::Blob or similar
          if (objectType.includes('walrus') || objectType.includes('Blob') || objectType.includes('storage')) {
            // Found a potential Walrus object
            
            const fields = (obj.data.content as any).fields;
            let blobId = fields?.blob_id || fields?.id || fields?.blobId;
            
            // Convert blob ID from decimal to hex if necessary
            if (blobId && typeof blobId === 'string' && /^\d+$/.test(blobId)) {
              // It's a decimal number, convert to hex
              const bigIntValue = BigInt(blobId);
              blobId = '0x' + bigIntValue.toString(16).padStart(64, '0');
            } else if (blobId && typeof blobId === 'number') {
              // Convert number to hex
              blobId = '0x' + BigInt(blobId).toString(16).padStart(64, '0');
            }
            
            if (blobId) {
              const blobInfo: BlobInfo = {
                blobId: blobId,
                suiObjectId: obj.data.objectId,
                owner: walletAddress,
                isExpired: this.checkIfExpired(fields),
                endEpoch: fields?.end_epoch || fields?.endEpoch,
                isDeletable: fields?.deletable === true, // Only mark as deletable if explicitly true
                size: this.parseSize(fields?.size),
                createdEpoch: fields?.created_epoch || fields?.createdEpoch,
                storageRebate: fields?.storage_rebate || fields?.storageRebate
              };

              // Try to get additional info from the aggregator
              if (blobInfo.blobId) {
                try {
                  const contentInfo = await this.getBlobInfo(blobInfo.blobId);
                  if (contentInfo) {
                    blobInfo.contentType = contentInfo.contentType;
                    blobInfo.size = blobInfo.size || contentInfo.size;
                  }
                } catch (error) {
                  console.warn(`Could not get content info for blob ${blobInfo.blobId}`);
                }
              }

              blobInfos.push(blobInfo);
            }
          }
        }
      }
      
      // If no Walrus objects found via Sui query, don't fallback to CLI
      // The CLI uses the configured wallet, not the requested address

      return blobInfos;
    } catch (error) {
      throw new Error(`Failed to list blobs for wallet ${walletAddress}: ${error}`);
    }
  }

  async deleteBlob(blobId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const walrusProcess = spawn('walrus', ['delete', '--blob-id', blobId, '--json'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      walrusProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      walrusProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      walrusProcess.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error(`Failed to delete blob ${blobId}: ${stderr}`));
        }
      });

      walrusProcess.on('error', (error) => {
        reject(new Error(`Failed to execute walrus delete: ${error}`));
      });
    });
  }

  async blobExists(blobId: string): Promise<boolean> {
    try {
      const info = await this.getBlobInfo(blobId);
      return info !== null;
    } catch {
      return false;
    }
  }

  async getBlobsReferencedBy(blobId: string): Promise<string[]> {
    try {
      const content = await this.readBlob(blobId);
      const referenced: string[] = [];
      
      const text = content.toString('utf8');
      
      const blobIdPattern = /[a-fA-F0-9]{64}/g;
      const matches = text.match(blobIdPattern);
      
      if (matches) {
        for (const match of matches) {
          if (match !== blobId && await this.blobExists(match)) {
            referenced.push(match);
          }
        }
      }

      return [...new Set(referenced)];
    } catch {
      return [];
    }
  }

  private checkIfExpired(fields: any): boolean {
    if (!fields?.end_epoch) return false;
    
    const currentEpoch = Math.floor(Date.now() / 1000 / 24 / 3600);
    return fields.end_epoch < currentEpoch;
  }

  private parseSize(size: any): number | undefined {
    if (!size) return undefined;
    if (typeof size === 'number') return size;
    if (typeof size === 'string') return parseInt(size);
    return undefined;
  }
}