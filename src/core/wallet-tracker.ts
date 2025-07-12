import { SuiClient } from '@mysten/sui.js/client';
import { BlobInfo, WalletBlobSummary, BlobCategory } from '../types/index.js';
import { WalrusClient } from '../utils/walrus-client.js';

export class WalletTracker {
  private suiClient: SuiClient;
  private walrusClient: WalrusClient;

  constructor(suiRpcUrl: string, aggregatorUrl?: string) {
    this.suiClient = new SuiClient({ url: suiRpcUrl });
    this.walrusClient = new WalrusClient(aggregatorUrl, suiRpcUrl);
  }

  async getWalletBlobSummary(walletAddress: string): Promise<WalletBlobSummary> {
    const blobs = await this.walrusClient.listBlobsForWallet(walletAddress);
    return this.getWalletBlobSummaryFromBlobs(walletAddress, blobs);
  }
  
  async getWalletBlobSummaryFromBlobs(walletAddress: string, blobs: BlobInfo[]): Promise<WalletBlobSummary> {
    const summary: WalletBlobSummary = {
      address: walletAddress,
      totalBlobs: blobs.length,
      totalSize: 0,
      totalCost: 0,
      categories: {
        [BlobCategory.WEBSITE]: 0,
        [BlobCategory.IMAGE]: 0,
        [BlobCategory.DOCUMENT]: 0,
        [BlobCategory.ARCHIVE]: 0,
        [BlobCategory.VIDEO]: 0,
        [BlobCategory.AUDIO]: 0,
        [BlobCategory.DATA]: 0,
        [BlobCategory.CODE]: 0,
        [BlobCategory.UNKNOWN]: 0
      },
      deletableBlobs: 0,
      deletableSize: 0,
      potentialSavings: 0,
      websites: 0,
      expiredBlobs: 0
    };

    for (const blob of blobs) {
      const size = blob.size || 0;
      summary.totalSize += size;
      
      if (blob.storageRebate) {
        summary.totalCost += blob.storageRebate;
      }

      if (blob.isExpired) {
        summary.expiredBlobs++;
      }

      if (blob.isDeletable) {
        summary.deletableBlobs++;
        summary.deletableSize += size;
        summary.potentialSavings += blob.storageRebate || 0;
      }

      const category = this.categorizeBlob(blob);
      summary.categories[category]++;

      if (category === BlobCategory.WEBSITE) {
        summary.websites++;
      }
    }

    return summary;
  }

  async validateWalletAddress(address: string): Promise<boolean> {
    try {
      if (!address.startsWith('0x') || address.length !== 66) {
        return false;
      }

      await this.suiClient.getObject({
        id: '0x' + '0'.repeat(62) + '05',
        options: { showContent: false }
      });
      
      return true;
    } catch {
      return false;
    }
  }

  async findBlobOwner(blobId: string): Promise<string | null> {
    try {
      const objects = await this.suiClient.multiGetObjects({
        ids: [blobId],
        options: { showOwner: true }
      });

      const obj = objects[0];
      if (obj.data?.owner) {
        const owner = obj.data.owner;
        if (typeof owner === 'string') return owner;
        if ('AddressOwner' in owner) return owner.AddressOwner;
        if ('ObjectOwner' in owner) return owner.ObjectOwner;
      }

      return null;
    } catch {
      return null;
    }
  }

  async getWalletSuiBalance(address: string): Promise<number> {
    try {
      const balance = await this.suiClient.getBalance({
        owner: address,
        coinType: '0x2::sui::SUI'
      });
      return parseInt(balance.totalBalance);
    } catch {
      return 0;
    }
  }

  async getStorageObjects(walletAddress: string): Promise<any[]> {
    try {
      const ownedObjects = await this.suiClient.getOwnedObjects({
        owner: walletAddress,
        filter: {
          MatchAny: [
            { StructType: 'walrus::storage::BlobObject' },
            { StructType: 'walrus_site::site::Site' }
          ]
        },
        options: {
          showContent: true,
          showType: true
        }
      });

      return ownedObjects.data.filter(obj => obj.data !== null);
    } catch (error) {
      console.error('Error getting storage objects:', error);
      return [];
    }
  }

  private categorizeBlob(blob: BlobInfo): BlobCategory {
    if (!blob.contentType) {
      return BlobCategory.UNKNOWN;
    }

    const contentType = blob.contentType.toLowerCase();

    if (contentType.includes('text/html') || 
        contentType.includes('application/zip')) {
      return BlobCategory.WEBSITE;
    }

    if (contentType.startsWith('image/')) {
      return BlobCategory.IMAGE;
    }

    if (contentType.startsWith('video/')) {
      return BlobCategory.VIDEO;
    }

    if (contentType.startsWith('audio/')) {
      return BlobCategory.AUDIO;
    }

    if (contentType.includes('pdf') || 
        contentType.includes('document') ||
        contentType.includes('text/') ||
        contentType.includes('application/msword') ||
        contentType.includes('application/vnd.openxmlformats')) {
      return BlobCategory.DOCUMENT;
    }

    if (contentType.includes('zip') || 
        contentType.includes('tar') ||
        contentType.includes('rar') ||
        contentType.includes('7z')) {
      return BlobCategory.ARCHIVE;
    }

    if (contentType.includes('javascript') ||
        contentType.includes('typescript') ||
        contentType.includes('python') ||
        contentType.includes('json') ||
        contentType.includes('xml')) {
      return BlobCategory.CODE;
    }

    if (contentType.includes('application/') || 
        contentType.includes('binary')) {
      return BlobCategory.DATA;
    }

    return BlobCategory.UNKNOWN;
  }
}