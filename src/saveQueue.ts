/** Serializes persistence so a slower older write cannot replace a newer scene. */
export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly saved = new Map<string, string>();
  private readonly write: (id: string, payload: string) => Promise<void>;

  constructor(write: (id: string, payload: string) => Promise<void>) {
    this.write = write;
  }

  save(id: string, payload: string): Promise<void> {
    const operation = this.tail.then(async () => {
      // Compare when this operation runs, after all earlier writes have settled.
      if (this.saved.get(id) === payload) return;
      await this.write(id, payload);
      this.saved.set(id, payload);
    });
    // Report this failure to its caller while allowing subsequent saves to retry.
    this.tail = operation.catch(() => {});
    return operation;
  }
}
