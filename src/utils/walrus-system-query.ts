import { SuiClient } from '@mysten/sui.js/client';
import { BlobInfo } from '../types/index.js';
import { WALRUS_CONFIGS } from '../config/walrus.js';

export class WalrusSystemQuery {
  private suiClient: SuiClient;
  private systemObjectId: string;

  constructor(suiRpcUrl: string, network: 'mainnet' | 'testnet' = 'mainnet') {
    this.suiClient = new SuiClient({ url: suiRpcUrl });
    this.systemObjectId = WALRUS_CONFIGS[network].systemObject;
  }

  async queryBlobsForWallet(walletAddress: string): Promise<BlobInfo[]> {
    try {
      // Query the Walrus system object for blob information
      const systemObject = await this.suiClient.getObject({
        id: this.systemObjectId,
        options: {
          showContent: true,
          showType: true
        }
      });

      console.log('Walrus system object type:', systemObject.data?.type);

      // Alternative approach: Query dynamic fields of the system object
      const dynamicFields = await this.suiClient.getDynamicFields({
        parentId: this.systemObjectId,
        cursor: null,
        limit: 50
      });

      console.log(`Found ${dynamicFields.data.length} dynamic fields in system object`);

      // Look through owned objects for Walrus Sites
      const walrusSites = await this.queryWalrusSites(walletAddress);
      
      return walrusSites;
    } catch (error) {
      console.error('Error querying Walrus system:', error);
      return [];
    }
  }

  async getSiteBlobIds(siteObjectId: string): Promise<string[]> {
    try {
      const blobIds: string[] = [];
      
      // Get dynamic fields for the site
      const dynamicFields = await this.suiClient.getDynamicFields({
        parentId: siteObjectId
      });
      
      // Fetch each dynamic field to get blob IDs
      for (const field of dynamicFields.data) {
        try {
          const fieldObject = await this.suiClient.getDynamicFieldObject({
            parentId: siteObjectId,
            name: field.name
          });
          
          if (fieldObject.data?.content?.dataType === 'moveObject') {
            const fieldContent = (fieldObject.data.content as any).fields;
            const resourceBlobId = fieldContent?.value?.fields?.blob_id;
            
            if (resourceBlobId) {
              // Convert decimal to hex
              let hexId: string;
              if (typeof resourceBlobId === 'string' && /^\d+$/.test(resourceBlobId)) {
                hexId = '0x' + BigInt(resourceBlobId).toString(16).padStart(64, '0');
              } else if (typeof resourceBlobId === 'number') {
                hexId = '0x' + BigInt(resourceBlobId).toString(16).padStart(64, '0');
              } else {
                hexId = resourceBlobId;
              }
              blobIds.push(hexId);
            }
          }
        } catch (error) {
          // Silently continue if we can't fetch a field
        }
      }
      
      return blobIds;
    } catch (error) {
      console.error(`Error getting site blob IDs for ${siteObjectId}:`, error);
      return [];
    }
  }

  async queryWalrusSites(walletAddress: string): Promise<BlobInfo[]> {
    try {
      const ownedObjects = await this.suiClient.getOwnedObjects({
        owner: walletAddress,
        options: {
          showContent: true,
          showType: true
        }
      });

      const blobInfos: BlobInfo[] = [];

      for (const obj of ownedObjects.data) {
        if (obj.data?.type) {
          const objectType = obj.data.type;
          
          // Look for Walrus Sites package objects
          if (objectType.includes('0x6fb382ac9a32d0e351506e70b13d0a75abacb55c7c0d41b6b2b5b84f8e7c8b1c') ||
              objectType.includes('walrus_site') ||
              objectType.includes('Site')) {
            
            console.log(`Found Walrus Site object: ${objectType}`);
            
            if (obj.data.content?.dataType === 'moveObject') {
              const fields = (obj.data.content as any).fields;
              
              // For now, just return the site info without blob_id
              // The blob_id might be in a different field or require parsing
              blobInfos.push({
                blobId: '', // We'll need to figure out how to get this
                suiObjectId: obj.data.objectId,
                owner: walletAddress,
                isExpired: false,
                isDeletable: false,
                contentType: 'application/zip' // Walrus Sites are typically ZIP files
              });
            }
          }
        }
      }

      return blobInfos;
    } catch (error) {
      console.error('Error querying Walrus Sites:', error);
      return [];
    }
  }

  async debugWalletObjects(walletAddress: string): Promise<void> {
    try {
      const ownedObjects = await this.suiClient.getOwnedObjects({
        owner: walletAddress,
        options: {
          showContent: true,
          showType: true
        }
      });

      console.log(`\nDebug: Wallet ${walletAddress} owns ${ownedObjects.data.length} objects:`);
      
      ownedObjects.data.forEach((obj, index) => {
        if (obj.data?.type) {
          console.log(`${index + 1}. Type: ${obj.data.type}`);
          console.log(`   Object ID: ${obj.data.objectId}`);
          
          if (obj.data.content?.dataType === 'moveObject') {
            const fields = (obj.data.content as any).fields;
            console.log(`   Fields:`, Object.keys(fields || {}));
          }
        }
      });
    } catch (error) {
      console.error('Error debugging wallet objects:', error);
    }
  }
}