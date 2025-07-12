import { Command } from 'commander';
import chalk from 'chalk';
import { BlobReader } from '../../core/blob-reader.js';

export function analyzeCommand(program: Command) {
  program
    .command('analyze')
    .description('Analyze a specific blob to check if it\'s a Walrus Site')
    .argument('<blob-id>', 'Blob ID to analyze')
    .option('-j, --json', 'Output in JSON format')
    .option('-v, --verbose', 'Verbose output')
    .action(async (blobId: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const blobReader: BlobReader = parentOptions?.blobReader;
      
      if (!blobReader) {
        console.error(chalk.red('Failed to initialize blob reader'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Analyzing blob: ${blobId}...`));
        
        const analysis = await blobReader.analyzeBlob(blobId);
        
        if (options.json) {
          console.log(JSON.stringify(analysis, null, 2));
          return;
        }

        console.log('\n' + chalk.bold('Analysis Results:'));
        console.log(`Blob ID: ${chalk.cyan(analysis.blobId)}`);
        console.log(`Content Type: ${chalk.yellow(analysis.contentType)}`);
        console.log(`Is Walrus Site: ${analysis.isWalrusSite ? chalk.green('Yes') : chalk.red('No')}`);

        if (analysis.isWalrusSite && analysis.siteInfo) {
          const site = analysis.siteInfo;
          console.log('\n' + chalk.bold('Site Information:'));
          console.log(`Name: ${chalk.green(site.name || 'Unnamed Site')}`);
          console.log(`Has index.html: ${site.hasIndexHtml ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`Resources: ${chalk.cyan(site.resources.length.toString())}`);
          
          if (site.isFileDirectory) {
            console.log(`Type: ${chalk.yellow('File Directory')}`);
          } else {
            console.log(`Type: ${chalk.yellow('Website')}`);
          }

          if (options.verbose && site.resources.length > 0) {
            console.log('\n' + chalk.bold('Resources:'));
            site.resources.forEach(resource => {
              console.log(`  ${chalk.cyan(resource.path)} (${resource.contentType})`);
            });
          }

          if (site.headers && Object.keys(site.headers).length > 0) {
            console.log('\n' + chalk.bold('Custom Headers:'));
            Object.entries(site.headers).forEach(([key, value]) => {
              console.log(`  ${chalk.cyan(key)}: ${value}`);
            });
          }
        }

        if (analysis.structure && options.verbose) {
          console.log('\n' + chalk.bold('Structure Analysis:'));
          console.log(`Has index.html: ${analysis.structure.hasIndexHtml ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`Has _headers: ${analysis.structure.hasHeaders ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`Resource count: ${chalk.cyan(analysis.structure.resourceCount.toString())}`);
          
          if (analysis.structure.directories.length > 0) {
            console.log(`Directories: ${analysis.structure.directories.map(d => chalk.yellow(d)).join(', ')}`);
          }
        }

      } catch (error) {
        console.error(chalk.red(`Error analyzing blob: ${error}`));
        process.exit(1);
      }
    });
}