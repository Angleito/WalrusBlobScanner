import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { BlobInfo } from '../../types/index.js';

export function walletDirectCommand(program: Command) {
  program
    .command('wallet-direct')
    .description('Use Walrus CLI directly to list blobs (requires configured wallet)')
    .option('-j, --json', 'Output in JSON format')
    .action(async (options) => {
      try {
        console.log(chalk.blue('Using Walrus CLI to list blobs...'));
        console.log(chalk.yellow('Note: This shows blobs for the currently configured Walrus wallet'));
        
        const blobs = await listBlobsViaCLI();
        
        if (options.json) {
          console.log(JSON.stringify(blobs, null, 2));
          return;
        }

        if (blobs.length === 0) {
          console.log(chalk.yellow('No blobs found for the configured wallet.'));
          console.log('Make sure you have:');
          console.log('1. Walrus CLI installed and in PATH');
          console.log('2. A wallet configured with `walrus generate-sui-wallet` or existing wallet');
          console.log('3. The wallet has created blobs on Walrus');
          return;
        }

        console.log(`\n${chalk.green(`Found ${blobs.length} blobs:`)}\n`);

        blobs.forEach((blob, index) => {
          console.log(`${chalk.bold(`${index + 1}. ${blob.blobId}`)}`);
          if (blob.size) {
            console.log(`   Size: ${chalk.yellow(formatBytes(blob.size))}`);
          }
          if (blob.endEpoch) {
            console.log(`   End Epoch: ${chalk.cyan(blob.endEpoch.toString())}`);
          }
          console.log(`   Deletable: ${blob.isDeletable ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`   Expired: ${blob.isExpired ? chalk.red('Yes') : chalk.green('No')}`);
          if (blob.suiObjectId) {
            console.log(`   Sui Object: ${chalk.gray(blob.suiObjectId)}`);
          }
          console.log('');
        });

        // Show summary
        const deletableCount = blobs.filter(b => b.isDeletable).length;
        const expiredCount = blobs.filter(b => b.isExpired).length;
        const totalSize = blobs.reduce((sum, b) => sum + (b.size || 0), 0);

        console.log(chalk.green('Summary:'));
        console.log(`Total size: ${chalk.yellow(formatBytes(totalSize))}`);
        console.log(`Deletable: ${chalk.red(deletableCount.toString())}`);
        console.log(`Expired: ${chalk.gray(expiredCount.toString())}`);

      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        console.log('\nTroubleshooting:');
        console.log('1. Ensure Walrus CLI is installed: https://docs.walrus.site/');
        console.log('2. Check if wallet is configured: walrus config');
        console.log('3. Verify network settings in ~/.config/walrus/client_config.yaml');
        process.exit(1);
      }
    });
}

async function listBlobsViaCLI(): Promise<BlobInfo[]> {
  return new Promise((resolve, reject) => {
    const walrusProcess = spawn('walrus', ['list-blobs', '--json'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    walrusProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    walrusProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    walrusProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Walrus CLI failed: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const blobs: BlobInfo[] = result.blobs?.map((blob: any) => ({
          blobId: blob.blob_id,
          size: blob.size,
          isExpired: blob.end_epoch ? blob.end_epoch < Date.now() / 1000 : false,
          endEpoch: blob.end_epoch,
          isDeletable: blob.deletable,
          suiObjectId: blob.sui_object_id
        })) || [];
        
        resolve(blobs);
      } catch (parseError) {
        reject(new Error(`Failed to parse walrus output: ${parseError}`));
      }
    });

    walrusProcess.on('error', (error) => {
      reject(new Error(`Failed to execute walrus CLI: ${error}`));
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}