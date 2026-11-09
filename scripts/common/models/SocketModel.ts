import {createHash, randomBytes} from "crypto";
import {connect as netConnect, type Socket} from "net";
import {connect as tlsConnect} from "tls";
import type {CosmosLink, SocketEvent} from "../CommonInterface";
import {MAX_RESPONSE_BYTES} from "../projects/CosmosConfig";
import {linkHeaders, toLink} from "./LinkModel";
import type {SecretModel} from "./SecretModel";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_SOCKETS = 8;
const HANDSHAKE_TIMEOUT_MS = 10000;
const MAX_HANDSHAKE_BYTES = 16 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface Connection {
    send(text: string): void;
    close(): void;
}

// === A small RFC 6455 client, used when the runtime has no WebSocket that can send headers === //

/** Frames from the server, with fragments joined. A message bigger than the cap closes the connection. */
class FrameReader {
    private buffer: Buffer = Buffer.alloc(0);
    private fragments: Buffer[] = [];
    private fragmentSize = 0;

    constructor(
        private readonly onText: (text: string) => void,
        private readonly onControl: (opcode: number, payload: Buffer) => void,
        private readonly onTooBig: () => void
    ) {
    }

    push(chunk: Buffer): void {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        for (;;) {
            if (this.buffer.length < 2) {
                return;
            }
            const first = this.buffer[0];
            const second = this.buffer[1];
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (this.buffer.length < 4) {
                    return;
                }
                length = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (this.buffer.length < 10) {
                    return;
                }
                const high = this.buffer.readUInt32BE(2);
                if (high !== 0) {
                    return this.onTooBig();
                }
                length = this.buffer.readUInt32BE(6);
                offset = 10;
            }
            if (length > MAX_RESPONSE_BYTES) {
                return this.onTooBig();
            }
            const total = offset + (masked ? 4 : 0) + length;
            if (this.buffer.length < total) {
                return;
            }

            let payload: Buffer = Buffer.from(this.buffer.subarray(offset + (masked ? 4 : 0), total));
            if (masked) {
                const mask = this.buffer.subarray(offset, offset + 4);
                payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
            }
            this.buffer = this.buffer.subarray(total);

            const opcode = first & 0x0f;
            if (opcode >= 8) {
                this.onControl(opcode, payload);
            } else {
                this.fragmentSize += payload.length;
                if (this.fragmentSize > MAX_RESPONSE_BYTES) {
                    return this.onTooBig();
                }
                this.fragments.push(payload);
                if ((first & 0x80) !== 0) {
                    const message = Buffer.concat(this.fragments);
                    this.fragments = [];
                    this.fragmentSize = 0;
                    if (opcode === 1 || opcode === 2) {
                        this.onText(message.toString("utf8"));
                    }
                }
            }
        }
    }
}

function frame(opcode: number, payload: Buffer): Buffer {
    const mask = randomBytes(4);
    const length = payload.length;
    const header = length < 126 ? Buffer.from([0x80 | opcode, 0x80 | length])
        : length < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 255])
            : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127, 0, 0, 0, 0]), Buffer.from([length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255])]);
    const body = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    return Buffer.concat([header, mask, body]);
}

