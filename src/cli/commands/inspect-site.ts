import { Command } from 'commander';
import chalk from 'chalk';
import { SuiClient } from '@mysten/sui.js/client';

export function inspectSiteCommand(program: Command) {
  program
    .command('inspect-site')
    .description('Inspect a Walrus Site object to understand its structure')
    .argument('<site-id>', 'Site object ID to inspect')
    .action(async (siteId: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Inspecting Walrus Site: ${siteId}...`));
        
        const suiClient = new SuiClient({ url: config.rpcUrls[0] });
        
        // Get the site object with all details
        const siteObject = await suiClient.getObject({
          id: siteId,
          options: {
            showContent: true,
            showType: true,
            showOwner: true,
            showPreviousTransaction: true
          }
        });
        
        console.log('\nSite Object Type:', siteObject.data?.type);
        
        if (siteObject.data?.content?.dataType === 'moveObject') {
          const fields = (siteObject.data.content as any).fields;
          console.log('\nSite Fields:');
          console.log(JSON.stringify(fields, null, 2));
          
          // Check for dynamic fields (where resources might be stored)
          console.log(chalk.blue('\nChecking for dynamic fields...'));
          const dynamicFields = await suiClient.getDynamicFields({
            parentId: siteId
          });
          
          console.log(`Found ${dynamicFields.data.length} dynamic fields`);
          
          // Fetch each dynamic field
          for (const field of dynamicFields.data) {
            console.log(`\n${chalk.yellow('Dynamic field:')} ${JSON.stringify(field.name)}`);
            try {
              const fieldObject = await suiClient.getDynamicFieldObject({
                parentId: siteId,
                name: field.name
              });
              
              if (fieldObject.data?.content?.dataType === 'moveObject') {
                const fieldContent = (fieldObject.data.content as any).fields;
                console.log('Content:', JSON.stringify(fieldContent, null, 2));
                
                // Look for blob references
                const findBlobIds = (obj: any, path = ''): void => {
                  for (const [key, value] of Object.entries(obj)) {
                    if (key.includes('blob') || key.includes('resource')) {
                      console.log(chalk.green(`Found potential blob reference at ${path}.${key}:`, value));
                    }
                    if (typeof value === 'object' && value !== null) {
                      findBlobIds(value, `${path}.${key}`);
                    }
                  }
                };
                
                findBlobIds(fieldContent);
              }
            } catch (error) {
              console.error(`Error fetching dynamic field:`, error);
            }
          }
          
          // Also check the transaction that created the site
          if (siteObject.data.previousTransaction) {
            console.log(chalk.blue('\nChecking creation transaction...'));
            const tx = await suiClient.getTransactionBlock({
              digest: siteObject.data.previousTransaction,
              options: {
                showInput: true,
                showEffects: true,
                showEvents: true,
                showObjectChanges: true
              }
            });
            
            // Look for created objects in the same transaction
            if (tx.objectChanges) {
              console.log('\nObjects created in the same transaction:');
              for (const change of tx.objectChanges) {
                if (change.type === 'created' && change.objectType.includes('blob')) {
                  console.log(chalk.green(`- Blob: ${change.objectId}`));
                }
              }
            }
          }
        }

      } catch (error) {
        console.error(chalk.red(`Error inspecting site: ${error}`));
        process.exit(1);
      }
    });
}