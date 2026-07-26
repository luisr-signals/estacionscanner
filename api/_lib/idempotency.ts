export type IdempotencyRecord<T> = {
  scanId: string;
  userId: string;
  result: T;
  createdAt: string;
};

export class InMemoryIdempotencyStore<T> {
  private readonly records = new Map<string, IdempotencyRecord<T>>();

  get(userId: string, scanId: string): IdempotencyRecord<T> | null {
    return this.records.get(this.key(userId, scanId)) || null;
  }

  save(userId: string, scanId: string, result: T, now = new Date()): IdempotencyRecord<T> {
    const key = this.key(userId, scanId);
    const existing = this.records.get(key);
    if (existing) return existing;

    const record = { scanId, userId, result, createdAt: now.toISOString() };
    this.records.set(key, record);
    return record;
  }

  private key(userId: string, scanId: string): string {
    return userId + ":" + scanId;
  }
}
