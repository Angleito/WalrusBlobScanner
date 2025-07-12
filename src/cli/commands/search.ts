import { Command } from 'commander';
import chalk from 'chalk';
import { SuiNSResolver } from '../../core/suins-resolver.js';

export function searchCommand(program: Command) {
  program
    .command('search')
    .description('Search for domains and sites')
    .option('-d, --domain <keyword>', 'Search domains by keyword')
    .option('-a, --address <address>', 'Get domains owned by address')
    .option('-s, --site <site-id>', 'Get site information')
    .option('-j, --json', 'Output in JSON format')
    .action(async (options, command) => {
      const parentOptions = command.parent?.opts();
      const suinsResolver: SuiNSResolver = parentOptions?.suinsResolver;
      
      if (!suinsResolver) {
        console.error(chalk.red('Failed to initialize SuiNS resolver'));
        process.exit(1);
      }

      try {
        if (options.domain) {
          console.log(chalk.blue(`Searching domains containing: "${options.domain}"...`));
          
          const domains = await suinsResolver.searchDomainsByKeyword(options.domain);
          
          if (options.json) {
            console.log(JSON.stringify(domains, null, 2));
            return;
          }

          if (domains.length === 0) {
            console.log(chalk.yellow(`No domains found containing "${options.domain}"`));
            return;
          }

          console.log(`\n${chalk.green(`Found ${domains.length} matching domains:`)}\n`);

          domains.forEach((domain, index) => {
            console.log(`${chalk.bold(`${index + 1}. ${domain.name}`)}`);
            console.log(`   Object ID: ${chalk.cyan(domain.objectId)}`);
            console.log(`   Owner: ${chalk.yellow(domain.owner)}`);
            
            if (domain.targetSiteId) {
              console.log(`   Linked Site: ${chalk.green(domain.targetSiteId)}`);
            } else {
              console.log(`   Linked Site: ${chalk.red('Not linked')}`);
            }
            console.log('');
          });
        }

        if (options.address) {
          console.log(chalk.blue(`Getting domains owned by: ${options.address}...`));
          
          const domains = await suinsResolver.getDomainsForAddress(options.address);
          
          if (options.json) {
            console.log(JSON.stringify(domains, null, 2));
            return;
          }

          if (domains.length === 0) {
            console.log(chalk.yellow(`No domains found for address ${options.address}`));
            return;
          }

          console.log(`\n${chalk.green(`Found ${domains.length} domains:`)}\n`);

          domains.forEach((domain, index) => {
            console.log(`${chalk.bold(`${index + 1}. ${domain.name}`)}`);
            console.log(`   Object ID: ${chalk.cyan(domain.objectId)}`);
            
            if (domain.targetSiteId) {
              console.log(`   Linked Site: ${chalk.green(domain.targetSiteId)}`);
              console.log(`   Site URL: ${chalk.blue(`https://${domain.targetSiteId}.wal.app`)}`);
            } else {
              console.log(`   Linked Site: ${chalk.red('Not linked')}`);
            }
            console.log('');
          });
        }

        if (options.site) {
          console.log(chalk.blue(`Getting site information for: ${options.site}...`));
          
          const siteInfo = await suinsResolver.getSiteInfo(options.site);
          
          if (options.json) {
            console.log(JSON.stringify(siteInfo, null, 2));
            return;
          }

          if (!siteInfo) {
            console.log(chalk.red(`Site not found: ${options.site}`));
            return;
          }

          console.log(`\n${chalk.green('Site Information:')}\n`);
          console.log(`Object ID: ${chalk.cyan(options.site)}`);
          
          if (siteInfo.name) {
            console.log(`Name: ${chalk.green(siteInfo.name)}`);
          }
          
          if (siteInfo.blob_id) {
            console.log(`Blob ID: ${chalk.yellow(siteInfo.blob_id)}`);
          }
          
          if (siteInfo.owner) {
            console.log(`Owner: ${chalk.yellow(siteInfo.owner)}`);
          }

          console.log(`Site URL: ${chalk.blue(`https://${options.site}.wal.app`)}`);
        }

        if (!options.domain && !options.address && !options.site) {
          console.log(chalk.yellow('Please specify --domain, --address, or --site option'));
          console.log('Use --help for more information');
        }

      } catch (error) {
        console.error(chalk.red(`Error during search: ${error}`));
        process.exit(1);
      }
    });
}