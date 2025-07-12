# Publishing to NPM

## Prerequisites

1. **NPM Account**: Ensure you have an npm account at https://www.npmjs.com/
2. **Login**: Login to npm from your terminal:
   ```bash
   npm login
   ```

## Publishing Steps

### 1. Final Checks

```bash
# Ensure everything builds correctly
npm run build

# Run type checking
npm run typecheck

# Test the package locally
npm pack
```

### 2. Version Management

For updates, bump the version:
```bash
# Patch version (1.0.0 -> 1.0.1)
npm version patch

# Minor version (1.0.0 -> 1.1.0) 
npm version minor

# Major version (1.0.0 -> 2.0.0)
npm version major
```

### 3. Publish to NPM

```bash
# Publish to npm registry
npm publish
```

### 4. Verify Publication

Check that the package is available:
```bash
# Search for the package
npm search walrus-blob-scanner

# Install globally to test
npm install -g walrus-blob-scanner

# Test the CLI
walscan --help
```

## Post-Publication

### Update README Badge

Add npm badge to README.md:
```markdown
[![npm version](https://badge.fury.io/js/walrus-blob-scanner.svg)](https://badge.fury.io/js/walrus-blob-scanner)
```

### Tag the Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Package Details

- **Package Name**: `walrus-blob-scanner`
- **Primary Command**: `walscan`
- **Alternative Commands**: `walrus-scanner`, `walrus-blob-scanner`
- **Installation**: `npm install -g walrus-blob-scanner`

## Troubleshooting

### Package Name Conflicts

If the package name is taken, update `package.json`:
```json
{
  "name": "@your-username/walrus-blob-scanner"
}
```

### Permission Issues

If you get permission errors:
```bash
npm publish --access public
```

### Unpublishing (if needed)

```bash
# Unpublish specific version (within 72 hours)
npm unpublish walrus-blob-scanner@1.0.0

# Unpublish entire package (use with extreme caution)
npm unpublish walrus-blob-scanner --force
```