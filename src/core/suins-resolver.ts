import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { SuiNSRecord, WalrusConfig } from '../types/index.js';
import { SUINS_PACKAGE } from '../config/walrus.js';

export class SuiNSResolver {
  private suiClient: SuiClient;
  private network: string;
  private suinsPackageId: string;

  constructor(config: WalrusConfig) {
    this.network = config.network;
    this.suiClient = new SuiClient({ url: config.rpcUrls[0] || getFullnodeUrl(config.network) });
    this.suinsPackageId = SUINS_PACKAGE[config.network as keyof typeof SUINS_PACKAGE] || SUINS_PACKAGE.mainnet;
  }

  async resolveDomain(domain: string): Promise<SuiNSRecord | null> {
    try {
      const domainName = domain.endsWith('.sui') ? domain : `${domain}.sui`;
      
      const response = await this.suiClient.getDynamicFields({
        parentId: await this.getSuiNSRegistry(),
        cursor: null,
        limit: 50
      });

      for (const field of response.data) {
        if (field.name.type.includes('Domain') && 
            field.name.value === domainName) {
          
          const domainObject = await this.suiClient.getObject({
            id: field.objectId,
            options: { showContent: true, showOwner: true }
          });

          if (domainObject.data?.content?.dataType === 'moveObject') {
            const fields = (domainObject.data.content as any).fields;
            
            return {
              name: domainName,
              domain: domainName,
              objectId: field.objectId,
              targetSiteId: this.extractTargetSite(fields),
              owner: this.extractOwner(domainObject.data.owner)
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Error resolving domain ${domain}:`, error);
      return null;
    }
  }

  async getDomainsForAddress(address: string): Promise<SuiNSRecord[]> {
    try {
      const ownedObjects = await this.suiClient.getOwnedObjects({
        owner: address,
        filter: {
          StructType: `${this.suinsPackageId}::domain::Domain`
        },
        options: { showContent: true }
      });

      const domains: SuiNSRecord[] = [];

      for (const obj of ownedObjects.data) {
        if (obj.data?.content?.dataType === 'moveObject') {
          const fields = (obj.data.content as any).fields;
          const domainName = this.extractDomainName(fields);
          
          if (domainName) {
            domains.push({
              name: domainName,
              domain: domainName,
              objectId: obj.data.objectId,
              targetSiteId: this.extractTargetSite(fields),
              owner: address
            });
          }
        }
      }

      return domains;
    } catch (error) {
      console.error(`Error getting domains for address ${address}:`, error);
      return [];
    }
  }

  async linkDomainToSite(domainObjectId: string, siteObjectId: string): Promise<boolean> {
    try {
      console.log(`Would link domain ${domainObjectId} to site ${siteObjectId}`);
      return true;
    } catch (error) {
      console.error('Error linking domain to site:', error);
      return false;
    }
  }

  async searchDomainsByKeyword(keyword: string): Promise<SuiNSRecord[]> {
    try {
      const registryId = await this.getSuiNSRegistry();
      const response = await this.suiClient.getDynamicFields({
        parentId: registryId,
        cursor: null,
        limit: 100
      });

      const matchingDomains: SuiNSRecord[] = [];

      for (const field of response.data) {
        if (field.name.type.includes('Domain')) {
          const domainName = field.name.value as string;
          
          if (domainName.toLowerCase().includes(keyword.toLowerCase())) {
            const domainObject = await this.suiClient.getObject({
              id: field.objectId,
              options: { showContent: true, showOwner: true }
            });

            if (domainObject.data?.content?.dataType === 'moveObject') {
              const fields = (domainObject.data.content as any).fields;
              
              matchingDomains.push({
                name: domainName,
                domain: domainName,
                objectId: field.objectId,
                targetSiteId: this.extractTargetSite(fields),
                owner: this.extractOwner(domainObject.data.owner)
              });
            }
          }
        }
      }

      return matchingDomains;
    } catch (error) {
      console.error(`Error searching domains by keyword ${keyword}:`, error);
      return [];
    }
  }

  async getWalrusSitesRegistry(): Promise<any[]> {
    try {
      const response = await this.suiClient.getOwnedObjects({
        owner: '0x2',
        options: { showContent: true }
      });

      return response.data.filter((obj: any) => 
        obj.data?.content?.dataType === 'moveObject' &&
        (obj.data.content as any).type?.includes('walrus_site')
      );
    } catch (error) {
      console.error('Error getting Walrus sites registry:', error);
      return [];
    }
  }

  private async getSuiNSRegistry(): Promise<string> {
    return '0x'; 
  }

  private extractDomainName(fields: any): string | null {
    return fields?.name?.fields?.name || fields?.domain_name || null;
  }

  private extractTargetSite(fields: any): string | undefined {
    return fields?.target_address || 
           fields?.data?.fields?.target_address ||
           fields?.walrus_site_id ||
           undefined;
  }

  private extractOwner(owner: any): string {
    if (typeof owner === 'string') return owner;
    if (owner?.AddressOwner) return owner.AddressOwner;
    if (owner?.ObjectOwner) return owner.ObjectOwner;
    return '';
  }

  async validateSiteObjectId(objectId: string): Promise<boolean> {
    try {
      const siteObject = await this.suiClient.getObject({
        id: objectId,
        options: { showContent: true }
      });

      return !!(siteObject.data?.content?.dataType === 'moveObject' &&
               (siteObject.data.content as any).type?.includes('walrus_site'));
    } catch {
      return false;
    }
  }

  async getSiteInfo(objectId: string): Promise<any> {
    try {
      const siteObject = await this.suiClient.getObject({
        id: objectId,
        options: { showContent: true }
      });

      if (siteObject.data?.content?.dataType === 'moveObject') {
        return (siteObject.data.content as any).fields;
      }

      return null;
    } catch (error) {
      console.error(`Error getting site info for ${objectId}:`, error);
      return null;
    }
  }
}