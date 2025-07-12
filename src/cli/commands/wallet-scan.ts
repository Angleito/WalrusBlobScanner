import { Command } from 'commander';
import chalk from 'chalk';
import { WalletTracker } from '../../core/wallet-tracker.js';
import { WalrusClient } from '../../utils/walrus-client.js';
import { BlobClassifier } from '../../core/blob-classifier.js';
import { BlobCategory, BlobImportance } from '../../types/index.js';
import { WalrusSystemQuery } from '../../utils/walrus-system-query.js';
import { SuiClient } from '@mysten/sui.js/client';
import { SUINS_PACKAGE } from '../../config/walrus.js';

export function walletScanCommand(program: Command) {
  program
    .command('wallet-scan')
    .description('Scan a specific wallet for blobs and analyze storage usage')
    .argument('<address>', 'Wallet address to scan')
    .option('-j, --json', 'Output in JSON format')
    .option('-v, --verbose', 'Show detailed blob information')
    .option('-c, --category <category>', 'Filter by blob category')
    .option('-w, --websites-only', 'Show only website blobs')
    .option('-d, --deletable-only', 'Show only deletable blobs')
    .option('--debug', 'Show debug information about wallet objects')
    .action(async (address: string, options, command) => {
      const parentOptions = command.parent?.opts();
      const config = parentOptions?.config;
      
      if (!config) {
        console.error(chalk.red('Configuration not available'));
        process.exit(1);
      }

      try {
        console.log(chalk.blue(`Scanning wallet: ${address}...`));
        
        const walletTracker = new WalletTracker(parentOptions?.rpcUrl || config.rpcUrls[0], parentOptions?.aggregatorUrl || parentOptions?.aggregator);
        
        // Validate wallet address
        const isValid = await walletTracker.validateWalletAddress(address);
        if (!isValid) {
          console.error(chalk.red(`Invalid wallet address: ${address}`));
          process.exit(1);
        }

        // Debug mode - show all objects owned by wallet
        if (options.debug) {
          const systemQuery = new WalrusSystemQuery(parentOptions?.rpcUrl || config.rpcUrls[0], config.network);
          await systemQuery.debugWalletObjects(address);
        }

        // Try alternative query method first
        console.log(chalk.blue('Checking for Walrus Sites...'));
        const systemQuery = new WalrusSystemQuery(parentOptions?.rpcUrl || config.rpcUrls[0], config.network);
        const walrusSites = await systemQuery.queryWalrusSites(address);
        
        if (walrusSites.length > 0) {
          console.log(chalk.green(`Found ${walrusSites.length} Walrus Site(s)`));
          walrusSites.forEach((site, index) => {
            console.log(`${index + 1}. Site Object: ${site.suiObjectId}`);
            console.log(`   Blob ID: ${site.blobId}`);
            console.log(`   View: https://wal.app/${site.suiObjectId}`);
          });
        }

        // Get all blobs for the wallet
        const walrusClient = new WalrusClient(parentOptions?.aggregatorUrl || parentOptions?.aggregator, parentOptions?.rpcUrl || config.rpcUrls[0]);
        const allBlobs = await walrusClient.listBlobsForWallet(address);
        
        // Get site blob IDs if we have sites
        const siteBlobIds = new Set<string>();
        const siteResourceMap = new Map<string, { site: string, path: string, type: string }>();
        const suinsDomains = new Map<string, string>(); // site object ID -> domain name
        
        if (walrusSites.length > 0) {
          console.log(chalk.yellow(`\nAnalyzing Walrus Site(s) to identify associated blobs...`));
          
          const suiClient = new SuiClient({ url: parentOptions?.rpcUrl || config.rpcUrls[0] });
          
          for (const site of walrusSites) {
            try {
              // Get dynamic fields for each site
              const dynamicFields = await suiClient.getDynamicFields({
                parentId: site.suiObjectId || ''
              });
              
              console.log(`Site ${site.suiObjectId || 'unknown'} has ${dynamicFields.data.length} resources`);
              
              // Fetch each dynamic field to get blob IDs
              for (const field of dynamicFields.data) {
                try {
                  const fieldObject = await suiClient.getDynamicFieldObject({
                    parentId: site.suiObjectId || '',
                    name: field.name
                  });
                  
                  if (fieldObject.data?.content?.dataType === 'moveObject') {
                    const fieldContent = (fieldObject.data.content as any).fields;
                    const resourceBlobId = fieldContent?.value?.fields?.blob_id;
                    const resourcePath = fieldContent?.value?.fields?.path || fieldContent?.name?.fields?.path;
                    
                    if (resourceBlobId) {
                      // Convert decimal to hex
                      let hexId: string;
                      if (typeof resourceBlobId === 'string' && /^\d+$/.test(resourceBlobId)) {
                        hexId = '0x' + BigInt(resourceBlobId).toString(16).padStart(64, '0');
                      } else if (typeof resourceBlobId === 'number') {
                        hexId = '0x' + BigInt(resourceBlobId).toString(16).padStart(64, '0');
                      } else {
                        hexId = resourceBlobId;
                      }
                      siteBlobIds.add(hexId);
                      
                      // Store resource info
                      const headers = fieldContent?.value?.fields?.headers?.fields?.contents;
                      let contentType = 'unknown';
                      if (headers && Array.isArray(headers)) {
                        const typeHeader = headers.find(h => h.fields?.key?.toLowerCase() === 'content-type');
                        if (typeHeader) {
                          contentType = typeHeader.fields.value;
                        }
                      }
                      
                      siteResourceMap.set(hexId, {
                        site: site.suiObjectId || '',
                        path: resourcePath || 'unknown',
                        type: contentType
                      });
                    }
                  }
                } catch (error) {
                  // Silently continue if we can't fetch a field
                }
              }
            } catch (error) {
              console.warn(`Could not analyze site ${site.suiObjectId}: ${error}`);
            }
          }
          
          console.log(`Identified ${siteBlobIds.size} blobs belonging to Walrus Site(s)`);
          
          // Try to detect SuiNS domain linking by querying the blockchain
          console.log(chalk.blue('Checking for SuiNS domain linking...'));
          for (const site of walrusSites) {
            try {
              const linkedDomain = await findSuiNSDomainForSite(suiClient, site.suiObjectId || '', config);
              if (linkedDomain) {
                suinsDomains.set(site.suiObjectId || '', linkedDomain);
                console.log(`Detected SuiNS domain: ${chalk.cyan(linkedDomain)} -> ${chalk.gray(site.suiObjectId || '')}`);
              } else {
                console.log(chalk.gray(`No SuiNS domain owned by this wallet found for site ${site.suiObjectId?.slice(0, 8) || 'unknown'}...`));
                console.log(chalk.gray(`Site may be linked to a domain owned by a different wallet`));
              }
            } catch (error) {
              console.log(chalk.gray(`Could not check for SuiNS domain: ${error}`));
            }
          }
          
          // Mark site blobs as non-deletable and enrich with metadata
          for (const blob of allBlobs) {
            if (siteBlobIds.has(blob.blobId)) {
              blob.isDeletable = false;
              const resourceInfo = siteResourceMap.get(blob.blobId);
              if (resourceInfo) {
                blob.contentType = resourceInfo.type;
              }
            }
          }
        }
        
        // Update the wallet tracker to use our modified blob list
        const summary = await walletTracker.getWalletBlobSummaryFromBlobs(address, allBlobs);
        
        if (options.json && !options.verbose) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        // Display summary
        console.log(`\n${chalk.green('Wallet Storage Summary:')}`);
        console.log(`Address: ${chalk.cyan(address)}`);
        console.log(`Total Blobs: ${chalk.yellow(summary.totalBlobs.toString())}`);
        const totalSizeDisplay = summary.totalSize > 0 ? formatBytes(summary.totalSize) : 'Unknown';
        console.log(`Total Size: ${chalk.yellow(totalSizeDisplay)}`);
        
        // Show the Walrus Sites info if found
        console.log(`Walrus Sites: ${chalk.green(walrusSites.length.toString())}`);
        console.log(`Walrus Blobs: ${chalk.cyan(summary.totalBlobs.toString())}`);
        console.log(`Deletable: ${chalk.red(summary.deletableBlobs.toString())} ${summary.deletableSize > 0 ? `(${formatBytes(summary.deletableSize)})` : ''}`);
        console.log(`Expired: ${chalk.gray(summary.expiredBlobs.toString())}`);

        // Show categories if any are non-unknown
        const nonUnknownCategories = Object.entries(summary.categories).filter(([cat, count]) => cat !== 'unknown' && count > 0);
        if (nonUnknownCategories.length > 0) {
          console.log(`\n${chalk.bold('By Category:')}`);
          nonUnknownCategories.forEach(([category, count]) => {
            console.log(`  ${chalk.cyan(category)}: ${count}`);
          });
        }

        if (options.verbose) {
          // Use the already fetched and modified blobs
          console.log(chalk.blue(`\nAnalyzing ${allBlobs.length} individual blobs...`));
          
          // For now, show blob info without trying to classify (since aggregator can't reach them)
          const blobDetails = allBlobs.map(blob => ({
            blobId: blob.blobId,
            size: blob.size || 0,
            isDeletable: blob.isDeletable,
            isExpired: blob.isExpired,
            endEpoch: blob.endEpoch,
            suiObjectId: blob.suiObjectId
          }));

          // Apply filters
          let filteredBlobs = blobDetails;
          
          if (options.deletableOnly) {
            filteredBlobs = blobDetails.filter(b => b.isDeletable);
          }

          if (options.json) {
            console.log(JSON.stringify({
              summary,
              walrusSites,
              blobs: filteredBlobs
            }, null, 2));
            return;
          }

          // Display detailed results
          console.log(`\n${chalk.green(`Blob Details:`)}\n`);

          filteredBlobs.forEach((blob, index) => {
            console.log(`${chalk.bold(`${index + 1}. ${blob.blobId}`)}`);
            console.log(`   Size: ${chalk.yellow(blob.size > 0 ? formatBytes(blob.size) : 'Unknown')}`);
            console.log(`   Deletable: ${blob.isDeletable ? chalk.green('Yes') : chalk.red('No')}`);
            console.log(`   Expired: ${blob.isExpired ? chalk.red('Yes') : chalk.green('No')}`);
            if (blob.endEpoch) {
              console.log(`   End Epoch: ${chalk.cyan(blob.endEpoch.toString())}`);
            }
            console.log(`   Sui Object: ${chalk.gray(blob.suiObjectId)}`);
            console.log('');
          });

          // Show summary
          const totalKnownSize = filteredBlobs.reduce((sum, b) => sum + b.size, 0);
          const deletableCount = filteredBlobs.filter(b => b.isDeletable).length;
          
          if (filteredBlobs.length !== blobDetails.length) {
            console.log(chalk.green(`Filtered Results Summary:`));
            console.log(`Showing: ${filteredBlobs.length} of ${blobDetails.length} blobs`);
          }
          
          if (totalKnownSize > 0) {
            console.log(`Total Size (known): ${chalk.yellow(formatBytes(totalKnownSize))}`);
          }
          console.log(`Deletable: ${chalk.red(deletableCount.toString())} blobs`);
        }

        // Generate comprehensive report
        console.log(`\n${chalk.bold.blue('=== WALRUS STORAGE ANALYSIS REPORT ===')}`);
        
        // Site Analysis
        if (walrusSites.length > 0) {
          console.log(`\n${chalk.bold.green('Walrus Sites Analysis:')}`);
          console.log(`Total Sites: ${chalk.cyan(walrusSites.length.toString())}`);
          
          // Show SuiNS domain information
          for (const site of walrusSites) {
            const domain = suinsDomains.get(site.suiObjectId || '');
            if (domain) {
              console.log(`SuiNS Domain: ${chalk.cyan(domain)}`);
              console.log(`Live Site: ${chalk.blue(`https://${domain.replace('.sui', '.wal.app')}`)}`);
            }
          }
          
          // Calculate site blob sizes (only for blobs actually in wallet)
          let siteStorageSize = 0;
          let actualSiteBlobCount = 0;
          for (const blob of allBlobs) {
            if (siteBlobIds.has(blob.blobId)) {
              siteStorageSize += blob.size || 0;
              actualSiteBlobCount++;
            }
          }
          
          console.log(`\nBlob Analysis:`);
          console.log(`User Content Blobs: ${chalk.cyan(actualSiteBlobCount.toString())} (in your wallet)`);
          console.log(`System/Infrastructure Blobs: ${chalk.gray((siteBlobIds.size - actualSiteBlobCount).toString())} (managed by SuiNS/Walrus)`);
          console.log(`Total Site Resources: ${chalk.cyan(siteBlobIds.size.toString())}`);
          console.log(`Your Storage: ${chalk.cyan(formatBytes(siteStorageSize))}`);
          
          // Site resource breakdown (only for resources with blobs in wallet)
          const resourceTypes = new Map<string, number>();
          for (const blob of allBlobs) {
            if (siteBlobIds.has(blob.blobId)) {
              const info = siteResourceMap.get(blob.blobId);
              if (info) {
                const type = info.type.split(';')[0].trim();
                resourceTypes.set(type, (resourceTypes.get(type) || 0) + 1);
              }
            }
          }
          
          if (resourceTypes.size > 0) {
            console.log(`\n${chalk.bold('Your Content by Type:')}`);
            for (const [type, count] of resourceTypes) {
              console.log(`  ${type}: ${count}`);
            }
          }
        }
        
        // Storage Analysis
        console.log(`\n${chalk.bold.green('Storage Analysis:')}`);
        
        // Count actual site blobs found in wallet
        const actualSiteBlobsInWallet = allBlobs.filter(b => siteBlobIds.has(b.blobId)).length;
        const orphanedBlobs = allBlobs.filter(b => !siteBlobIds.has(b.blobId));
        
        console.log(`Site Blobs Found in Wallet: ${chalk.cyan(actualSiteBlobsInWallet.toString())} of ${siteBlobIds.size} referenced`);
        console.log(`Non-Site Blobs: ${chalk.yellow(orphanedBlobs.length.toString())}`);
        
        const expiredOrphanedCount = orphanedBlobs.filter(b => b.isExpired).length;
        const deletableOrphanedCount = orphanedBlobs.filter(b => b.isDeletable).length;
        
        console.log(`Orphaned Blobs: ${chalk.red(orphanedBlobs.length.toString())}`);
        console.log(`  - Expired: ${chalk.gray(expiredOrphanedCount.toString())}`);
        console.log(`  - Deletable: ${chalk.red(deletableOrphanedCount.toString())}`);
        
        // Recommendations
        console.log(`\n${chalk.bold.green('Recommendations:')}`);
        
        if (actualSiteBlobsInWallet > 0) {
          console.log(`${chalk.green('✓')} ${actualSiteBlobsInWallet} user content blobs are protected from deletion`);
        }
        
        const systemManagedBlobs = siteBlobIds.size - actualSiteBlobsInWallet;
        if (systemManagedBlobs > 0) {
          const hasSuiNS = suinsDomains.size > 0;
          if (hasSuiNS) {
            console.log(`${chalk.blue('ℹ')} ${systemManagedBlobs} resources are managed by SuiNS/Walrus infrastructure`);
            console.log(`  These enable your domain (${Array.from(suinsDomains.values())[0]}) to work properly`);
          } else {
            console.log(`${chalk.blue('ℹ')} ${systemManagedBlobs} resources are managed by the Walrus Sites system`);
          }
          console.log(`  You don't need to store or manage these blobs in your wallet`);
        }
        
        if (deletableOrphanedCount > 0) {
          console.log(`${chalk.yellow('!')} ${deletableOrphanedCount} orphaned blobs can be safely deleted`);
          console.log(`  Use ${chalk.cyan('npm run dev cleanup ' + address)} to clean them up`);
        }
        
        if (expiredOrphanedCount > 0) {
          console.log(`${chalk.gray('i')} ${expiredOrphanedCount} blobs have expired and may not be accessible`);
        }
        
        // Show potential savings
        if (summary.deletableBlobs > 0) {
          console.log(`\n${chalk.yellow('Cleanup Potential:')}`);
          if (summary.deletableSize > 0) {
            console.log(`Can free: ${chalk.green(formatBytes(summary.deletableSize))}`);
          
          }
          if (summary.potentialSavings > 0) {
            console.log(`Cost savings: ${chalk.green(summary.potentialSavings.toString())} storage units`);
          }
          console.log(`\nNote: These blobs appear to be from epoch 8. They may have expired and might not be accessible via the aggregator.`);
        }

      } catch (error) {
        console.error(chalk.red(`Error scanning wallet: ${error}`));
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

function getImportanceColor(importance: BlobImportance): string {
  switch (importance) {
    case BlobImportance.CRITICAL:
      return chalk.red.bold(importance);
    case BlobImportance.IMPORTANT:
      return chalk.red(importance);
    case BlobImportance.NORMAL:
      return chalk.yellow(importance);
    case BlobImportance.LOW:
      return chalk.gray(importance);
    case BlobImportance.DISPOSABLE:
      return chalk.gray.strikethrough(importance);
    default:
      return importance;
  }
}

async function findSuiNSDomainForSite(suiClient: SuiClient, siteObjectId: string, config: any): Promise<string | null> {
  try {
    const suinsPackageId = SUINS_PACKAGE[config.network as keyof typeof SUINS_PACKAGE] || SUINS_PACKAGE.mainnet;
    
    // Query for SuiNS domain objects that might reference this site
    // We'll search through recent objects and check if any domains reference our site
    
    // First, try to find domains owned by the same wallet that owns the site
    const siteObject = await suiClient.getObject({
      id: siteObjectId,
      options: { showOwner: true }
    });
    
    if (!siteObject.data?.owner) {
      return null;
    }
    
    let ownerAddress: string | null = null;
    if (typeof siteObject.data.owner === 'string') {
      ownerAddress = siteObject.data.owner;
    } else if ('AddressOwner' in siteObject.data.owner) {
      ownerAddress = siteObject.data.owner.AddressOwner;
    }
    
    if (!ownerAddress) {
      return null;
    }
    
    // Get all objects owned by the site owner to look for domain objects
    const ownedObjects = await suiClient.getOwnedObjects({
      owner: ownerAddress,
      options: {
        showContent: true,
        showType: true
      }
    });
    
    // Look for SuiNS domain objects in the owned objects
    for (const obj of ownedObjects.data) {
      if (obj.data?.type) {
        const objectType = obj.data.type;
        
        // Check if this looks like a SuiNS domain object
        if (objectType.includes(suinsPackageId) || 
            objectType.includes('domain') || 
            objectType.includes('Domain') ||
            objectType.includes('suins')) {
          
          if (obj.data.content?.dataType === 'moveObject') {
            const fields = (obj.data.content as any).fields;
            
            // Look for references to our site object ID in the domain fields
            const checkForSiteReference = (obj: any): boolean => {
              if (typeof obj === 'string' && obj === siteObjectId) {
                return true;
              }
              if (typeof obj === 'object' && obj !== null) {
                for (const value of Object.values(obj)) {
                  if (checkForSiteReference(value)) {
                    return true;
                  }
                }
              }
              return false;
            };
            
            if (checkForSiteReference(fields)) {
              // Found a domain that references our site!
              // Try to extract the domain name
              const domainName = fields?.name || fields?.domain_name || fields?.label;
              if (domainName) {
                const fullDomain = typeof domainName === 'string' ? domainName : 
                                 domainName.toString ? domainName.toString() : 
                                 JSON.stringify(domainName);
                
                // Ensure it ends with .sui
                if (fullDomain.includes('.sui') || !fullDomain.includes('.')) {
                  return fullDomain.endsWith('.sui') ? fullDomain : `${fullDomain}.sui`;
                }
              }
            }
          }
        }
      }
    }
    
    // Alternative approach: Check dynamic fields of known SuiNS registry objects
    // This would require knowing the registry object ID, which varies by network
    
    return null;
  } catch (error) {
    console.debug(`Error searching for SuiNS domain: ${error}`);
    return null;
  }
}