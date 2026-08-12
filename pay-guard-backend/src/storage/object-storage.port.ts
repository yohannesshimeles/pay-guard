export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStoragePort {
  isReady(): Promise<boolean>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
}
