# Walrus Blob Reader Configuration

The Walrus Blob Reader tool now automatically reads configuration from your Sui and Walrus CLI configuration files, respecting your existing CLI setup.

## Configuration Sources

The tool looks for configuration in the following locations:

### Sui CLI Configuration
- Primary: `~/.sui/sui_config/client.yaml`
- Alternative: `~/.sui/client.yaml`

### Walrus CLI Configuration
- Primary: `~/.walrus/client_config.yaml`
- Alternative: `~/.config/walrus/client_config.yaml`
- Alternative names: `config.yaml` in the same directories

## Configuration Priority

Configuration values are determined in the following priority order:

1. **Command-line overrides** (highest priority)
   - `-n, --network <network>` - Override network selection
   - `-a, --aggregator <url>` - Override aggregator URL
   - `-r, --rpc <url>` - Override Sui RPC URL

2. **Walrus CLI configuration**
   - Network setting
   - RPC URL
   - Aggregator URL
   - System object IDs

3. **Sui CLI configuration**
   - Active environment and RPC URL
   - Network detected from RPC URL

4. **Built-in defaults** (lowest priority)
   - Hardcoded network configurations

## Usage Examples

### Use default configuration from CLI files
```bash
walrus-blob-reader info
```

### Override network
```bash
walrus-blob-reader -n testnet info
```

### Override aggregator URL
```bash
walrus-blob-reader -a https://custom-aggregator.example.com scan
```

### Override RPC URL
```bash
walrus-blob-reader -r https://custom-rpc.example.com wallet-scan <address>
```

### Multiple overrides
```bash
walrus-blob-reader -n testnet -r https://custom-rpc.example.com -a https://custom-aggregator.example.com analyze <blob-id>
```

## Backward Compatibility

If no CLI configuration files are found, the tool will:
1. Display a warning message
2. Fall back to default mainnet configuration
3. Continue to work as before

This ensures the tool remains functional even without CLI configurations.

## Configuration Detection

The tool automatically detects the network from RPC URLs:
- URLs containing "mainnet" → mainnet
- URLs containing "testnet" → testnet
- URLs containing "devnet" or "localhost" → devnet
- Unknown URLs default to mainnet

## Viewing Current Configuration

Use the `info` command to see the current configuration:

```bash
walrus-blob-reader info
```

This will show:
- Configuration sources (which files were found)
- Active configuration values
- Network endpoints being used
- Any command-line overrides in effect