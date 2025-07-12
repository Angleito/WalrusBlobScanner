import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { WalletTracker } from '../../core/wallet-tracker.js';
import { WalrusClient } from '../../utils/walrus-client.js';
import { BlobCategory, BlobImportance } from '../../types/index.js';
import { CLIValidator } from '../../utils/cli-validator.js';
import { CostEstimator } from '../../utils/cost-estimator.js';
import { DeletionExecutor } from '../../utils/deletion-executor.js';
import { WalrusSystemQuery } from '../../utils/walrus-system-query.js';

export function cleanupCommand(program: Command) {
  program
    .command('cleanup')
    .description('Interactive cleanup of wallet blobs with safety checks')
    .argument('<address>', 'Wallet address to clean up')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-d, --dry-run', 'Show what would be deleted without actually deleting')
    .option('--category <categories...>', 'Only consider specific categories for deletion')
    .option('--exclude-category <categories...>', 'Exclude specific categories from deletion')
    .option('--max-importance <importance>', 'Maximum importance level to delete', 'LOW')
    .option('--min-size <bytes>', 'Minimum blob size to consider for deletion')
    .option('--max-size <bytes>', 'Maximum blob size to consider for deletion')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue.bold('🧹 Walrus Blob Cleanup Tool\n'));
        
        // Step 1: Validate Environment
        console.log(chalk.blue('🔍 Validating environment...'));
        const validator = new CLIValidator();
        const validation = await validator.validateEnvironment();
        
        if (validation.errors.length > 0) {
          validator.displayValidationErrors(validation);
          process.exit(1);
        }
        
        console.log(chalk.green('✓ Environment validation passed'));
        console.log(chalk.gray(`  Active wallet: ${validation.activeAddress}`));
        console.log(chalk.gray(`  SUI balance: ${validation.suiBalance?.toFixed(4)} SUI\n`));
        
        const walletTracker = new WalletTracker(parentOptions?.rpcUrl || config.rpcUrls[0], parentOptions?.aggregatorUrl || parentOptions?.aggregator);
        const walrusClient = new WalrusClient(parentOptions?.aggregatorUrl || parentOptions?.aggregator, parentOptions?.rpcUrl || config.rpcUrls[0]);
        const costEstimator = new CostEstimator();
        const deletionExecutor = new DeletionExecutor();
        
        // Validate wallet address
        const isValid = await walletTracker.validateWalletAddress(address);
        if (!isValid) {
          console.error(chalk.red(`Invalid wallet address: ${address}`));
          process.exit(1);
        }

        // Step 2: Scan wallet for blobs and analyze for orphans
        console.log(chalk.blue('🔍 Scanning wallet for deletable blobs...'));
        const blobs = await walrusClient.listBlobsForWallet(address);
        
        if (blobs.length === 0) {
          console.log(chalk.yellow('No blobs found in this wallet.'));
          return;
        }

        console.log(`Found ${chalk.cyan(blobs.length.toString())} blobs total`);
        
        // Analyze for orphan blobs (not referenced by websites)
        console.log(chalk.blue('Analyzing for orphan blobs (not referenced by websites)...'));
        const systemQuery = new WalrusSystemQuery(parentOptions?.rpcUrl || config.rpcUrls[0], config.network);
        const walrusSites = await systemQuery.queryWalrusSites(address);
        
        // Get site blob IDs to protect them
        const siteBlobIds = new Set<string>();
        for (const site of walrusSites) {
          // Get dynamic fields for each site to find referenced blobs
          try {
            const siteBlobs = await systemQuery.getSiteBlobIds(site.suiObjectId || '');
            siteBlobs.forEach(blobId => siteBlobIds.add(blobId));
          } catch (error) {
            console.warn(chalk.yellow(`Could not analyze site ${site.suiObjectId}: ${error}`));
          }
        }
        
        // Filter for orphan blobs (not referenced by any site)
        const orphanBlobs = blobs.filter(blob => !siteBlobIds.has(blob.blobId));
        const protectedBlobs = blobs.filter(blob => siteBlobIds.has(blob.blobId));
        
        console.log(chalk.green(`✓ Identified ${chalk.cyan(orphanBlobs.length.toString())} orphan blobs eligible for deletion`));
        if (protectedBlobs.length > 0) {
          console.log(chalk.yellow(`⚠ ${protectedBlobs.length} blobs are protected (part of active websites)`));
        }
        
        if (orphanBlobs.length === 0) {
          console.log(chalk.green('\n🎉 No orphan blobs found! Your wallet is already clean.'));
          return;
        }

        // Step 3: Calculate deletion costs and refunds
        console.log(chalk.blue('\n💰 Calculating deletion costs and refunds...'));
        const costEstimates = await costEstimator.estimateDeletionCosts(orphanBlobs);
        const deletableBlobs = costEstimates.filter(estimate => estimate.deletable);
        const nonDeletableBlobs = costEstimates.filter(estimate => !estimate.deletable);
        
        if (deletableBlobs.length === 0) {
          console.log(chalk.red('\n❌ No deletable blobs found.'));
          if (nonDeletableBlobs.length > 0) {
            console.log(chalk.yellow('\nReasons blobs cannot be deleted:'));
            nonDeletableBlobs.forEach(blob => {
              console.log(chalk.yellow(`  • ${blob.blobId.slice(0, 8)}...: ${blob.reason}`));
            });
          }
          return;
        }
        
        const batchEstimate = await costEstimator.estimateBatchCosts(deletableBlobs);
        
        // Display cost analysis
        console.log(chalk.green.bold('\n💰 Deletion Cost Analysis:'));
        console.log(`Total Storage to Reclaim: ${chalk.cyan(batchEstimate.totalStorageRebate.toFixed(4))} SUI`);
        console.log(`Storage Rebate (99%): ${chalk.green((batchEstimate.totalStorageRebate * 0.99).toFixed(4))} SUI`);
        console.log(`Estimated Gas Costs: ${chalk.red(batchEstimate.totalEstimatedGas.toFixed(4))} SUI`);
        const netRefund = batchEstimate.totalNetRefund;
        const netRefundColor = netRefund > 0 ? chalk.green.bold : chalk.red.bold;
        console.log(`Net Refund: ${netRefundColor((netRefund > 0 ? '+' : '') + netRefund.toFixed(4))} SUI`);
        
        if (nonDeletableBlobs.length > 0) {
          console.log(chalk.yellow(`\n⚠ ${nonDeletableBlobs.length} blobs cannot be deleted (not created with --deletable flag)`));
        }

        // Handle dry-run mode
        if (options.dryRun) {
          console.log(chalk.blue.bold('\n🔬 DRY RUN MODE - No blobs will be deleted'));
          console.log('\nBlobs that would be deleted:');
          deletableBlobs.forEach((estimate, index) => {
            console.log(`${index + 1}. ${chalk.cyan(estimate.blobId)} (${estimate.netRefund > 0 ? '+' : ''}${estimate.netRefund.toFixed(4)} SUI net)`);
          });
          
          console.log(`\nBatch processing plan:`);
          batchEstimate.batches.forEach(batch => {
            console.log(`  Batch ${batch.batchNumber}: ${batch.blobCount} blobs → ${batch.netRefund > 0 ? '+' : ''}${batch.netRefund.toFixed(4)} SUI net`);
          });
          return;
        }

        // Step 4: Show detailed breakdown if requested
        const { showDetails } = await inquirer.prompt([{
          type: 'confirm',
          name: 'showDetails',
          message: 'Would you like to see a detailed breakdown of each blob?',
          default: false
        }]);

        if (showDetails) {
          console.log(chalk.blue.bold('\n📋 Detailed Blob Breakdown:'));
          deletableBlobs.forEach((estimate, index) => {
            const netColor = estimate.netRefund > 0 ? chalk.green : chalk.red;
            console.log(`${index + 1}. ${chalk.cyan(estimate.blobId)}`);
            console.log(`   Storage Rebate: ${chalk.green(estimate.storageRebate.toFixed(4))} SUI`);
            console.log(`   Gas Cost: ${chalk.red(estimate.estimatedGasCost.toFixed(4))} SUI`);
            console.log(`   Net Refund: ${netColor((estimate.netRefund > 0 ? '+' : '') + estimate.netRefund.toFixed(4))} SUI`);
          });
        }

        // Step 5: Processing method selection
        const { processingMethod } = await inquirer.prompt([{
          type: 'list',
          name: 'processingMethod',
          message: '🔧 How would you like to process the deletions?',
          choices: [
            { name: `Delete all ${deletableBlobs.length} blobs in optimal batches (recommended)`, value: 'batch' },
            { name: 'Review and select specific blobs to delete', value: 'selective' },
            { name: 'Delete one blob at a time with individual confirmation', value: 'individual' },
            { name: 'Cancel and exit', value: 'cancel' }
          ]
        }]);

        if (processingMethod === 'cancel') {
          console.log(chalk.yellow('Cleanup cancelled.'));
          return;
        }

        let blobsToProcess = deletableBlobs;

        if (processingMethod === 'selective') {
          const { selectedBlobs } = await inquirer.prompt([{
            type: 'checkbox',
            name: 'selectedBlobs',
            message: 'Select blobs to delete:',
            choices: deletableBlobs.map(estimate => ({
              name: `${estimate.blobId} (${estimate.netRefund > 0 ? '+' : ''}${estimate.netRefund.toFixed(4)} SUI net)`,
              value: estimate
            }))
          }]);
          blobsToProcess = selectedBlobs;
          
          if (blobsToProcess.length === 0) {
            console.log(chalk.yellow('No blobs selected for deletion.'));
            return;
          }
        }

        // Recalculate batch estimate for selected blobs
        const finalBatchEstimate = await costEstimator.estimateBatchCosts(blobsToProcess);
        
        // Step 6: Final confirmation
        console.log(chalk.blue.bold('\n📋 Deletion Summary:'));
        console.log(`- Blobs to delete: ${chalk.cyan(blobsToProcess.length.toString())} orphan blobs`);
        console.log(`- Processing method: ${processingMethod === 'batch' ? 
          `${finalBatchEstimate.batches.length} batches (${finalBatchEstimate.batches.map(b => b.blobCount).join(', ')} blobs)` :
          processingMethod === 'individual' ? 'individual confirmation' : 'selected blobs'}`);
        console.log(`- Expected net refund: ${finalBatchEstimate.totalNetRefund > 0 ? '+' : ''}${chalk.green(finalBatchEstimate.totalNetRefund.toFixed(4))} SUI`);
        console.log(`- Active wallet: ${chalk.cyan(validation.activeAddress?.slice(0, 10) + '...')}`);
        console.log(`- Current SUI balance: ${chalk.cyan(validation.suiBalance?.toFixed(4))} SUI`);

        console.log(chalk.yellow.bold('\n⚠ This action cannot be undone. Deleted blobs are permanently removed.'));

        if (!options.force) {
          const { finalConfirmation } = await inquirer.prompt([{
            type: 'confirm',
            name: 'finalConfirmation',
            message: 'Proceed with deletion?',
            default: false
          }]);

          if (!finalConfirmation) {
            console.log(chalk.yellow('Cleanup cancelled.'));
            return;
          }
        }

        // Step 7: Execute deletion with real-time tracking
        console.log(chalk.blue.bold('\n🚀 Starting deletion process...'));
        
        let totalGasUsed = 0;
        let totalRefundReceived = 0;
        let totalDeleted = 0;
        const allResults: any[] = [];
        const transactionHashes: string[] = [];

        if (processingMethod === 'individual') {
          // Individual deletion with confirmation
          for (let i = 0; i < blobsToProcess.length; i++) {
            const estimate = blobsToProcess[i];
            const { confirmBlob } = await inquirer.prompt([{
              type: 'confirm',
              name: 'confirmBlob',
              message: `Delete blob ${estimate.blobId}? (${estimate.netRefund > 0 ? '+' : ''}${estimate.netRefund.toFixed(4)} SUI net)`,
              default: true
            }]);

            if (confirmBlob) {
              console.log(chalk.blue(`Deleting blob ${i + 1}/${blobsToProcess.length}...`));
              const batchResult = await deletionExecutor.deleteBlobBatch([estimate], 1, false);
              allResults.push(...batchResult.results);
              totalGasUsed += batchResult.totalGasUsed;
              totalRefundReceived += batchResult.totalRefundReceived;
              totalDeleted += batchResult.results.filter(r => r.success).length;
              
              batchResult.results.forEach(r => {
                if (r.transactionHash) transactionHashes.push(r.transactionHash);
              });
            }
          }
        } else {
          // Batch deletion
          const batchSize = 10;
          for (let i = 0; i < finalBatchEstimate.batches.length; i++) {
            const batch = finalBatchEstimate.batches[i];
            const batchBlobs = blobsToProcess.slice((i) * batchSize, (i + 1) * batchSize);
            
            const batchResult = await deletionExecutor.deleteBlobBatch(batchBlobs, batch.batchNumber);
            allResults.push(...batchResult.results);
            totalGasUsed += batchResult.totalGasUsed;
            totalRefundReceived += batchResult.totalRefundReceived;
            totalDeleted += batchResult.results.filter(r => r.success).length;
            
            batchResult.results.forEach(r => {
              if (r.transactionHash) transactionHashes.push(r.transactionHash);
            });
          }
        }

        // Final Results
        const actualNetRefund = totalRefundReceived - totalGasUsed;
        const variance = actualNetRefund - finalBatchEstimate.totalNetRefund;
        
        console.log(chalk.green.bold('\n🎉 Cleanup Complete!'));
        console.log('==================');
        console.log(`Estimated Net Refund: ${finalBatchEstimate.totalNetRefund > 0 ? '+' : ''}${finalBatchEstimate.totalNetRefund.toFixed(4)} SUI`);
        console.log(`Actual Net Refund: ${actualNetRefund > 0 ? chalk.green('+') : chalk.red('')}${actualNetRefund.toFixed(4)} SUI`);
        
        const varianceColor = variance >= 0 ? chalk.green : chalk.red;
        console.log(`Variance: ${varianceColor((variance > 0 ? '+' : '') + variance.toFixed(4))} SUI ${variance >= 0 ? '(better than expected)' : '(higher cost than expected)'}`);
        
        console.log(`\nDeleted: ${chalk.green(totalDeleted.toString())}/${blobsToProcess.length} blobs`);
        console.log(`Gas Used: ${chalk.red(totalGasUsed.toFixed(4))} SUI`);
        console.log(`Storage Refunded: ${chalk.green(totalRefundReceived.toFixed(4))} SUI`);
        
        if (transactionHashes.length > 0) {
          console.log('\nTransaction Hashes:');
          transactionHashes.forEach((hash, index) => {
            console.log(`- Batch ${index + 1}: ${chalk.cyan(hash)}`);
          });
        }

        const failedResults = allResults.filter(r => !r.success);
        if (failedResults.length > 0) {
          console.log(chalk.red(`\n❌ ${failedResults.length} deletions failed:`));
          failedResults.forEach(failure => {
            console.log(chalk.red(`  • ${failure.blobId}: ${failure.error}`));
          });
        }

      } catch (error) {
        console.error(chalk.red(`Error during cleanup: ${error}`));
        process.exit(1);
      }
    });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}