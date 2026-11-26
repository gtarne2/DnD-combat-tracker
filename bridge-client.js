// Connection to the Aurora DM helper through its bridge window (stage O1).
//
// Chrome will not let an Owlbear extension iframe call 127.0.0.1 directly, so the DM opens
// a small bridge window served by the helper. That window says hello to every frame in the
// Owlbear tab; the background page claims it and then sends requests through it with
// postMessage. Owlbear reloads are handled by the bridge saying hello again.

const BRIDGE_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const TOKEN_KEY = "aurora-obr-token";
const PORT_KEY = "aurora-obr-port";
export const DEFAULT_PORT = 47831;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function savedPort() {
  const port = Number(read(PORT_KEY));
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}
export function savePort(port) {
  write(PORT_KEY, port === DEFAULT_PORT ? null : String(port));
}
export function bridgeUrl(port = savedPort()) {
  return `http://127.0.0.1:${port}/obr/bridge`;
}

export class BridgeClient {
  constructor({ onChange = () => {}, timeoutMs = 10000 } = {}) {
    this.window = null;
    this.origin = null;
    this.token = read(TOKEN_KEY);
    this.pending = new Map();
    this.onChange = onChange;
    this.timeoutMs = timeoutMs;
    this.lastError = null;
    this.listener = (event) => this.receive(event);
    window.addEventListener("message", this.listener);
  }

  get connected() {
    return Boolean(this.window && !this.window.closed);
  }
  get paired() {
    return Boolean(this.token);
  }

  receive(event) {
    if (!BRIDGE_ORIGIN.test(event.origin) || !event.source) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "aurora-obr-hello") {
      // A bridge window (new, or reloaded Owlbear tab) is looking for us.
      event.source.postMessage({ type: "aurora-obr-claim", v: 1 }, event.origin);
      return;
    }
    if (msg.type === "aurora-obr-ready") {
      const fresh = this.window !== event.source;
      this.window = event.source;
      this.origin = event.origin;
      if (fresh) this.onChange("connected");
      return;
    }
    if (msg.type === "aurora-obr-response" && event.source === this.window) {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      waiter(msg);
    }
  }

  request(action, payload = {}) {
    if (!this.connected) {
      return Promise.reject(new Error("Open the bridge window from the Aurora panel."));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.window = null;
        this.onChange("disconnected");
        reject(new Error("The bridge window stopped answering. Open it again from the Aurora panel."));
      }, this.timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.ok) {
          resolve(msg.data);
          return;
        }
        if (msg.status === 401 && action !== "pair") this.forget();
        reject(Object.assign(new Error(msg.error || "Request refused."), { status: msg.status }));
      });
      this.window.postMessage({ type: "aurora-obr-request", id, action, payload: { ...payload, token: this.token || "" } }, this.origin);
    });
  }

  async pair(code) {
    const result = await this.request("pair", { code });
    this.token = result.token;
    write(TOKEN_KEY, this.token);
    this.onChange("paired");
    return result;
  }

  forget() {
    this.token = null;
    write(TOKEN_KEY, null);
    this.onChange("unpaired");
  }

  table() {
    return this.request("table");
  }
  status() {
    return this.request("status");
  }
}
