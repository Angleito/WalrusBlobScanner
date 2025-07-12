import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import { WalrusConfig } from '../types/index.js';

export interface SuiClientConfig {
  activeEnv?: string;
  envs?: Array<{
    alias: string;
    rpc: string;
    ws?: string;
  }>;
  activeAddress?: string;
  addresses?: Array<{
    alias: string;
    publicKey: string;
  }>;
}

export interface WalrusClientConfig {
  systemObject?: string;
  storeObject?: string;
  eventObject?: string;
  aggregatorUrl?: string;
  publisherUrl?: string;
  walrusSitesPackage?: string;
  network?: string;
  rpcUrl?: string;
}

export class ConfigReader {
  private homeDir: string;

  constructor() {
    this.homeDir = os.homedir();
  }

  /**
   * Read Sui client configuration
   * Standard locations: ~/.sui/sui_config/client.yaml
   */
  async readSuiConfig(): Promise<SuiClientConfig | null> {
    const configPaths = [
      path.join(this.homeDir, '.sui', 'sui_config', 'client.yaml'),
      path.join(this.homeDir, '.sui', 'client.yaml'), // Alternative location
    ];

    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf8');
          const config = yaml.load(content) as SuiClientConfig;
          return config;
        }
      } catch (error) {
        console.debug(`Failed to read Sui config from ${configPath}:`, error);
      }
    }

    return null;
  }

  /**
   * Read Walrus client configuration
   * Standard locations: ~/.walrus/client_config.yaml or ~/.config/walrus/client_config.yaml
   */
  async readWalrusConfig(): Promise<WalrusClientConfig | null> {
    const configPaths = [
      path.join(this.homeDir, '.walrus', 'client_config.yaml'),
      path.join(this.homeDir, '.config', 'walrus', 'client_config.yaml'),
      path.join(this.homeDir, '.walrus', 'config.yaml'), // Alternative naming
      path.join(this.homeDir, '.config', 'walrus', 'config.yaml'),
    ];

    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf8');
          const config = yaml.load(content) as WalrusClientConfig;
          return config;
        }
      } catch (error) {
        console.debug(`Failed to read Walrus config from ${configPath}:`, error);
      }
    }

    return null;
  }

  /**
   * Get active RPC URL from Sui config
   */
  getActiveRpcUrl(suiConfig: SuiClientConfig): string | null {
    if (!suiConfig.activeEnv || !suiConfig.envs) {
      return null;
    }

    const activeEnv = suiConfig.envs.find(env => env.alias === suiConfig.activeEnv);
    return activeEnv?.rpc || null;
  }

  /**
   * Detect network from RPC URL
   */
  detectNetworkFromRpc(rpcUrl: string): 'mainnet' | 'testnet' | 'devnet' {
    if (rpcUrl.includes('mainnet')) {
      return 'mainnet';
    } else if (rpcUrl.includes('testnet')) {
      return 'testnet';
    } else if (rpcUrl.includes('devnet') || rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')) {
      return 'devnet';
    }
    
    // Default to mainnet if can't detect
    return 'mainnet';
  }

  /**
   * Merge CLI configurations with fallback to defaults
   */
  async mergeConfigurations(overrides?: {
    network?: string;
    aggregatorUrl?: string;
    suiRpcUrl?: string;
  }): Promise<{
    network: 'mainnet' | 'testnet' | 'devnet';
    walrusConfig: WalrusConfig;
    aggregatorUrl: string;
    publisherUrl: string;
    suiRpcUrl: string;
  }> {
    // Read configurations
    const suiConfig = await this.readSuiConfig();
    const walrusConfig = await this.readWalrusConfig();

    // Determine network
    let network: 'mainnet' | 'testnet' | 'devnet' = 'mainnet';
    
    if (overrides?.network) {
      network = overrides.network as 'mainnet' | 'testnet' | 'devnet';
    } else if (walrusConfig?.network) {
      network = walrusConfig.network as 'mainnet' | 'testnet' | 'devnet';
    } else if (suiConfig) {
      const activeRpc = this.getActiveRpcUrl(suiConfig);
      if (activeRpc) {
        network = this.detectNetworkFromRpc(activeRpc);
      }
    }

    // Get RPC URL
    let suiRpcUrl = overrides?.suiRpcUrl;
    
    if (!suiRpcUrl && walrusConfig?.rpcUrl) {
      suiRpcUrl = walrusConfig.rpcUrl;
    }
    
    if (!suiRpcUrl && suiConfig) {
      suiRpcUrl = this.getActiveRpcUrl(suiConfig) || undefined;
    }
    
    if (!suiRpcUrl) {
      // Fallback to default RPC URLs
      const defaultRpcs = {
        mainnet: 'https://fullnode.mainnet.sui.io:443',
        testnet: 'https://fullnode.testnet.sui.io:443',
        devnet: 'https://fullnode.devnet.sui.io:443'
      };
      suiRpcUrl = defaultRpcs[network];
    }

    // Get aggregator URL
    const aggregatorUrl = overrides?.aggregatorUrl || 
                         walrusConfig?.aggregatorUrl || 
                         'https://aggregator.walrus.space';

    // Get publisher URL
    const publisherUrl = walrusConfig?.publisherUrl || 
                        'https://publisher.walrus.space';

    // Import default configs
    const { WALRUS_CONFIGS } = await import('../config/walrus.js');
    
    // Build final Walrus config
    const finalWalrusConfig: WalrusConfig = {
      network,
      systemObject: walrusConfig?.systemObject || WALRUS_CONFIGS[network]?.systemObject || '0x',
      stakingObject: walrusConfig?.storeObject || WALRUS_CONFIGS[network]?.stakingObject || '0x',
      subsidiesObject: walrusConfig?.eventObject || WALRUS_CONFIGS[network]?.subsidiesObject || '0x',
      rpcUrls: [suiRpcUrl],
      packageId: walrusConfig?.walrusSitesPackage || WALRUS_CONFIGS[network]?.packageId
    };

    return {
      network,
      walrusConfig: finalWalrusConfig,
      aggregatorUrl,
      publisherUrl,
      suiRpcUrl
    };
  }

  /**
   * Check if CLI configurations exist
   */
  async hasCliConfigs(): Promise<{
    hasSuiConfig: boolean;
    hasWalrusConfig: boolean;
  }> {
    const suiConfig = await this.readSuiConfig();
    const walrusConfig = await this.readWalrusConfig();

    return {
      hasSuiConfig: suiConfig !== null,
      hasWalrusConfig: walrusConfig !== null
    };
  }
}