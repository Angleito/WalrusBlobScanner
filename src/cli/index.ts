#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { BlobReader } from '../core/blob-reader.js';
import { WALRUS_CONFIGS } from '../config/walrus.js';
import { ConfigReader } from '../utils/config-reader.js';
import { scanCommand } from './commands/scan.js';
import { walletScanCommand } from './commands/wallet-scan.js';
import { cleanupCommand } from './commands/cleanup.js';

const program = new Command();

program
  .name('walscan')
  .description('A comprehensive CLI tool for scanning and cleaning up Walrus blob storage')
  .version('1.0.0');

program
  .option('-n, --network <network>', 'Network to use (mainnet, testnet, devnet)')
  .option('-a, --aggregator <url>', 'Walrus aggregator URL')
  .option('-r, --rpc <url>', 'Sui RPC URL')
  .hook('preAction', async (thisCommand) => {
    const options = thisCommand.opts();
    const configReader = new ConfigReader();
    
    // Check if CLI configs exist
    const { hasSuiConfig, hasWalrusConfig } = await configReader.hasCliConfigs();
    
    if (!hasSuiConfig && !hasWalrusConfig && !options.network) {
      console.log(chalk.yellow('No Sui or Walrus CLI configuration found.'));
      console.log(chalk.yellow('Using default configuration. You can specify network with -n option.'));
    }
    
    // Merge configurations with CLI overrides
    const mergedConfig = await configReader.mergeConfigurations({
      network: options.network,
      aggregatorUrl: options.aggregator,
      suiRpcUrl: options.rpc
    });
    
    // Validate network
    if (!WALRUS_CONFIGS[mergedConfig.network]) {
      console.error(chalk.red(`Unsupported network: ${mergedConfig.network}`));
      process.exit(1);
    }
    
    // Create instances with merged configuration
    const blobReader = new BlobReader(mergedConfig.aggregatorUrl);
    
    // Store configurations for commands
    thisCommand.setOptionValue('blobReader', blobReader);
    thisCommand.setOptionValue('config', mergedConfig.walrusConfig);
    thisCommand.setOptionValue('aggregatorUrl', mergedConfig.aggregatorUrl);
    thisCommand.setOptionValue('publisherUrl', mergedConfig.publisherUrl);
    thisCommand.setOptionValue('network', mergedConfig.network);
    thisCommand.setOptionValue('rpcUrl', mergedConfig.suiRpcUrl);
  });

// Core commands
scanCommand(program);
walletScanCommand(program);
cleanupCommand(program);

program
  .command('info')
  .description('Show configuration and network information')
  .action(async (options, command) => {
    const parentOptions = command.parent?.opts();
    const config = parentOptions?.config;
    const configReader = new ConfigReader();
    
    console.log(chalk.blue('\nWalrus Blob Scanner Configuration:'));
    console.log(chalk.blue('==================================\n'));
    
    // Check for CLI configs
    const { hasSuiConfig, hasWalrusConfig } = await configReader.hasCliConfigs();
    
    console.log(chalk.cyan('Configuration Sources:'));
    console.log(`  Sui CLI config: ${hasSuiConfig ? chalk.green('Found') : chalk.yellow('Not found')}`);
    console.log(`  Walrus CLI config: ${hasWalrusConfig ? chalk.green('Found') : chalk.yellow('Not found')}`);
    console.log('');
    
    console.log(chalk.cyan('Active Configuration:'));
    console.log(`  Network: ${chalk.green(parentOptions?.network || config?.network)}`);
    console.log(`  System Object: ${chalk.gray(config?.systemObject)}`);
    console.log(`  Staking Object: ${chalk.gray(config?.stakingObject)}`);
    console.log(`  Subsidies Object: ${chalk.gray(config?.subsidiesObject)}`);
    console.log(`  Package ID: ${chalk.gray(config?.packageId || 'Not set')}`);
    console.log('');
    
    console.log(chalk.cyan('Network Endpoints:'));
    console.log(`  Sui RPC: ${chalk.blue(parentOptions?.rpcUrl || config?.rpcUrls?.[0])}`);
    console.log(`  Aggregator URL: ${chalk.blue(parentOptions?.aggregatorUrl)}`);
    console.log(`  Publisher URL: ${chalk.blue(parentOptions?.publisherUrl)}`);
    console.log('');
    
    if (parentOptions?.aggregator) {
      console.log(chalk.yellow('Note: Using custom aggregator URL from command line'));
    }
    if (parentOptions?.rpc) {
      console.log(chalk.yellow('Note: Using custom RPC URL from command line'));
    }
    if (parentOptions?.network) {
      console.log(chalk.yellow('Note: Network override from command line'));
    }
  });

program.parse();