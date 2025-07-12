import { Command } from 'commander';
import chalk from 'chalk';
import { BlobReader } from '../../core/blob-reader.js';

export function scanCommand(program: Command) {
  program
    .command('scan')
    .description('Scan all blobs to find Walrus Sites')
    .option('-l, --limit <number>', 'Limit number of blobs to scan', '100')
    .option('-j, --json', 'Output in JSON format')
    .option('-s, --sites-only', 'Only show discovered sites')
    .action(async (options, command) => {
      const parentOptions = command.parent?.opts();
      const blobReader: BlobReader = parentOptions?.blobReader;
      
      if (!blobReader) {
        console.error(chalk.red('Failed to initialize blob reader'));
        process.exit(1);
      }

      try {
        const limit = parseInt(options.limit);
        console.log(chalk.blue(`Scanning blobs for Walrus Sites (limit: ${limit})...`));
        
        const sites = await blobReader.scanForWalrusSites(limit);
        
        if (options.json) {
          console.log(JSON.stringify(sites, null, 2));
          return;
        }

        if (sites.length === 0) {
          console.log(chalk.yellow('No Walrus Sites found in scanned blobs.'));
          return;
        }

        console.log(`\n${chalk.green(`Found ${sites.length} Walrus Sites:`)}\n`);

        sites.forEach((analysis, index) => {
          const site = analysis.siteInfo!;
          console.log(`${chalk.bold(`${index + 1}. ${site.name || 'Unnamed Site'}`)}`);
          console.log(`   Blob ID: ${chalk.cyan(site.blobId)}`);
          console.log(`   Type: ${site.isFileDirectory ? chalk.yellow('File Directory') : chalk.yellow('Website')}`);
          console.log(`   Resources: ${chalk.cyan(site.resources.length.toString())}`);
          
          if (site.domain) {
            console.log(`   Domain: ${chalk.green(site.domain)}`);
          }
          
          console.log(`   URL: ${chalk.blue(`https://${site.blobId}.wal.app`)}`);
          console.log('');
        });

        console.log(chalk.green(`\nTotal sites discovered: ${sites.length}`));
        
        const websiteCount = sites.filter(s => !s.siteInfo?.isFileDirectory).length;
        const directoryCount = sites.filter(s => s.siteInfo?.isFileDirectory).length;
        
        if (websiteCount > 0) {
          console.log(`Websites: ${chalk.cyan(websiteCount.toString())}`);
        }
        if (directoryCount > 0) {
          console.log(`File Directories: ${chalk.cyan(directoryCount.toString())}`);
        }

      } catch (error) {
        console.error(chalk.red(`Error scanning blobs: ${error}`));
        process.exit(1);
      }
    });
}