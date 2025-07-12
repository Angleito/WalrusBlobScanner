import { WalrusConfig } from '../types/index.js';

export const WALRUS_CONFIGS: Record<string, WalrusConfig> = {
  mainnet: {
    network: 'mainnet',
    systemObject: '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2',
    stakingObject: '0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904',
    subsidiesObject: '0xb606eb177899edc2130c93bf65985af7ec959a2755dc126c953755e59324209e',
    rpcUrls: ['https://fullnode.mainnet.sui.io:443'],
    packageId: '0x6fb382ac9a32d0e351506e70b13d0a75abacb55c7c0d41b6b2b5b84f8e7c8b1c'
  },
  testnet: {
    network: 'testnet',
    systemObject: '0x',
    stakingObject: '0x',
    subsidiesObject: '0x',
    rpcUrls: ['https://fullnode.testnet.sui.io:443']
  }
};

export const DEFAULT_AGGREGATOR_URL = 'https://aggregator.walrus.space';
export const DEFAULT_PUBLISHER_URL = 'https://publisher.walrus.space';

export const WALRUS_SITES_PACKAGE = {
  mainnet: '0x6fb382ac9a32d0e351506e70b13d0a75abacb55c7c0d41b6b2b5b84f8e7c8b1c',
  testnet: '0x'
};

export const SUINS_PACKAGE = {
  mainnet: '0xd22b24490e0bae52676651b4f56660a5ff8022a2576e0089f79b3c88d44e08f0',
  testnet: '0x'
};