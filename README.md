# Walrus Blob Reader

A comprehensive tool to read Walrus blobs, identify websites, and manage storage with intelligent cleanup capabilities.

## Features

- **Wallet-Specific Analysis**: Scan specific wallet addresses for blob ownership
- **Blob Classification**: Categorize blobs by type, importance, and content
- **Website Detection**: Automatically detect Walrus Sites from blob content
- **Smart Cleanup**: Interactive deletion with safety checks and warnings
- **Cost Analysis**: Storage cost tracking and optimization recommendations
- **SuiNS Integration**: Link discovered sites to SuiNS domain names
- **Export Tools**: Generate comprehensive inventories in JSON/CSV formats
- **CLI Tools**: Powerful command-line interface for all operations
- **TypeScript SDK**: Full programmatic API for integration

## Installation

### Global Installation (Recommended)

```bash
npm install -g walrus-blob-scanner
```

After installation, you can use the tool globally:
```bash
walscan --help
walscan cleanup <wallet-address>
```

### Local Development

```bash
git clone https://github.com/Angleito/WalrusBlobScanner.git
cd WalrusBlobScanner
npm install
npm run build
```

### Prerequisites

Before using the tool, ensure you have the required CLI tools installed:

1. **Walrus CLI**: Install from https://docs.wal.app/usage/setup.html
2. **Sui CLI**: Install from https://docs.sui.io/references/cli

The tool will validate these dependencies and provide setup guidance if they're missing.

## CLI Usage

### Wallet Management Commands

```bash
# Scan a specific wallet for blobs
walscan wallet-scan <wallet-address>

# Interactive cleanup with cost transparency and safety checks
walscan cleanup <wallet-address>

# Classify blobs by type and importance
walscan classify <wallet-address> --verbose

# Generate storage cost analysis
walscan cost-analysis <wallet-address>

# Export complete inventory
walscan inventory <wallet-address> --format csv
```

### Blob Analysis Commands

```bash
# Analyze a specific blob
walscan analyze <blob-id>

# Scan for Walrus Sites (all blobs)
walscan scan --limit 50

# Link a domain to a site
walscan link --domain mydomain.sui --site <site-object-id>

# Search domains and sites
walscan search --domain keyword
walscan search --address <sui-address>
```

### Interactive Mode

```bash
# Interactive domain linking
walscan link --interactive
```

### Network Configuration

```bash
# Use testnet
walscan --network testnet scan

# Custom aggregator
walscan --aggregator https://my-aggregator.com analyze <blob-id>
```

## Examples

### Wallet Scan and Analysis

```bash
walscan wallet-scan 0x1234567890abcdef... --verbose
```

Output:
```
Wallet Storage Summary:
Address: 0x1234567890abcdef...
Total Blobs: 47
Total Size: 2.3 GB
Websites: 5
Deletable: 12 (450.2 MB)
Expired: 3

By Category:
  website: 5
  image: 18
  document: 8
  archive: 12
  unknown: 4

Cleanup Potential:
Can free: 450.2 MB
Cost savings: 1250 storage units
```

### Interactive Cleanup

```bash
walscan cleanup 0x1234567890abcdef... --dry-run
```

### Cost Analysis

```bash
walscan cost-analysis 0x1234567890abcdef...
```

Output:
```
Storage Cost Analysis:
Current Cost: 3450 storage units
Potential Savings: 1250 units (36.2%)
12-month projection: 41,400 units
After cleanup: 26,400 units
Total savings: 15,000 units
```

### Export Inventory

```bash
walscan inventory 0x1234567890abcdef... --format csv -o my-wallet-inventory.csv
```

## Programmatic Usage

```typescript
import { 
  WalletTracker, 
  BlobClassifier, 
  DeletionManager, 
  WalrusClient, 
  WALRUS_CONFIGS 
} from 'walrus-blob-reader';

// Initialize components
const config = WALRUS_CONFIGS.mainnet;
const walletTracker = new WalletTracker(config.rpcUrls[0]);
const walrusClient = new WalrusClient(undefined, config.rpcUrls[0]);
const classifier = new BlobClassifier(walrusClient);
const deletionManager = new DeletionManager(walrusClient);

// Analyze wallet storage
const summary = await walletTracker.getWalletBlobSummary('0x...');
console.log('Total blobs:', summary.totalBlobs);
console.log('Deletable:', summary.deletableBlobs);

// Get and classify blobs
const blobs = await walrusClient.listBlobsForWallet('0x...');
const classifications = await classifier.classifyBlobs(blobs);

// Find websites
const websites = classifications.filter(c => c.category === 'website');
console.log('Found websites:', websites.length);

// Create deletion plan
const deletionPlan = await deletionManager.createDeletionPlan(blobs);
console.log('Can delete:', deletionPlan.blobsToDelete.length, 'blobs');
```

## Configuration

The tool uses the following configuration files:

- `src/config/walrus.ts` - Network configurations
- Package supports both mainnet and testnet

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

## Architecture

### Core Components

- **BlobReader**: Main class for reading and analyzing blobs
- **SiteDetector**: Logic for identifying Walrus Sites
- **SuiNSResolver**: Integration with SuiNS for domain management
- **WalrusClient**: Low-level Walrus API client

### Supported Site Types

- **ZIP-based Sites**: Standard Walrus Sites with multiple files
- **Single Page Sites**: HTML content stored directly as blob
- **File Directories**: Collections of files without index.html

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details