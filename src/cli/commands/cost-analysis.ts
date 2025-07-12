import { Command } from 'commander';
import chalk from 'chalk';
import { WalrusClient } from '../../utils/walrus-client.js';
import { BlobClassifier } from '../../core/blob-classifier.js';
import { WalletTracker } from '../../core/wallet-tracker.js';
import { BlobCategory } from '../../types/index.js';

export function costAnalysisCommand(program: Command) {
  program
    .command('cost-analysis')
    .description('Analyze storage costs and potential savings for a wallet')
    .argument('<address>', 'Wallet address to analyze')
    .option('-j, --json', 'Output in JSON format')
    .option('--projection <months>', 'Project costs for specified months', '12')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Analyzing storage costs for wallet: ${address}...`));
        
        const walletTracker = new WalletTracker(parentOptions?.rpcUrl || config.rpcUrls[0], parentOptions?.aggregatorUrl || parentOptions?.aggregator);
        const walrusClient = new WalrusClient(parentOptions?.aggregatorUrl || parentOptions?.aggregator, parentOptions?.rpcUrl || config.rpcUrls[0]);
        const classifier = new BlobClassifier(walrusClient);
        
        // Validate wallet address
        const isValid = await walletTracker.validateWalletAddress(address);
        if (!isValid) {
          console.error(chalk.red(`Invalid wallet address: ${address}`));
          process.exit(1);
        }

        // Get wallet summary and blobs
        const summary = await walletTracker.getWalletBlobSummary(address);
        const blobs = await walrusClient.listBlobsForWallet(address);
        const classifications = await classifier.classifyBlobs(blobs);

        // Calculate detailed cost analysis
        const analysis = calculateCostAnalysis(classifications, parseInt(options.projection));

        if (options.json) {
          console.log(JSON.stringify({
            address,
            summary,
            costAnalysis: analysis
          }, null, 2));
          return;
        }

        // Display cost analysis
        console.log(`\n${chalk.green('Storage Cost Analysis:')}`);
        console.log(`Wallet: ${chalk.cyan(address)}`);
        console.log(`Total Blobs: ${chalk.yellow(analysis.totalBlobs.toString())}`);
        console.log(`Total Storage: ${chalk.yellow(formatBytes(analysis.totalSize))}`);
        console.log(`Current Cost: ${chalk.yellow(analysis.currentCost.toString())} storage units`);

        console.log(`\n${chalk.bold('Cost by Category:')}`);
        Object.entries(analysis.costByCategory).forEach(([category, cost]) => {
          if (cost > 0) {
            console.log(`  ${chalk.cyan(category)}: ${cost} units`);
          }
        });

        console.log(`\n${chalk.bold('Potential Savings:')}`);
        console.log(`Deletable blobs: ${chalk.red(analysis.deletableBlobs.toString())}`);
        console.log(`Deletable storage: ${chalk.red(formatBytes(analysis.deletableSize))}`);
        console.log(`Immediate savings: ${chalk.green(analysis.immediateSavings.toString())} units`);
        console.log(`Savings percentage: ${chalk.green(analysis.savingsPercentage.toFixed(1))}%`);

        console.log(`\n${chalk.bold('Cost Projections:')}`);
        const projectionMonths = parseInt(options.projection);
        console.log(`${projectionMonths}-month projection:`);
        console.log(`  Current trajectory: ${chalk.yellow(analysis.projectedCost.toString())} units`);
        console.log(`  After cleanup: ${chalk.green(analysis.projectedCostAfterCleanup.toString())} units`);
        console.log(`  Total savings: ${chalk.green(analysis.projectedSavings.toString())} units`);

        console.log(`\n${chalk.bold('Efficiency Metrics:')}`);
        console.log(`Cost per MB: ${chalk.yellow(analysis.costPerMB.toFixed(4))} units/MB`);
        console.log(`Website efficiency: ${chalk.cyan(analysis.websiteEfficiency.toFixed(2))} MB/website`);
        
        if (analysis.largestBlobs.length > 0) {
          console.log(`\n${chalk.bold('Largest Storage Consumers:')}`);
          analysis.largestBlobs.slice(0, 5).forEach((blob, index) => {
            console.log(`${index + 1}. ${chalk.cyan(blob.category)} - ${formatBytes(blob.size)} (${blob.cost} units)`);
          });
        }

        console.log(`\n${chalk.bold('Recommendations:')}`);
        analysis.recommendations.forEach(rec => {
          const color = rec.priority === 'high' ? chalk.red : 
                       rec.priority === 'medium' ? chalk.yellow : chalk.gray;
          console.log(`• ${color(rec.message)}`);
        });

      } catch (error) {
        console.error(chalk.red(`Error analyzing costs: ${error}`));
        process.exit(1);
      }
    });
}

function calculateCostAnalysis(classifications: any[], projectionMonths: number) {
  const totalBlobs = classifications.length;
  const totalSize = classifications.reduce((sum, c) => sum + c.sizeBytes, 0);
  const currentCost = classifications.reduce((sum, c) => sum + (c.storageCost || 0), 0);
  
  const deletableBlobs = classifications.filter(c => c.canDelete);
  const deletableSize = deletableBlobs.reduce((sum, c) => sum + c.sizeBytes, 0);
  const immediateSavings = deletableBlobs.reduce((sum, c) => sum + (c.storageCost || 0), 0);
  
  const savingsPercentage = currentCost > 0 ? (immediateSavings / currentCost) * 100 : 0;
  
  // Cost by category
  const costByCategory: Record<string, number> = {};
  Object.values(BlobCategory).forEach(category => {
    costByCategory[category] = classifications
      .filter(c => c.category === category)
      .reduce((sum, c) => sum + (c.storageCost || 0), 0);
  });

  // Projections (assuming constant storage costs)
  const projectedCost = currentCost * projectionMonths;
  const projectedCostAfterCleanup = (currentCost - immediateSavings) * projectionMonths;
  const projectedSavings = projectedCost - projectedCostAfterCleanup;

  // Efficiency metrics
  const costPerMB = totalSize > 0 ? currentCost / (totalSize / (1024 * 1024)) : 0;
  const websiteBlobs = classifications.filter(c => c.category === BlobCategory.WEBSITE);
  const websiteSize = websiteBlobs.reduce((sum, c) => sum + c.sizeBytes, 0);
  const websiteEfficiency = websiteBlobs.length > 0 ? 
    (websiteSize / (1024 * 1024)) / websiteBlobs.length : 0;

  // Largest blobs
  const largestBlobs = classifications
    .map(c => ({
      blobId: c.blobId,
      category: c.category,
      size: c.sizeBytes,
      cost: c.storageCost || 0
    }))
    .sort((a, b) => b.size - a.size);

  // Generate recommendations
  const recommendations = generateCostRecommendations(
    classifications, 
    totalSize, 
    currentCost, 
    immediateSavings
  );

  return {
    totalBlobs,
    totalSize,
    currentCost,
    costByCategory,
    deletableBlobs: deletableBlobs.length,
    deletableSize,
    immediateSavings,
    savingsPercentage,
    projectedCost,
    projectedCostAfterCleanup,
    projectedSavings,
    costPerMB,
    websiteEfficiency,
    largestBlobs,
    recommendations
  };
}

function generateCostRecommendations(
  classifications: any[], 
  totalSize: number, 
  currentCost: number, 
  immediateSavings: number
) {
  const recommendations = [];

  // High savings potential
  if (immediateSavings > currentCost * 0.3) {
    recommendations.push({
      priority: 'high',
      message: `High savings potential: ${immediateSavings} units (${((immediateSavings / currentCost) * 100).toFixed(1)}%)`
    });
  }

  // Large expired blobs
  const expiredBlobs = classifications.filter(c => 
    c.deleteReason?.includes('expired') && c.sizeBytes > 10 * 1024 * 1024
  );
  if (expiredBlobs.length > 0) {
    recommendations.push({
      priority: 'high',
      message: `Remove ${expiredBlobs.length} large expired blob(s) immediately`
    });
  }

  // Many deletable items
  const deletableCount = classifications.filter(c => c.canDelete).length;
  if (deletableCount > 20) {
    recommendations.push({
      priority: 'medium',
      message: `Consider batch deletion of ${deletableCount} low-importance blobs`
    });
  }

  // Cost efficiency
  const costPerMB = totalSize > 0 ? currentCost / (totalSize / (1024 * 1024)) : 0;
  if (costPerMB > 1) {
    recommendations.push({
      priority: 'medium',
      message: 'High cost per MB - review storage strategy'
    });
  }

  // Website optimization
  const websiteBlobs = classifications.filter(c => c.category === BlobCategory.WEBSITE);
  const largeWebsites = websiteBlobs.filter(c => c.sizeBytes > 50 * 1024 * 1024);
  if (largeWebsites.length > 0) {
    recommendations.push({
      priority: 'low',
      message: `Optimize ${largeWebsites.length} large website(s) for better efficiency`
    });
  }

  // No savings
  if (immediateSavings === 0) {
    recommendations.push({
      priority: 'low',
      message: 'Storage is well-optimized - no immediate cleanup needed'
    });
  }

  return recommendations;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}