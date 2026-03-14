export interface ScanOptions {
  since?: string;
  latest?: number;
  projectPath?: string;
  homeDir?: string;
}

export interface ScanCandidate {
  id: string;
  source: string;
  metadata: Record<string, unknown>;
}

export interface ExtractedSession {
  id: string;
  source: string;
  project?: string;
  project_path?: string;
  condensed: string;
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  scan(options: ScanOptions): Promise<ScanCandidate[]>;
  extract(candidate: ScanCandidate): Promise<ExtractedSession>;
}
