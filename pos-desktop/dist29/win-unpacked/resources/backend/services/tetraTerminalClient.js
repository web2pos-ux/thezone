/**
 * Tetra semi-integrated transport: RS232/USB (SerialPort) or TCP (terminal as server).
 */

'use strict';

const net = require('net');
const {
  buildFramedPacket,
  tryExtractOnePacket,
  ACK,
  NAK,
  HEARTBEAT,
  parseTerminalResponseInner,
} = require('../utils/tetraSemiIntegratedProtocol');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripLeadingHeartbeats(buf) {
  let i = 0;
  while (i < buf.length && buf[i] === HEARTBEAT) i += 1;
  return i > 0 ? buf.slice(i) : buf;
}

function extractAllPackets(bufferRef) {
  const out = [];
  let guard = 0;
  while (guard < 5000) {
    guard += 1;
    bufferRef.buf = stripLeadingHeartbeats(bufferRef.buf);
    if (!bufferRef.buf.length) break;
    const r = tryExtractOnePacket(bufferRef.buf);
    if (r.packet) {
      bufferRef.buf = bufferRef.buf.slice(r.consumed);
      out.push(r.packet);
      continue;
    }
    if (r.consumed > 0 && r.error === 'bad_lrc') {
      bufferRef.buf = bufferRef.buf.slice(1);
      continue;
    }
    if (r.consumed > 0) {
      bufferRef.buf = bufferRef.buf.slice(r.consumed);
      continue;
    }
    break;
  }
  return out;
}

function createByteQueueFromStream(stream) {
  const queue = [];
  const waiters = [];
  const notify = () => {
    while (queue.length && waiters.length) {
      const b = queue.shift();
      const fn = waiters.shift();
      fn(b);
    }
  };
  stream.on('data', (d) => {
    for (let i = 0; i < d.length; i += 1) queue.push(d[i]);
    notify();
  });
  const pollOneByte = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), Math.max(1, ms));
      const fn = (b) => {
        clearTimeout(t);
        resolve(b);
      };
      if (queue.length) {
        clearTimeout(t);
        resolve(queue.shift());
        return;
      }
      waiters.push(fn);
    });
  return { pollOneByte, queue };
}

async function waitAck(pollOneByte, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const b = await pollOneByte(Math.min(500, deadline - Date.now()));
    if (b === null) continue;
    if (b === ACK) return 'ack';
    if (b === NAK) return 'nak';
  }
  return 'timeout';
}

async function pumpBytesForMs(pollOneByte, packetBuf, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const b = await pollOneByte(Math.min(100, end - Date.now()));
    if (b !== null) {
      packetBuf.buf = Buffer.concat([packetBuf.buf, Buffer.from([b])]);
    }
  }
}

async function exchangeWithPumps(writeChunkFn, pollOneByte, innerAscii, opts) {
  const ackTimeout = opts.ackTimeoutMs || 3000;
  const responseTimeout = opts.responseTimeoutMs || 180000;
  const packetBuf = { buf: Buffer.alloc(0) };

  const pkt = buildFramedPacket(innerAscii);
  let tries = 0;
  while (tries < 3) {
    tries += 1;
    await writeChunkFn(pkt);
    const ack = await waitAck(pollOneByte, ackTimeout);
    if (ack === 'ack') break;
    if (tries >= 3) throw new Error(`No ACK from terminal (got ${ack})`);
  }

  const deadline = Date.now() + responseTimeout;
  const packets = [];
  while (Date.now() < deadline) {
    await pumpBytesForMs(pollOneByte, packetBuf, Math.min(200, deadline - Date.now()));
    const batch = extractAllPackets(packetBuf);
    for (const p of batch) {
      packets.push(p);
      await writeChunkFn(Buffer.from([ACK]));
      const parsed = parseTerminalResponseInner(p);
      if (parsed.multiFlag !== '1') return { packets, last: parsed };
    }
    await sleep(5);
  }
  if (!packets.length) throw new Error('Timeout waiting for terminal response');
  return { packets, last: parseTerminalResponseInner(packets[packets.length - 1]) };
}

function openSerialPort(SerialPort, path, baudRate) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path,
      baudRate: baudRate || 19200,
      dataBits: 7,
      parity: 'even',
      stopBits: 1,
      autoOpen: false,
    });
    port.open((err) => {
      if (err) return reject(err);
      resolve(port);
    });
  });
}

async function runSerialExchange(config, innerAscii, opts) {
  let SerialPort;
  try {
    SerialPort = require('serialport').SerialPort;
  } catch (e) {
    throw new Error('serialport module is not available');
  }
  const path = String(config.connectionPort || '').trim();
  if (!path) throw new Error('connectionPort (COM) is required');
  const baud = Number(config.baudRate) || 19200;
  const port = await openSerialPort(SerialPort, path, baud);
  const { pollOneByte } = createByteQueueFromStream(port);

  const writeChunkFn = (buf) =>
    new Promise((resolve, reject) => {
      port.write(buf, (err) => {
        if (err) reject(err);
        else port.drain(() => resolve());
      });
    });

  try {
    return await exchangeWithPumps(writeChunkFn, pollOneByte, innerAscii, opts);
  } finally {
    try {
      port.removeAllListeners('data');
      await new Promise((r) => port.close(() => r()));
    } catch {
      /* ignore */
    }
  }
}

async function runTcpExchange(config, innerAscii, opts) {
  const host = String(config.tcpHost || '').trim();
  const portNum = Number(config.tcpPort);
  if (!host || !Number.isFinite(portNum) || portNum <= 0) throw new Error('tcpHost and tcpPort are required');

  const socket = await new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port: portNum }, () => resolve(s));
    s.once('error', reject);
  });

  const { pollOneByte } = createByteQueueFromStream(socket);

  const writeChunkFn = (buf) =>
    new Promise((resolve, reject) => {
      socket.write(buf, (err) => (err ? reject(err) : resolve()));
    });

  try {
    return await exchangeWithPumps(writeChunkFn, pollOneByte, innerAscii, opts);
  } finally {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} tetraConfig connectionKind: 'serial'|'tcp'
 */
async function tetraExchange(tetraConfig, innerAscii, opts = {}) {
  const kind = String(tetraConfig.connectionKind || 'serial').toLowerCase();
  if (kind === 'tcp') return runTcpExchange(tetraConfig, innerAscii, opts);
  return runSerialExchange(tetraConfig, innerAscii, opts);
}

module.exports = { tetraExchange };
