export interface PropertyInfo {
  name: string;
  type: string;
  required: boolean;
}

export interface ApiSignature {
  id: string;
  functionName: string;
  tag: string;
  params: PropertyInfo[];
  body: PropertyInfo[];
  response: PropertyInfo[];
  responseHash: string;
}

export interface ApiSnapshot {
  version: string;
  generatedAt: string;
  schemaPath: string;
  schemaHash: string;
  apis: ApiSignature[];
}

export type DiffChangeType = 'added' | 'removed' | 'modified';

export interface PropertyDiff {
  property: string;
  change: 'added' | 'removed' | 'typeChanged' | 'requiredChanged';
  before?: string;
  after?: string;
}

export interface ApiDiff {
  type: DiffChangeType;
  id: string;
  functionName: string;
  tag: string;
  propertyDiffs?: PropertyDiff[];
  changedCategories?: ('params' | 'body' | 'response')[];
}

export interface FullDiffReport {
  hasChanges: boolean;
  schemaChanged: boolean;
  added: ApiDiff[];
  removed: ApiDiff[];
  modified: ApiDiff[];
}
