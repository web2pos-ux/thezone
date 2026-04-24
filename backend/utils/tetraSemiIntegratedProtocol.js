/**
 * Ingenico Tetra Semi-Integrated — framing & tag helpers (0125-08708-1105 style).
 * Amounts in tag 001: integer cents string (e.g. $10.00 → "1000"), per Appendix C §11.1.
 */

const STX = 0x02;
const ETX = 0x03;
const FS = 0x1c;
const ACK = 0x06;
const NAK = 0x15;
const HEARTBEAT = 0x11;

function chr(n) {
  return String.fromCharCode(n);
}

function computeLrc(bytes) {
  let lrc = 0;
  for (let i = 0; i < bytes.length; i += 1) lrc ^= bytes[i];
  return lrc & 0xff;
}

/** Inner message: ASCII between STX and ETX (exclusive STX, inclusive ETX in LRC per spec). */
function buildFramedPacket(innerAscii) {
  const body = Buffer.from(innerAscii, 'ascii');
  const etx = Buffer.from([ETX]);
  const forLrc = Buffer.concat([body, etx]);
  const lrc = computeLrc(forLrc);
  return Buffer.concat([Buffer.from([STX]), body, etx, Buffer.from([lrc])]);
}

function tryExtractOnePacket(buffer) {
  const stx = buffer.indexOf(STX);
  if (stx < 0) return { consumed: 0, packet: null };
  const etxPos = buffer.indexOf(ETX, stx + 1);
  if (etxPos < 0) return { consumed: stx, packet: null };
  const lrcPos = etxPos + 1;
  if (lrcPos >= buffer.length) return { consumed: stx, packet: null };
  const inner = buffer.slice(stx + 1, etxPos);
  const lrcByte = buffer[lrcPos];
  const expected = computeLrc(Buffer.concat([inner, Buffer.from([ETX])]));
  const totalLen = lrcPos + 1 - stx;
  if (lrcByte !== expected) {
    return { consumed: stx + 1, packet: null, error: 'bad_lrc' };
  }
  return {
    consumed: stx + totalLen,
    packet: inner.toString('ascii'),
  };
}

/**
 * Parse response inner: status(2) + multiTran(1) then FS-separated tag+value fields (tag 3 digits).
 */
function parseTerminalResponseInner(inner) {
  const parts = inner.split(chr(FS)).filter((p, idx) => idx === 0 || p.length > 0);
  if (!parts.length) return { status: '', multiFlag: '', fields: {}, raw: inner };
  const head = parts[0];
  let status = '';
  let multiFlag = '0';
  if (head.length >= 3 && /^\d{3}/.test(head)) {
    status = head.slice(0, 2);
    multiFlag = head.slice(2, 3);
  } else if (head.length >= 2) {
    status = head.slice(0, 2);
    multiFlag = head.length > 2 ? head.slice(2, 3) : '0';
  }
  const fields = {};
  for (let i = 1; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.length >= 3) fields[p.slice(0, 3)] = p.slice(3);
  }
  return { status, multiFlag, fields, raw: inner };
}

/** Purchase (sale) request inner — transaction type 00 + tag 001 amount (cents). */
function buildPurchaseRequestInner(opts) {
  const amountCents = Math.round(Number(opts.amountCents));
  if (!Number.isFinite(amountCents) || amountCents < 0 || amountCents > 99999999) {
    throw new Error('Invalid amountCents');
  }
  const amt = String(amountCents);
  const fields = [`001${amt}`];
  if (opts.tenderType != null && opts.tenderType !== '') {
    fields.push(`002${String(opts.tenderType).slice(0, 1)}`);
  }
  if (opts.clerkId) fields.push(`003${String(opts.clerkId).replace(/[^\d]/g, '').slice(0, 6)}`);
  if (opts.invoice) fields.push(`004${String(opts.invoice).replace(/[^\x20-\x7E]/g, '').slice(0, 40)}`);
  if (opts.customerRef) fields.push(`010${String(opts.customerRef).replace(/[^\x20-\x7E]/g, '').slice(0, 40)}`);
  fields.push('0140');
  return `00${chr(FS)}${fields.join(chr(FS))}`;
}

function buildTerminalInfoRequestInner() {
  return '42';
}

function buildDetailedReportRequestInner() {
  return '30';
}

function isApprovedStatus(status) {
  return status === '00' || status === '01';
}

module.exports = {
  STX,
  ETX,
  FS,
  ACK,
  NAK,
  HEARTBEAT,
  chr,
  buildFramedPacket,
  tryExtractOnePacket,
  parseTerminalResponseInner,
  buildPurchaseRequestInner,
  buildTerminalInfoRequestInner,
  buildDetailedReportRequestInner,
  isApprovedStatus,
};
