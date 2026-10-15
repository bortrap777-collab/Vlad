/** Minimal typed event emitter (no Phaser dependency). */
export class Emitter<E extends Record<string, unknown>> {
  private handlers: { [K in keyof E]?: ((p: E[K]) => void)[] } = {};
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    (this.handlers[k] ??= []).push(fn);
    return () => this.off(k, fn);
  }
  off<K extends keyof E>(k: K, fn: (p: E[K]) => void) {
    this.handlers[k] = (this.handlers[k] ?? []).filter((f) => f !== fn);
  }
  emit<K extends keyof E>(k: K, p: E[K]) {
    for (const fn of [...(this.handlers[k] ?? [])]) fn(p);
  }
  clear() {
    this.handlers = {};
  }
}
