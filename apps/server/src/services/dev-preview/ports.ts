import { connect, createServer } from "node:net";

/** Does something accept connections on this loopback port (IPv4 or IPv6)? */
export async function isListening(port: number, timeoutMs = 400): Promise<boolean> {
  const answers = await Promise.all([
    connects("127.0.0.1", port, timeoutMs),
    connects("::1", port, timeoutMs),
  ]);
  return answers.some(Boolean);
}

function connects(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function binds(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      // No IPv6 on this machine: that address can't be taken by anyone else either.
      resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT");
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/**
 * Is this port free on loopback? Nothing answers on it, and it can be bound on both loopback
 * addresses. The connection test comes first: on macOS a specific address can be bound beside
 * a listener on every address, so binding alone would call a taken port free.
 */
export async function portIsFree(port: number): Promise<boolean> {
  if (await isListening(port, 200)) return false;
  return (await binds("127.0.0.1", port)) && (await binds("::1", port));
}

export interface PortRange {
  from: number;
  to: number;
}

/**
 * Hands out loopback ports from a range. `next` moves on from the last port given, so a port
 * a stopped preview just released isn't the first one handed to the next preview while its
 * old process may still be letting go of it.
 */
export class PortAllocator {
  private cursor = 0;

  constructor(private readonly isFree: (port: number) => Promise<boolean> = portIsFree) {}

  /** `count` free ports from the range, none of them in `taken`; null when it has too few. */
  async next(
    count: number,
    range: PortRange,
    taken: ReadonlySet<number>,
  ): Promise<number[] | null> {
    const from = Math.min(range.from, range.to);
    const size = Math.abs(range.to - range.from) + 1;
    const found: number[] = [];
    for (let i = 0; i < size && found.length < count; i++) {
      const port = from + ((this.cursor + i) % size);
      if (taken.has(port) || found.includes(port)) continue;
      if (await this.isFree(port)) found.push(port);
    }
    if (found.length < count) return null;
    const last = found[found.length - 1] as number;
    this.cursor = (last - from + 1) % size;
    return found;
  }
}
