import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs/promises';
import { WalrusClient } from '../../utils/walrus-client.js';
import { BlobClassifier } from '../../core/blob-classifier.js';
import { WalletTracker } from '../../core/wallet-tracker.js';

export function inventoryCommand(program: Command) {
  program
    .command('inventory')
    .description('Generate and export complete blob inventory for a wallet')
    .argument('<address>', 'Wallet address to inventory')
    .option('-o, --output <file>', 'Output file path (default: wallet-inventory-{address}.json)')
    .option('-f, --format <format>', 'Output format (json, csv)', 'json')
    .option('--include-content', 'Include blob content analysis in inventory')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Creating inventory for wallet: ${address}...`));
        
        const walrusClient = new WalrusClient(parentOptions?.aggregatorUrl || parentOptions?.aggregator, parentOptions?.rpcUrl || config.rpcUrls[0]);
        const classifier = new BlobClassifier(walrusClient);
        const walletTracker = new WalletTracker(parentOptions?.rpcUrl || config.rpcUrls[0], parentOptions?.aggregatorUrl || parentOptions?.aggregator);
        
        // Validate wallet address
        const isValid = await walletTracker.validateWalletAddress(address);
        if (!isValid) {
          console.error(chalk.red(`Invalid wallet address: ${address}`));
          process.exit(1);
        }

        // Get wallet summary
        console.log(chalk.blue('Gathering wallet summary...'));
        const summary = await walletTracker.getWalletBlobSummary(address);
        
        // Get all blobs
        console.log(chalk.blue('Retrieving blob information...'));
        const blobs = await walrusClient.listBlobsForWallet(address);
        
        if (blobs.length === 0) {
          console.log(chalk.yellow('No blobs found in this wallet.'));
          return;
        }

        // Classify blobs
        console.log(chalk.blue(`Classifying ${blobs.length} blobs...`));
        const classifications = await classifier.classifyBlobs(blobs);

        // Create comprehensive inventory
        const inventory = {
          metadata: {
            walletAddress: address,
            generatedAt: new Date().toISOString(),
            toolVersion: '1.0.0',
            totalBlobs: blobs.length,
            totalClassified: classifications.length
          },
          summary,
          blobs: classifications.map(classification => ({
            blobId: classification.blobId,
            category: classification.category,
            subcategory: classification.subcategory,
            importance: classification.importance,
            size: classification.sizeBytes,
            storageCost: classification.storageCost,
            canDelete: classification.canDelete,
            deleteReason: classification.deleteReason,
            referencedBy: classification.referencedBy,
            lastAccessed: classification.lastAccessed,
            // Add blob info details
            isExpired: blobs.find(b => b.blobId === classification.blobId)?.isExpired,
            isDeletable: blobs.find(b => b.blobId === classification.blobId)?.isDeletable,
            endEpoch: blobs.find(b => b.blobId === classification.blobId)?.endEpoch,
            suiObjectId: blobs.find(b => b.blobId === classification.blobId)?.suiObjectId
          }))
        };

        // Add content analysis if requested
        if (options.includeContent) {
          console.log(chalk.blue('Adding content analysis...'));
          
          for (let i = 0; i < inventory.blobs.length; i++) {
            const blob = inventory.blobs[i];
            try {
              if (blob.category === 'website') {
                // Get website-specific details
                const content = await walrusClient.readBlob(blob.blobId);
                // Add website analysis here if needed
                (blob as any).contentPreview = content.toString('utf8', 0, 200);
              }
            } catch (error) {
              console.warn(`Could not analyze content for blob ${blob.blobId}`);
            }
            
            // Progress indicator
            if (i % 10 === 0 || i === inventory.blobs.length - 1) {
              process.stdout.write(`\rAnalyzing content: ${i + 1}/${inventory.blobs.length}`);
            }
          }
          console.log(''); // New line
        }

        // Determine output file
        const timestamp = new Date().toISOString().split('T')[0];
        const defaultFilename = `wallet-inventory-${address.slice(0, 8)}-${timestamp}.${options.format}`;
        const outputFile = options.output || defaultFilename;

        // Export in requested format
        if (options.format === 'csv') {
          await exportToCsv(inventory, outputFile);
        } else {
          await exportToJson(inventory, outputFile);
        }

        // Show summary
        console.log(`\n${chalk.green('Inventory completed!')}`);
        console.log(`Wallet: ${chalk.cyan(address)}`);
        console.log(`Total blobs: ${chalk.yellow(inventory.metadata.totalBlobs.toString())}`);
        console.log(`Classified: ${chalk.yellow(inventory.metadata.totalClassified.toString())}`);
        console.log(`Output file: ${chalk.cyan(outputFile)}`);
        
        // Show quick stats
        const websites = inventory.blobs.filter(b => b.category === 'website').length;
        const deletable = inventory.blobs.filter(b => b.canDelete).length;
        const totalSize = inventory.blobs.reduce((sum, b) => sum + b.size, 0);
        
        console.log(`\nQuick stats:`);
        console.log(`  Websites: ${chalk.green(websites.toString())}`);
        console.log(`  Deletable: ${chalk.red(deletable.toString())}`);
        console.log(`  Total size: ${chalk.yellow(formatBytes(totalSize))}`);

      } catch (error) {
        console.error(chalk.red(`Error creating inventory: ${error}`));
        process.exit(1);
      }
    });
}

async function exportToJson(inventory: any, outputFile: string) {
  await fs.writeFile(outputFile, JSON.stringify(inventory, null, 2), 'utf8');
}

async function exportToCsv(inventory: any, outputFile: string) {
  const csvHeader = [
    'blobId',
    'category',
    'subcategory',
    'importance',
    'size',
    'storageCost',
    'canDelete',
    'deleteReason',
    'referencedByCount',
    'isExpired',
    'isDeletable',
    'endEpoch',
    'suiObjectId'
  ].join(',');

  const csvRows = inventory.blobs.map((blob: any) => [
    blob.blobId,
    blob.category,
    blob.subcategory || '',
    blob.importance,
    blob.size,
    blob.storageCost || '',
    blob.canDelete,
    blob.deleteReason || '',
    blob.referencedBy.length,
    blob.isExpired || false,
    blob.isDeletable || false,
    blob.endEpoch || '',
    blob.suiObjectId || ''
  ].map(field => {
    // Escape CSV fields that contain commas or quotes
    if (typeof field === 'string' && (field.includes(',') || field.includes('"'))) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }).join(','));

  const csvContent = [csvHeader, ...csvRows].join('\n');
  await fs.writeFile(outputFile, csvContent, 'utf8');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}