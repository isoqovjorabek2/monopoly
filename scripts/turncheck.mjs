/**
 * Minimal TURN client: sends a real Allocate request from this machine to the
 * relay and reports whether it hands back a relayed address.
 *
 * Step 1 gets the expected 401 carrying REALM and NONCE.
 * Step 2 repeats the request signed with the long-term credential.
 * A success response with XOR-RELAYED-ADDRESS means an internet client can
 * actually use this server, which is the only claim worth making.
 *
 * Every URL in VITE_TURN_URLS is checked, over the transport that URL names:
 * `turn:` over UDP, `?transport=tcp` over TCP, `turns:` over TLS. They are
 * separate listeners on the server and separate paths through a firewall, so
 * one of them working says nothing about the others.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const USER = process.argv[3] ?? process.env.VITE_TURN_USERNAME;
const PASS = process.argv[4] ?? process.env.VITE_TURN_CREDENTIAL;

/* Defaults come from the same .env the client build reads, so this checks the
 * relay the game is actually pointed at rather than one you typed. */
const urls = (process.argv[2] ?? process.env.VITE_TURN_URLS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!urls.length || !USER || !PASS) {
  console.log('Usage: npm run check:turn        (reads .env)');
  console.log('   or: node scripts/turncheck.mjs <urls> <user> <password>');
  process.exit(2);
}

/** `turns:host:443` and `turn:host:3478?transport=tcp` into something to dial. */
function parseUrl(url) {
  const m = /^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/.exec(url);
  if (!m) return null;
  const [, scheme, host, port, transport] = m;
  const tlsMode = scheme === 'turns';
  return {
    url,
    host,
    port: Number(port ?? (tlsMode ? 5349 : 3478)),
    // turns: is always TLS over TCP; ?transport=tcp selects plain TCP.
    kind: tlsMode ? 'tls' : transport === 'tcp' ? 'tcp' : 'udp',
  };
}

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

const TIMEOUT_MS = 6000;

/** A datagram each way: one send, one reply. */
function udpTransport({ host, port }) {
  const sock = dgram.createSocket('udp4');
  return {
    request: (buf) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 6s')), TIMEOUT_MS);
      sock.once('message', (m) => { clearTimeout(timer); resolve(m); });
      sock.send(buf, port, host, (e) => { if (e) { clearTimeout(timer); reject(e); } });
    }),
    close: () => sock.close(),
  };
}

/**
 * Over a stream there are no message boundaries, so each reply is read by its
 * own header: 20 bytes of STUN header, then the length that header declares.
 */
function streamTransport({ host, port, kind }) {
  let buf = Buffer.alloc(0);
  let want = null;
  const socket = kind === 'tls'
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  socket.setTimeout(TIMEOUT_MS);

  const ready = new Promise((resolve, reject) => {
    socket.once(kind === 'tls' ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('no answer within 6s')));
  });

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!want) return;
    if (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) {
      const msg = buf.subarray(0, 20 + buf.readUInt16BE(2));
      buf = buf.subarray(msg.length);
      const resolve = want; want = null;
      resolve(msg);
    }
  });

  return {
    ready,
    request: (out) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 6s')), TIMEOUT_MS);
      want = (m) => { clearTimeout(timer); resolve(m); };
      socket.once('error', (e) => { clearTimeout(timer); reject(e); });
      socket.write(out);
    }),
    close: () => socket.destroy(),
    peerCert: () => (kind === 'tls' ? socket.getPeerCertificate() : null),
  };
}

const transportAttr = Buffer.alloc(4);
transportAttr.writeUInt8(17, 0); // The relay talks UDP to the peer either way.

async function check(target) {
  const label = `${target.url}  [${target.kind.toUpperCase()}]`;
  console.log(`\n${label}`);
  const t = target.kind === 'udp' ? udpTransport(target) : streamTransport(target);
  try {
    if (t.ready) await t.ready;
    if (t.peerCert) {
      const c = t.peerCert();
      if (c?.subject) console.log(`        certificate CN=${c.subject.CN}, expires ${c.valid_to}`);
    }

    const tx = crypto.randomBytes(12);
    const first = parse(await t.request(build(0x0003, tx, [attr(ATTR.REQUESTED_TRANSPORT, transportAttr)])));

    const code = first.attrs[ATTR.ERROR_CODE];
    const realm = first.attrs[ATTR.REALM];
    const nonce = first.attrs[ATTR.NONCE];
    const status = code ? code.readUInt8(2) * 100 + code.readUInt8(3) : null;
    console.log(`step 1  unauthenticated Allocate -> ${status ?? 'no error code'} ${status === 401 ? '(expected)' : ''}`);
    if (!realm || !nonce) throw new Error('server did not offer a realm/nonce; long-term auth is not enabled');

    const key = crypto.createHash('md5')
      .update(`${USER}:${realm.toString()}:${PASS}`).digest();
    const tx2 = crypto.randomBytes(12);
    const second = parse(await t.request(build(0x0003, tx2, [
      attr(ATTR.REQUESTED_TRANSPORT, transportAttr),
      attr(ATTR.USERNAME, Buffer.from(USER)),
      attr(ATTR.REALM, realm),
      attr(ATTR.NONCE, nonce),
    ], key)));

    if (second.type === 0x0103) {
      const relayed = second.attrs[ATTR.XOR_RELAYED_ADDRESS];
      console.log('step 2  signed Allocate      -> 200 SUCCESS');
      console.log(`        relayed address ${relayed ? xorAddr(relayed) : '(missing)'}`);
      return true;
    }
    const err = second.attrs[ATTR.ERROR_CODE];
    const s = err ? err.readUInt8(2) * 100 + err.readUInt8(3) : second.type;
    console.log(`step 2  signed Allocate      -> ${s} FAILED  ${err ? err.subarray(4).toString() : ''}`);
    return false;
  } catch (e) {
    console.log(`        FAILED: ${e.message}`);
    return false;
  } finally {
    t.close();
  }
}

const targets = urls.map(parseUrl);
const bad = targets.filter((t) => !t);
if (bad.length) {
  console.log(`unparseable TURN url(s): ${urls.filter((_, i) => !targets[i]).join(', ')}`);
  process.exit(2);
}

console.log(`checking ${targets.length} relay url(s) as "${USER}"`);
const results = [];
for (const t of targets) results.push(await check(t));

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} transports allocated.`);
if (ok === results.length) {
  console.log('RELAY WORKS: a browser on any network can use this server.');
} else {
  process.exitCode = 1;
}
