import { WalrusSite, SiteResource } from '../types/index.js';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

export interface SiteDetectionResult {
  isWalrusSite: boolean;
  siteInfo?: WalrusSite;
  structure?: {
    hasIndexHtml: boolean;
    hasHeaders: boolean;
    resourceCount: number;
    directories: string[];
  };
}

export async function detectWalrusSite(content: Buffer, blobId: string): Promise<SiteDetectionResult> {
  try {
    const result: SiteDetectionResult = {
      isWalrusSite: false
    };

    if (await isZipBasedSite(content)) {
      const siteInfo = await analyzeZipSite(content, blobId);
      if (siteInfo) {
        result.isWalrusSite = true;
        result.siteInfo = siteInfo;
        result.structure = {
          hasIndexHtml: siteInfo.hasIndexHtml,
          hasHeaders: !!siteInfo.headers,
          resourceCount: siteInfo.resources.length,
          directories: extractDirectories(siteInfo.resources)
        };
      }
    } else if (isSinglePageSite(content)) {
      const siteInfo = analyzeSinglePageSite(content, blobId);
      result.isWalrusSite = true;
      result.siteInfo = siteInfo;
      result.structure = {
        hasIndexHtml: true,
        hasHeaders: false,
        resourceCount: 1,
        directories: []
      };
    }

    return result;
  } catch (error) {
    console.error(`Error detecting site for blob ${blobId}:`, error);
    return { isWalrusSite: false };
  }
}

async function isZipBasedSite(content: Buffer): Promise<boolean> {
  try {
    const zip = new JSZip();
    await zip.loadAsync(content);
    
    const files = Object.keys(zip.files);
    return files.some(file => file.endsWith('index.html') || file === 'index.html');
  } catch {
    return false;
  }
}

async function analyzeZipSite(content: Buffer, blobId: string): Promise<WalrusSite | null> {
  try {
    const zip = new JSZip();
    await zip.loadAsync(content);
    
    const files = zip.files;
    const resources: SiteResource[] = [];
    let hasIndexHtml = false;
    let headers: Record<string, string> = {};
    let siteName = '';
    
    for (const [path, file] of Object.entries(files)) {
      if (!file.dir) {
        if (path === 'index.html' || path.endsWith('/index.html')) {
          hasIndexHtml = true;
          const htmlContent = await file.async('text');
          siteName = extractSiteTitle(htmlContent);
        }
        
        if (path === '_headers' || path.endsWith('/_headers')) {
          const headersContent = await file.async('text');
          headers = parseHeaders(headersContent);
        }
        
        resources.push({
          path,
          blobId: blobId,
          contentType: guessContentType(path),
          size: (file as any)._data?.uncompressedSize
        });
      }
    }

    if (!hasIndexHtml && resources.length === 0) {
      return null;
    }

    return {
      objectId: '',
      blobId,
      name: siteName,
      hasIndexHtml,
      resources,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      isFileDirectory: !hasIndexHtml && resources.length > 0
    };
  } catch (error) {
    console.error('Error analyzing zip site:', error);
    return null;
  }
}

function isSinglePageSite(content: Buffer): boolean {
  const text = content.toString('utf8');
  return text.includes('<!DOCTYPE html') || 
         text.includes('<html') ||
         (text.includes('<') && text.includes('>') && text.includes('</'));
}

function analyzeSinglePageSite(content: Buffer, blobId: string): WalrusSite {
  const htmlContent = content.toString('utf8');
  const siteName = extractSiteTitle(htmlContent);
  
  return {
    objectId: '',
    blobId,
    name: siteName,
    hasIndexHtml: true,
    resources: [{
      path: 'index.html',
      blobId,
      contentType: 'text/html',
      size: content.length
    }],
    isFileDirectory: false
  };
}

function extractSiteTitle(htmlContent: string): string {
  const titleMatch = htmlContent.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  
  const h1Match = htmlContent.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].trim();
  }
  
  return 'Untitled Site';
}

function parseHeaders(headersContent: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = headersContent.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('/')) {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
  }
  
  return headers;
}

function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  
  const typeMap: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'pdf': 'application/pdf',
    'zip': 'application/zip'
  };
  
  return typeMap[ext || ''] || 'application/octet-stream';
}

function extractDirectories(resources: SiteResource[]): string[] {
  const dirs = new Set<string>();
  
  for (const resource of resources) {
    const parts = resource.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir) {
        dirs.add(dir);
      }
    }
  }
  
  return Array.from(dirs).sort();
}