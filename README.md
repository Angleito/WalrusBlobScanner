# walscan

A focused CLI tool for scanning Walrus blob storage and performing cost-aware cleanup with storage refund tracking.

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

### From GitHub (Current Method)

Since the package is not yet published to npm, install directly from GitHub:

```bash
# Install globally from GitHub
npm install -g git+https://github.com/Angleito/Walscan.git

# Or using a specific branch/tag
npm install -g git+https://github.com/Angleito/Walscan.git#main
```

After installation, you can use the tool globally:
```bash
walscan --help
walscan cleanup <wallet-address>
```

### Local Development

```bash
git clone https://github.com/Angleito/Walscan.git
cd Walscan
npm install
npm run build

# Run in development mode
npm run dev

# Or link globally for testing
npm link
```

### Future npm Installation

Once published to npm, you'll be able to install with:
```bash
npm install -g walrus-blob-scanner
```

### Prerequisites

Before using the tool, ensure you have the required CLI tools installed:

1. **Walrus CLI**: Install from https://docs.wal.app/usage/setup.html
2. **Sui CLI**: Install from https://docs.sui.io/references/cli

The tool will validate these dependencies and provide setup guidance if they're missing.

## CLI Usage

### Core Commands

```bash
# Scan a specific wallet for blobs and analyze storage usage
walscan wallet-scan <wallet-address>

# Interactive cleanup with cost transparency and safety checks  
walscan cleanup <wallet-address>

# Scan for Walrus Sites across blob storage
walscan scan --limit 50
```

### Network Configuration

```bash
# Use testnet
walscan --network testnet wallet-scan <wallet-address>

# Custom aggregator
walscan --aggregator https://my-aggregator.com scan
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

The cleanup command provides:
- Cost calculation with storage rebate estimates
- Interactive processing method selection
- Real-time deletion tracking with actual refund amounts
- Safety checks to protect website-related blobs

## Programmatic Usage

```typescript
import { 
  WalletTracker, 
  WalrusClient, 
  WALRUS_CONFIGS 
} from 'walrus-blob-scanner';

// Initialize components
const config = WALRUS_CONFIGS.mainnet;
const walletTracker = new WalletTracker(config.rpcUrls[0]);
const walrusClient = new WalrusClient(undefined, config.rpcUrls[0]);

// Analyze wallet storage
const summary = await walletTracker.getWalletBlobSummary('0x...');
console.log('Total blobs:', summary.totalBlobs);
console.log('Total size:', summary.totalSize);

// Get blobs for wallet
const blobs = await walrusClient.listBlobsForWallet('0x...');
console.log('Found blobs:', blobs.length);
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