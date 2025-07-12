import { Command } from 'commander';
import chalk from 'chalk';
import { WalrusClient } from '../../utils/walrus-client.js';
import { BlobClassifier } from '../../core/blob-classifier.js';
import { BlobCategory, BlobImportance } from '../../types/index.js';

export function classifyCommand(program: Command) {
  program
    .command('classify')
    .description('Classify and categorize blobs in a wallet')
    .argument('<address>', 'Wallet address to classify blobs for')
    .option('-c, --category <category>', 'Filter by specific category')
    .option('-i, --importance <importance>', 'Filter by importance level')
    .option('-j, --json', 'Output in JSON format')
    .option('-s, --summary', 'Show summary only')
    .option('--deletable', 'Show only deletable blobs')
    .option('--websites', 'Show only website blobs')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Classifying blobs for wallet: ${address}...`));
        
        const walrusClient = new WalrusClient(parentOptions?.aggregatorUrl || parentOptions?.aggregator, parentOptions?.rpcUrl || config.rpcUrls[0]);
        const classifier = new BlobClassifier(walrusClient);
        
        // Get all blobs for the wallet
        const blobs = await walrusClient.listBlobsForWallet(address);
        
        if (blobs.length === 0) {
          console.log(chalk.yellow('No blobs found in this wallet.'));
          return;
        }

        console.log(`Analyzing ${chalk.cyan(blobs.length.toString())} blobs...`);
        
        // Classify all blobs
        const classifications = await classifier.classifyBlobs(blobs);

        // Apply filters
        let filteredClassifications = classifications;
        
        if (options.category) {
          const targetCategory = options.category.toUpperCase() as BlobCategory;
          if (!Object.values(BlobCategory).includes(targetCategory)) {
            console.error(chalk.red(`Invalid category: ${options.category}`));
            console.log(`Valid categories: ${Object.values(BlobCategory).join(', ')}`);
            process.exit(1);
          }
          filteredClassifications = classifications.filter(c => c.category === targetCategory);
        }
        
        if (options.importance) {
          const targetImportance = options.importance.toUpperCase() as BlobImportance;
          if (!Object.values(BlobImportance).includes(targetImportance)) {
            console.error(chalk.red(`Invalid importance: ${options.importance}`));
            console.log(`Valid importance levels: ${Object.values(BlobImportance).join(', ')}`);
            process.exit(1);
          }
          filteredClassifications = classifications.filter(c => c.importance === targetImportance);
        }
        
        if (options.deletable) {
          filteredClassifications = classifications.filter(c => c.canDelete);
        }
        
        if (options.websites) {
          filteredClassifications = classifications.filter(c => c.category === BlobCategory.WEBSITE);
        }

        // JSON output
        if (options.json) {
          const output = {
            address,
            totalBlobs: classifications.length,
            filteredBlobs: filteredClassifications.length,
            summary: generateSummary(classifications),
            classifications: filteredClassifications
          };
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Summary output
        if (options.summary) {
          showSummary(classifications, address);
          return;
        }

        // Detailed output
        showDetailedClassification(filteredClassifications, classifications.length, address);

      } catch (error) {
        console.error(chalk.red(`Error classifying blobs: ${error}`));
        process.exit(1);
      }
    });
}

function generateSummary(classifications: any[]) {
  const summary = {
    totalBlobs: classifications.length,
    totalSize: classifications.reduce((sum, c) => sum + c.sizeBytes, 0),
    byCategory: {} as Record<string, number>,
    byImportance: {} as Record<string, number>,
    deletableCount: classifications.filter(c => c.canDelete).length,
    deletableSize: classifications.filter(c => c.canDelete).reduce((sum, c) => sum + c.sizeBytes, 0)
  };

  // Count by category
  Object.values(BlobCategory).forEach(category => {
    summary.byCategory[category] = classifications.filter(c => c.category === category).length;
  });

  // Count by importance
  Object.values(BlobImportance).forEach(importance => {
    summary.byImportance[importance] = classifications.filter(c => c.importance === importance).length;
  });

  return summary;
}

function showSummary(classifications: any[], address: string) {
  const summary = generateSummary(classifications);
  
  console.log(`\n${chalk.green('Classification Summary:')}`);
  console.log(`Wallet: ${chalk.cyan(address)}`);
  console.log(`Total Blobs: ${chalk.yellow(summary.totalBlobs.toString())}`);
  console.log(`Total Size: ${chalk.yellow(formatBytes(summary.totalSize))}`);
  console.log(`Deletable: ${chalk.red(summary.deletableCount.toString())} (${formatBytes(summary.deletableSize)})`);

  console.log(`\n${chalk.bold('By Category:')}`);
  Object.entries(summary.byCategory).forEach(([category, count]) => {
    if (count > 0) {
      console.log(`  ${chalk.cyan(category)}: ${count}`);
    }
  });

  console.log(`\n${chalk.bold('By Importance:')}`);
  Object.entries(summary.byImportance).forEach(([importance, count]) => {
    if (count > 0) {
      const color = getImportanceColor(importance as BlobImportance);
      console.log(`  ${color}: ${count}`);
    }
  });
}

function showDetailedClassification(
  classifications: any[], 
  totalBlobs: number, 
  address: string
) {
  console.log(`\n${chalk.green('Detailed Classification:')}`);
  console.log(`Wallet: ${chalk.cyan(address)}`);
  
  if (classifications.length !== totalBlobs) {
    console.log(`Showing: ${chalk.yellow(classifications.length.toString())} of ${chalk.yellow(totalBlobs.toString())} blobs`);
  } else {
    console.log(`Total: ${chalk.yellow(classifications.length.toString())} blobs`);
  }

  console.log('');

  classifications.forEach((classification, index) => {
    console.log(`${chalk.bold(`${index + 1}. ${classification.blobId}`)}`);
    
    // Category and subcategory
    let categoryDisplay = chalk.cyan(classification.category);
    if (classification.subcategory) {
      categoryDisplay += chalk.gray(` (${classification.subcategory})`);
    }
    console.log(`   Category: ${categoryDisplay}`);
    
    // Importance
    console.log(`   Importance: ${getImportanceColor(classification.importance)}`);
    
    // Size and cost
    console.log(`   Size: ${chalk.yellow(formatBytes(classification.sizeBytes))}`);
    if (classification.storageCost) {
      console.log(`   Cost: ${chalk.yellow(classification.storageCost.toString())} storage units`);
    }
    
    // Deletion status
    if (classification.canDelete) {
      console.log(`   ${chalk.red('✓ Can Delete')}: ${classification.deleteReason}`);
    } else {
      console.log(`   ${chalk.green('✗ Keep')}`);
    }
    
    // References
    if (classification.referencedBy.length > 0) {
      console.log(`   Referenced by: ${chalk.blue(classification.referencedBy.length.toString())} blob(s)`);
    }
    
    // Last accessed
    if (classification.lastAccessed) {
      const date = new Date(classification.lastAccessed);
      console.log(`   Last accessed: ${chalk.gray(date.toLocaleDateString())}`);
    }
    
    console.log('');
  });

  // Show totals for filtered results
  if (classifications.length > 0) {
    const totalSize = classifications.reduce((sum, c) => sum + c.sizeBytes, 0);
    const deletableCount = classifications.filter(c => c.canDelete).length;
    const deletableSize = classifications.filter(c => c.canDelete).reduce((sum, c) => sum + c.sizeBytes, 0);
    
    console.log(chalk.green('Summary of displayed results:'));
    console.log(`Total size: ${chalk.yellow(formatBytes(totalSize))}`);
    if (deletableCount > 0) {
      console.log(`Deletable: ${chalk.red(deletableCount.toString())} blobs (${formatBytes(deletableSize)})`);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getImportanceColor(importance: BlobImportance): string {
  switch (importance) {
    case BlobImportance.CRITICAL:
      return chalk.red.bold(importance);
    case BlobImportance.IMPORTANT:
      return chalk.red(importance);
    case BlobImportance.NORMAL:
      return chalk.yellow(importance);
    case BlobImportance.LOW:
      return chalk.gray(importance);
    case BlobImportance.DISPOSABLE:
      return chalk.gray.strikethrough(importance);
    default:
      return importance;
  }
}