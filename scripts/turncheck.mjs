/**
 * Minimal TURN client: sends a real Allocate request from this machine to the
 * relay and reports whether it hands back a relayed address.
 *
 * Step 1 gets the expected 401 carrying REALM and NONCE.
 * Step 2 repeats the request signed with the long-term credential.
 * A success response with XOR-RELAYED-ADDRESS means an internet client can
 * actually use this server, which is the only claim worth making.
 */
import dgram from 'node:dgram';
import crypto from 'node:crypto';

/* Defaults come from the same .env the client build reads, so this checks
 * the relay the game is actually pointed at rather than one you typed. */
const firstTurnUrl = (process.env.VITE_TURN_URLS ?? '').split(',')[0].trim();
const parsed = /^turns?:([^:?]+)(?::(\d+))?/.exec(firstTurnUrl);

const HOST = process.argv[2] ?? parsed?.[1];
const PORT = Number(process.argv[3] ?? parsed?.[2] ?? 3478);
const USER = process.argv[4] ?? process.env.VITE_TURN_USERNAME;
const PASS = process.argv[5] ?? process.env.VITE_TURN_CREDENTIAL;

if (!HOST || !USER || !PASS) {
  console.log('Usage: npm run check:turn        (reads .env)');
  console.log('   or: node scripts/turncheck.mjs <host> <port> <user> <password>');
  process.exit(2);
}
console.log(`checking turn:${HOST}:${PORT} as "${USER}"\n`);
const MAGIC = 0x2112a442;

const ATTR = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009,
  REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, SOFTWARE: 0x8022,
};

const pad4 = (n) => (n + 3) & ~3;

function attr(type, value) {
  const b = Buffer.alloc(4 + pad4(value.length));
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(value.length, 2);
  value.copy(b, 4);
  return b;
}

function build(type, txId, attrs, key) {
  let body = Buffer.concat(attrs);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt32BE(MAGIC, 4);
  txId.copy(head, 8);
  if (key) {
    // The length must already account for the integrity attribute itself.
    head.writeUInt16BE(body.length + 24, 2);
    const mac = crypto.createHmac('sha1', key)
      .update(Buffer.concat([head, body])).digest();
    body = Buffer.concat([body, attr(ATTR.MESSAGE_INTEGRITY, mac)]);
  }
  head.writeUInt16BE(body.length, 2);
  return Buffer.concat([head, body]);
}

function parse(msg) {
  const out = { type: msg.readUInt16BE(0), attrs: {} };
  let off = 20;
  const end = 20 + msg.readUInt16BE(2);
  while (off + 4 <= end && off + 4 <= msg.length) {
    const type = msg.readUInt16BE(off);
    const len = msg.readUInt16BE(off + 2);
    out.attrs[type] = msg.subarray(off + 4, off + 4 + len);
    off += 4 + pad4(len);
  }
  return out;
}

/** XOR-MAPPED style address: port and v4 address are xored with the cookie. */
function xorAddr(buf) {
  const port = buf.readUInt16BE(2) ^ (MAGIC >>> 16);
  const raw = buf.readUInt32BE(4) ^ MAGIC;
  const ip = [raw >>> 24, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255].join('.');
  return `${ip}:${port}`;
}

const sock = dgram.createSocket('udp4');
const send = (buf) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no answer within 5s')), 5000);
  sock.once('message', (m) => { clearTimeout(timer); resolve(m); });
  sock.send(buf, PORT, HOST, (e) => { if (e) { clearTimeout(timer); reject(e); } });
});

const transport = Buffer.alloc(4);
transport.writeUInt8(17, 0); // UDP

try {
  const tx = crypto.randomBytes(12);
  const first = parse(await send(build(0x0003, tx, [attr(ATTR.REQUESTED_TRANSPORT, transport)])));

  const code = first.attrs[ATTR.ERROR_CODE];
  const realm = first.attrs[ATTR.REALM];
  const nonce = first.attrs[ATTR.NONCE];
  const status = code ? code.readUInt8(2) * 100 + code.readUInt8(3) : null;
  console.log(`step 1  unauthenticated Allocate -> ${status ?? 'no error code'} ${status === 401 ? '(expected)' : ''}`);
  if (realm) console.log(`        realm "${realm.toString()}"`);
  if (!realm || !nonce) throw new Error('server did not offer a realm/nonce; long-term auth is not enabled');

  const key = crypto.createHash('md5')
    .update(`${USER}:${realm.toString()}:${PASS}`).digest();
  const tx2 = crypto.randomBytes(12);
  const second = parse(await send(build(0x0003, tx2, [
    attr(ATTR.REQUESTED_TRANSPORT, transport),
    attr(ATTR.USERNAME, Buffer.from(USER)),
    attr(ATTR.REALM, realm),
    attr(ATTR.NONCE, nonce),
  ], key)));

  if (second.type === 0x0103) {
    const relayed = second.attrs[ATTR.XOR_RELAYED_ADDRESS];
    console.log('step 2  signed Allocate      -> 200 SUCCESS');
    console.log(`        relayed address ${relayed ? xorAddr(relayed) : '(missing)'}`);
    console.log('\nRELAY WORKS: a browser on any network can use this server.');
  } else {
    const err = second.attrs[ATTR.ERROR_CODE];
    const s = err ? err.readUInt8(2) * 100 + err.readUInt8(3) : second.type;
    console.log(`step 2  signed Allocate      -> ${s} FAILED`);
    console.log(`        ${err ? err.subarray(4).toString() : ''}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  sock.close();
}
