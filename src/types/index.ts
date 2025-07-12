export interface WalrusConfig {
  network: 'mainnet' | 'testnet' | 'devnet';
  systemObject: string;
  stakingObject: string;
  subsidiesObject: string;
  rpcUrls: string[];
  packageId?: string;
}

export interface BlobInfo {
  blobId: string;
  size?: number;
  contentType?: string;
  isExpired: boolean;
  endEpoch?: number;
  isDeletable?: boolean;
  suiObjectId?: string;
  owner?: string;
  createdEpoch?: number;
  storageRebate?: number;
}

export interface WalrusSite {
  objectId: string;
  blobId: string;
  name?: string;
  description?: string;
  domain?: string;
  hasIndexHtml: boolean;
  resources: SiteResource[];
  headers?: Record<string, string>;
  isFileDirectory?: boolean;
}

export interface SiteResource {
  path: string;
  blobId: string;
  contentType?: string;
  size?: number;
}

export interface SuiNSRecord {
  name: string;
  domain: string;
  objectId: string;
  targetSiteId?: string;
  owner: string;
}

export interface BlobAnalysis {
  blobId: string;
  isWalrusSite: boolean;
  siteInfo?: WalrusSite;
  contentType: string;
  structure?: {
    hasIndexHtml: boolean;
    hasHeaders: boolean;
    resourceCount: number;
    directories: string[];
  };
  metadata?: Record<string, any>;
}

export interface RegistryEntry {
  id: string;
  blobId: string;
  objectId?: string;
  domain?: string;
  siteName?: string;
  discoveredAt: Date;
  lastVerified: Date;
  isActive: boolean;
}

export interface BlobClassification {
  blobId: string;
  category: BlobCategory;
  subcategory?: string;
  importance: BlobImportance;
  canDelete: boolean;
  deleteReason?: string;
  sizeBytes: number;
  storageCost?: number;
  referencedBy: string[];
  lastAccessed?: Date;
}

export enum BlobCategory {
  WEBSITE = 'website',
  IMAGE = 'image',
  DOCUMENT = 'document',
  ARCHIVE = 'archive',
  VIDEO = 'video',
  AUDIO = 'audio',
  DATA = 'data',
  CODE = 'code',
  UNKNOWN = 'unknown'
}

export enum BlobImportance {
  CRITICAL = 'critical',     // Active website or essential data
  IMPORTANT = 'important',   // Referenced or valuable content
  NORMAL = 'normal',         // Standard files
  LOW = 'low',              // Rarely accessed
  DISPOSABLE = 'disposable'  // Safe to delete
}

export interface WalletBlobSummary {
  address: string;
  totalBlobs: number;
  totalSize: number;
  totalCost: number;
  categories: Record<BlobCategory, number>;
  deletableBlobs: number;
  deletableSize: number;
  potentialSavings: number;
  websites: number;
  expiredBlobs: number;
}

export interface DeletionPlan {
  blobsToDelete: string[];
  totalSizeReduction: number;
  costSavings: number;
  categories: Record<BlobCategory, number>;
  warnings: string[];
}