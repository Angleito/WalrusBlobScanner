import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { SuiNSResolver } from '../../core/suins-resolver.js';
import { BlobReader } from '../../core/blob-reader.js';

export function linkCommand(program: Command) {
  program
    .command('link')
    .description('Link a SuiNS domain to a Walrus Site')
    .option('-d, --domain <domain>', 'SuiNS domain name')
    .option('-s, --site <site-id>', 'Walrus Site object ID')
    .option('-b, --blob <blob-id>', 'Blob ID to analyze and link')
    .option('-i, --interactive', 'Interactive mode')
    .action(async (options, command) => {
      const parentOptions = command.parent?.opts();
      const suinsResolver: SuiNSResolver = parentOptions?.suinsResolver;
      const blobReader: BlobReader = parentOptions?.blobReader;
      
      if (!suinsResolver || !blobReader) {
        console.error(chalk.red('Failed to initialize resolvers'));
        process.exit(1);
      }

      try {
        let domain = options.domain;
        let siteId = options.site;
        let blobId = options.blob;

        if (options.interactive || (!domain && !siteId && !blobId)) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'domain',
              message: 'Enter SuiNS domain name:',
              when: !domain,
              validate: (input) => input.trim().length > 0 || 'Domain name is required'
            },
            {
              type: 'list',
              name: 'linkType',
              message: 'What would you like to link?',
              choices: [
                { name: 'Existing Walrus Site (Object ID)', value: 'site' },
                { name: 'Analyze Blob and Link', value: 'blob' }
              ],
              when: !siteId && !blobId
            },
            {
              type: 'input',
              name: 'siteId',
              message: 'Enter Walrus Site Object ID:',
              when: (answers) => answers.linkType === 'site' && !siteId,
              validate: (input) => input.trim().length > 0 || 'Site ID is required'
            },
            {
              type: 'input',
              name: 'blobId',
              message: 'Enter Blob ID to analyze:',
              when: (answers) => answers.linkType === 'blob' && !blobId,
              validate: (input) => input.trim().length > 0 || 'Blob ID is required'
            }
          ]);

          domain = domain || answers.domain;
          siteId = siteId || answers.siteId;
          blobId = blobId || answers.blobId;
        }

        console.log(chalk.blue(`Processing link request...`));

        let targetSiteId = siteId;

        if (blobId && !siteId) {
          console.log(chalk.blue(`Analyzing blob ${blobId}...`));
          const analysis = await blobReader.analyzeBlob(blobId);
          
          if (!analysis.isWalrusSite) {
            console.error(chalk.red(`Blob ${blobId} is not a Walrus Site`));
            process.exit(1);
          }

          console.log(chalk.green(`✓ Confirmed: Blob is a Walrus Site`));
          console.log(`Site Name: ${chalk.cyan(analysis.siteInfo?.name || 'Unnamed')}`);
          console.log(`Resources: ${chalk.cyan(analysis.siteInfo?.resources.length.toString() || '0')}`);

          if (analysis.siteInfo?.objectId) {
            targetSiteId = analysis.siteInfo.objectId;
          } else {
            console.error(chalk.red('Unable to determine site object ID from blob'));
            process.exit(1);
          }
        }

        if (!targetSiteId) {
          console.error(chalk.red('No site ID provided or determined'));
          process.exit(1);
        }

        console.log(chalk.blue(`Validating site object ${targetSiteId}...`));
        const isValidSite = await suinsResolver.validateSiteObjectId(targetSiteId);
        
        if (!isValidSite) {
          console.error(chalk.red(`Invalid Walrus Site object ID: ${targetSiteId}`));
          process.exit(1);
        }

        console.log(chalk.blue(`Resolving domain ${domain}...`));
        const existingRecord = await suinsResolver.resolveDomain(domain);
        
        if (existingRecord) {
          console.log(chalk.yellow(`⚠ Domain ${domain} is already registered`));
          console.log(`Current Owner: ${existingRecord.owner}`);
          
          if (existingRecord.targetSiteId) {
            console.log(`Currently Linked To: ${existingRecord.targetSiteId}`);
          }

          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Do you want to update the link?',
            default: false
          }]);

          if (!proceed) {
            console.log(chalk.yellow('Operation cancelled'));
            return;
          }
        }

        console.log(chalk.blue(`Linking domain ${domain} to site ${targetSiteId}...`));
        
        const success = await suinsResolver.linkDomainToSite(
          existingRecord?.objectId || domain, 
          targetSiteId
        );

        if (success) {
          console.log(chalk.green(`✓ Successfully linked ${domain} to Walrus Site`));
          console.log(`Domain: ${chalk.cyan(domain)}`);
          console.log(`Site ID: ${chalk.cyan(targetSiteId)}`);
          
          if (blobId) {
            console.log(`Blob ID: ${chalk.cyan(blobId)}`);
          }
          
          console.log(`\nSite should be accessible at:`);
          console.log(`  ${chalk.blue(`https://${domain.replace('.sui', '')}-wal.wal.app`)}`);
          console.log(`  ${chalk.blue(`https://${targetSiteId}.wal.app`)}`);
        } else {
          console.error(chalk.red('Failed to link domain to site'));
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red(`Error linking domain: ${error}`));
        process.exit(1);
      }
    });
}