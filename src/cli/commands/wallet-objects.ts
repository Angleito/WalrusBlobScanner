import { Command } from 'commander';
import chalk from 'chalk';
import { SuiClient } from '@mysten/sui.js/client';

export function walletObjectsCommand(program: Command) {
  program
    .command('wallet-objects')
    .description('List all Walrus-related objects owned by a wallet')
    .argument('<address>', 'Wallet address to analyze')
    .option('-j, --json', 'Output in JSON format')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        if (!options.json) {
          console.log(chalk.blue(`Analyzing Walrus objects for wallet: ${address}...`));
        }
        
        const suiClient = new SuiClient({ url: parentOptions?.rpcUrl || config.rpcUrls[0] });
        
        // Get all owned objects
        const ownedObjects = await suiClient.getOwnedObjects({
          owner: address,
          options: {
            showContent: true,
            showType: true,
            showDisplay: true
          }
        });

        const walrusObjects = [];
        
        for (const obj of ownedObjects.data) {
          if (obj.data?.type) {
            const objectType = obj.data.type;
            
            // Check for any Walrus-related objects
            if (objectType.includes('blob') || 
                objectType.includes('Blob') ||
                objectType.includes('walrus') ||
                objectType.includes('site') ||
                objectType.includes('Site') ||
                objectType.includes('0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77') ||
                objectType.includes('0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27')) {
              
              const walrusObj = {
                objectId: obj.data.objectId,
                type: objectType,
                fields: null,
                display: obj.data.display?.data
              };
              
              if (obj.data.content?.dataType === 'moveObject') {
                walrusObj.fields = (obj.data.content as any).fields;
              }
              
              walrusObjects.push(walrusObj);
            }
          }
        }

        if (options.json) {
          console.log(JSON.stringify({
            address,
            totalObjects: ownedObjects.data.length,
            walrusObjects
          }, null, 2));
          return;
        }

        console.log(`\n${chalk.green('Summary:')}`);
        console.log(`Total objects owned: ${chalk.yellow(ownedObjects.data.length.toString())}`);
        console.log(`Walrus-related objects: ${chalk.cyan(walrusObjects.length.toString())}`);

        if (walrusObjects.length > 0) {
          console.log(`\n${chalk.green('Walrus Objects:')}\n`);
          
          // Group by type
          const byType = walrusObjects.reduce((acc, obj) => {
            const typeKey = obj.type.split('::').slice(-2).join('::');
            if (!acc[typeKey]) acc[typeKey] = [];
            acc[typeKey].push(obj);
            return acc;
          }, {} as Record<string, any[]>);

          Object.entries(byType).forEach(([type, objects]) => {
            console.log(chalk.bold(`${type} (${objects.length}):`));
            
            objects.forEach((obj, index) => {
              console.log(`\n${index + 1}. Object ID: ${chalk.cyan(obj.objectId)}`);
              console.log(`   Full Type: ${chalk.gray(obj.type)}`);
              
              if (obj.fields) {
                console.log(`   Fields:`);
                Object.entries(obj.fields).forEach(([key, value]) => {
                  if (key === 'id' || key === 'blob_id') {
                    // Handle blob ID conversion
                    let displayValue = value;
                    if (typeof value === 'string' && /^\d+$/.test(value)) {
                      const hex = '0x' + BigInt(value).toString(16).padStart(64, '0');
                      displayValue = `${value} (${hex})`;
                    }
                    console.log(`     ${key}: ${chalk.yellow(displayValue)}`);
                  } else if (typeof value === 'object' && value !== null) {
                    console.log(`     ${key}: ${chalk.gray('[object]')}`);
                  } else {
                    console.log(`     ${key}: ${chalk.yellow(value)}`);
                  }
                });
              }
              
              if (obj.display) {
                console.log(`   Display:`);
                Object.entries(obj.display).forEach(([key, value]) => {
                  console.log(`     ${key}: ${chalk.green(value)}`);
                });
              }

              // Add helpful links
              if (type.includes('site') || type.includes('Site')) {
                console.log(`   ${chalk.blue('View Site')}: https://wal.app/${obj.objectId}`);
              } else if (type.includes('blob') || type.includes('Blob')) {
                if (obj.fields?.blob_id || obj.fields?.id) {
                  const blobId = obj.fields.blob_id || obj.fields.id;
                  let hexId = blobId;
                  if (typeof blobId === 'string' && /^\d+$/.test(blobId)) {
                    hexId = BigInt(blobId).toString(16);
                  }
                  console.log(`   ${chalk.blue('View Blob')}: https://aggregator.walrus.space/v1/${hexId}`);
                }
              }
            });
            console.log('');
          });
        } else {
          console.log(chalk.yellow('\nNo Walrus objects found for this wallet.'));
        }

      } catch (error) {
        console.error(chalk.red(`Error analyzing wallet objects: ${error}`));
        process.exit(1);
      }
    });
}