import { spawn } from 'child_process';
import chalk from 'chalk';

export interface CLIValidationResult {
  walrusAvailable: boolean;
  suiAvailable: boolean;
  walletConfigured: boolean;
  activeAddress?: string;
  suiBalance?: number;
  errors: string[];
}

export class CLIValidator {
  async validateEnvironment(): Promise<CLIValidationResult> {
    const result: CLIValidationResult = {
      walrusAvailable: false,
      suiAvailable: false,
      walletConfigured: false,
      errors: []
    };

    // Check Walrus CLI
    try {
      await this.runCommand('walrus', ['--version']);
      result.walrusAvailable = true;
    } catch (error) {
      result.errors.push('Walrus CLI not found. Install from: https://docs.wal.app/usage/setup.html');
    }

    // Check Sui CLI
    try {
      await this.runCommand('sui', ['--version']);
      result.suiAvailable = true;
    } catch (error) {
      result.errors.push('Sui CLI not found. Install from: https://docs.sui.io/references/cli');
    }

    // Check wallet configuration if Sui is available
    if (result.suiAvailable) {
      try {
        const addressOutput = await this.runCommand('sui', ['client', 'active-address']);
        result.activeAddress = addressOutput.trim();
        result.walletConfigured = true;

        // Get SUI balance
        try {
          const balanceOutput = await this.runCommand('sui', ['client', 'balance']);
          const balanceMatch = balanceOutput.match(/(\d+\.?\d*)\s+SUI/);
          if (balanceMatch) {
            result.suiBalance = parseFloat(balanceMatch[1]);
          }
        } catch (error) {
          result.errors.push('Could not fetch SUI balance');
        }
      } catch (error) {
        result.errors.push('No active wallet configured. Run: sui client new-address ed25519');
      }
    }

    return result;
  }

  async checkMinimumSuiBalance(requiredSui: number = 0.1): Promise<boolean> {
    try {
      const balanceOutput = await this.runCommand('sui', ['client', 'balance']);
      const balanceMatch = balanceOutput.match(/(\d+\.?\d*)\s+SUI/);
      if (balanceMatch) {
        const balance = parseFloat(balanceMatch[1]);
        return balance >= requiredSui;
      }
    } catch (error) {
      // Ignore error, will be caught by validation
    }
    return false;
  }

  displayValidationErrors(result: CLIValidationResult): void {
    if (result.errors.length > 0) {
      console.error(chalk.red.bold('\n❌ Environment Setup Issues:\n'));
      result.errors.forEach((error, index) => {
        console.error(chalk.red(`${index + 1}. ${error}`));
      });
      console.error(chalk.yellow('\nPlease resolve these issues before proceeding.\n'));
    }
  }

  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }
}