function openRaw(url: URL, headers: Record<string, string>, on: (event: SocketEvent["type"], text: string) => void): Connection {
    const secure = url.protocol === "wss:";
    const port = Number(url.port) || (secure ? 443 : 80);
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1").update(key + GUID).digest("base64");
    const socket: Socket = secure ? tlsConnect({host: url.hostname, port, servername: url.hostname}) : netConnect({host: url.hostname, port});

    let handshake: Buffer | null = Buffer.alloc(0);
    let closed = false;
    const finish = (text: string): void => {
        if (!closed) {
            closed = true;
            clearTimeout(timer);
            socket.destroy();
            on("close", text);
        }
    };
    const timer = setTimeout(() => {
        on("error", "The server did not answer the handshake in time.");
        finish("Closed.");
    }, HANDSHAKE_TIMEOUT_MS);

    const reader = new FrameReader(
        (text) => on("message", text),
        (opcode, payload) => {
            if (opcode === 9) {
                socket.write(frame(10, payload.subarray(0, 125)));
            } else if (opcode === 8) {
                socket.write(frame(8, payload.subarray(0, 2)), () => finish("Closed by the server."));
            }
        },
        () => {
            on("error", "A message was bigger than the allowed size.");
            socket.write(frame(8, Buffer.from([0x03, 0xf1])), () => finish("Closed."));
        }
    );

    const lines = [`GET ${url.pathname || "/"}${url.search} HTTP/1.1`, `Host: ${url.host}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13"];
    for (const [name, value] of Object.entries(headers)) {
        lines.push(`${name}: ${value}`);
    }
    socket.once(secure ? "secureConnect" : "connect", () => socket.write(lines.join("\r\n") + "\r\n\r\n"));

    socket.on("data", (chunk: Buffer) => {
        if (handshake !== null) {
            handshake = Buffer.concat([handshake, chunk]);
            const end = handshake.indexOf("\r\n\r\n");
            if (end < 0) {
                if (handshake.length > MAX_HANDSHAKE_BYTES) {
                    on("error", "The handshake answer is too long.");
                    finish("Closed.");
                }
                return;
            }
            const head = handshake.subarray(0, end).toString("latin1");
            const rest = handshake.subarray(end + 4);
            handshake = null;
            const accept = /^sec-websocket-accept:\s*(.+)$/im.exec(head)?.[1]?.trim();
            if (!/^HTTP\/1\.1 101/.test(head) || accept !== expected) {
                on("error", `The server refused the connection: ${head.split("\r\n")[0].slice(0, 100)}`);
                return finish("Closed.");
            }
            clearTimeout(timer);
            on("open", "Connected.");
            chunk = rest;
        }
        if (chunk.length > 0) {
            reader.push(chunk);
        }
    });
    socket.on("error", (error) => {
        on("error", error.message.slice(0, 200));
        finish("Closed.");
    });
    socket.on("close", () => finish("Closed."));

    return {
        send: (text) => {
            if (!closed && handshake === null) {
                socket.write(frame(1, Buffer.from(text, "utf8")));
            }
        },
        close: () => {
            if (closed) {
                return;
            }
            socket.write(frame(8, Buffer.from([0x03, 0xe8])), () => finish("Closed."));
            setTimeout(() => finish("Closed."), 1000).unref();
        }
    };
}

/** The runtime's own WebSocket (when it has one) can't set headers, so it is used only for links without any. */
function openNative(url: URL, on: (event: SocketEvent["type"], text: string) => void): Connection | null {
    const Native = (globalThis as {WebSocket?: new (address: string) => WebSocketLike}).WebSocket;
    if (!Native) {
        return null;
    }
    const socket = new Native(url.toString());
    socket.onopen = () => on("open", "Connected.");
    socket.onmessage = (event) => on("message", String(event.data).slice(0, MAX_RESPONSE_BYTES));
    socket.onerror = () => on("error", "The connection failed.");
    socket.onclose = () => on("close", "Closed.");
    return {send: (text) => socket.send(text), close: () => socket.close()};
}

interface WebSocketLike {
    onopen: (() => void) | null;
    onmessage: ((event: {data: unknown}) => void) | null;
    onerror: (() => void) | null;
    onclose: (() => void) | null;
    send(text: string): void;
    close(): void;
}

/** The sockets the page opened, one per link. Events go to the page through `emit`. */
export class SocketModel {
    private readonly connections = new Map<string, Connection>();

    constructor(private readonly secrets: Pick<SecretModel, "decrypt">, private readonly emit: (event: SocketEvent) => void) {
    }

    open(raw: unknown): void {
        const link: CosmosLink | null = toLink(raw);
        if (!link || !ID_PATTERN.test(link.id)) {
            return;
        }
        const say = (type: SocketEvent["type"], text: string): void => this.emit({id: link.id, type, text, at: Date.now()});

        let url: URL;
        try {
            url = new URL(link.url);
        } catch {
            return say("error", "The address is not valid.");
        }
        if (url.protocol !== "ws:" && url.protocol !== "wss:") {
            return say("error", "Only ws and wss addresses can be opened.");
        }
        if (!this.connections.has(link.id) && this.connections.size >= MAX_SOCKETS) {
            return say("error", "Too many open connections.");
        }
        this.close(link.id);

        const headers = linkHeaders(link, this.secrets);
        // A late "close" of an older connection must not remove the newer one that replaced it.
        let current: Connection | undefined;
        const forward = (type: SocketEvent["type"], text: string): void => {
            say(type, text);
            if (type === "close" && current && this.connections.get(link.id) === current) {
                this.connections.delete(link.id);
            }
        };
        current = (Object.keys(headers).length === 0 ? openNative(url, forward) : null) ?? openRaw(url, headers, forward);
        this.connections.set(link.id, current);
    }

    send(id: unknown, text: unknown): void {
        if (typeof id === "string" && typeof text === "string" && text.length <= MAX_RESPONSE_BYTES) {
            this.connections.get(id)?.send(text);
        }
    }

    close(id: unknown): void {
        if (typeof id === "string") {
            const connection = this.connections.get(id);
            this.connections.delete(id);
            connection?.close();
        }
    }

    closeAll(): void {
        for (const id of [...this.connections.keys()]) {
            this.close(id);
        }
    }
}
