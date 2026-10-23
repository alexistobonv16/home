// Standalone Live MPEG-2 Web Worker for in-browser HLS stream decoding
// Zero external dependencies. Self-contained demuxer, decoder, and color converter.

const __factories = {};
const __cache = {};
function __def(id, factory) { __factories[id] = factory; }
function __req(id) {
    const cached = __cache[id];
    if (cached) return cached;
    const factory = __factories[id];
    if (!factory) throw new Error('module not found: ' + id);
    const exports = (__cache[id] = {});
    Object.assign(exports, factory(__req));
    return exports;
}

__def("errors.js", function (__req) {
// Typed errors.
//
// Callers need to tell three situations apart, because the right response differs:
//
//   UnsupportedStreamError - the stream is valid but outside what this decoder handles
//                            (4:2:2, High Level, MPEG-1). Report it to the user; retrying
//                            or resyncing will not help.
//   BitstreamError         - the stream is malformed or we lost sync. Often recoverable by
//                            resyncing at the next sequence header.
//   InternalError          - a decoder invariant broke. Always a bug here, never the data.
//
// Every error carries a byte offset where known, because "it failed" is not actionable and
// "it failed at 0x1A34F" can be dumped and inspected.

class Mpeg2Error extends Error {
    constructor(message, offset) {
        super(offset === undefined ? message : `${message} (at byte offset ${offset})`);
        this.name = new.target.name;
        this.offset = offset;
    }
}

/** The stream is valid MPEG-2 but uses tools this decoder does not implement. */
class UnsupportedStreamError extends Mpeg2Error {
    constructor(message, offset, detail) {
        super(message, offset);
        this.detail = detail;
    }
}

/** The stream is malformed, truncated, or we lost synchronisation. */
class BitstreamError extends Mpeg2Error {}

/** A decoder invariant was violated. This is always a bug in this library. */
class InternalError extends Mpeg2Error {}

return { Mpeg2Error, UnsupportedStreamError, BitstreamError, InternalError };
});

__def("constants.js", function (__req) {
// Constants from ISO/IEC 13818-2 (MPEG-2 Video) and ISO/IEC 13818-1 (Systems).

// ---------------------------------------------------------------------------------------
// Start codes. Every one is preceded by the three-byte prefix 00 00 01.
// ---------------------------------------------------------------------------------------

const START_CODE_PREFIX = 0x000001;

const PICTURE_START_CODE = 0x00;
// 0x01..0xAF are slice start codes; the value carries the slice's vertical position.
const SLICE_START_CODE_MIN = 0x01;
const SLICE_START_CODE_MAX = 0xaf;
const USER_DATA_START_CODE = 0xb2;
const SEQUENCE_HEADER_CODE = 0xb3;
const SEQUENCE_ERROR_CODE = 0xb4;
const EXTENSION_START_CODE = 0xb5;
const SEQUENCE_END_CODE = 0xb7;
const GROUP_START_CODE = 0xb8;

// ---------------------------------------------------------------------------------------
// Extension identifiers, carried in the 4 bits after an extension start code.
// ---------------------------------------------------------------------------------------

const EXT_SEQUENCE = 0x1;
const EXT_SEQUENCE_DISPLAY = 0x2;
const EXT_QUANT_MATRIX = 0x3;
const EXT_COPYRIGHT = 0x4;
const EXT_SEQUENCE_SCALABLE = 0x5;
const EXT_PICTURE_DISPLAY = 0x7;
const EXT_PICTURE_CODING = 0x8;
const EXT_PICTURE_SPATIAL_SCALABLE = 0x9;
const EXT_PICTURE_TEMPORAL_SCALABLE = 0xa;

// ---------------------------------------------------------------------------------------
// Picture coding types.
// ---------------------------------------------------------------------------------------

const PICTURE_TYPE_I = 1;
const PICTURE_TYPE_P = 2;
const PICTURE_TYPE_B = 3;
const PICTURE_TYPE_D = 4; // MPEG-1 only; not valid in MPEG-2.

const PICTURE_TYPE_NAME = { 1: 'I', 2: 'P', 3: 'B', 4: 'D' };

// ---------------------------------------------------------------------------------------
// Picture structure.
//
// A "frame picture" codes both fields together. A field picture codes one field, and two
// complementary field pictures combine into one displayed frame.
// ---------------------------------------------------------------------------------------

const PICTURE_STRUCTURE_TOP_FIELD = 1;
const PICTURE_STRUCTURE_BOTTOM_FIELD = 2;
const PICTURE_STRUCTURE_FRAME = 3;

const PICTURE_STRUCTURE_NAME = {
    0: 'reserved',
    1: 'top field',
    2: 'bottom field',
    3: 'frame',
};

// ---------------------------------------------------------------------------------------
// Chroma format. Only 4:2:0 is in scope; the others are detected so they can be rejected
// with a clear error rather than decoded into garbage.
// ---------------------------------------------------------------------------------------

const CHROMA_420 = 1;
const CHROMA_422 = 2;
const CHROMA_444 = 3;

const CHROMA_FORMAT_NAME = { 0: 'reserved', 1: '4:2:0', 2: '4:2:2', 3: '4:4:4' };

// ---------------------------------------------------------------------------------------
// Profile and level, from profile_and_level_indication in the sequence extension.
// The byte is an escape bit, then 3 bits of profile and 4 bits of level.
// ---------------------------------------------------------------------------------------

const PROFILE_HIGH = 1;
const PROFILE_SPATIALLY_SCALABLE = 2;
const PROFILE_SNR_SCALABLE = 3;
const PROFILE_MAIN = 4;
const PROFILE_SIMPLE = 5;

const PROFILE_NAME = {
    1: 'High',
    2: 'Spatially Scalable',
    3: 'SNR Scalable',
    4: 'Main',
    5: 'Simple',
};

const LEVEL_HIGH = 4;
const LEVEL_HIGH_1440 = 6;
const LEVEL_MAIN = 8;
const LEVEL_LOW = 10;

const LEVEL_NAME = { 4: 'High', 6: 'High 1440', 8: 'Main', 10: 'Low' };

/**
 * Largest frame dimension this decoder will allocate buffers for.
 *
 * A resource limit, not a conformance check, and deliberately far above any frame an MPEG-2
 * level permits so that no real stream meets it. horizontal_size and vertical_size are 14-bit
 * fields, so a corrupt or hostile sequence header can ask for roughly 16383x16383, which is
 * around 400 MB for one frame buffer and several times that once the pool fills. The cap is
 * what turns that into a typed error instead of an out-of-memory crash.
 */
const MAX_FRAME_DIMENSION = 4096;

// ---------------------------------------------------------------------------------------
// Frame rate. The coded value is an index; codes 1..8 are defined and 0 and 9..15 are not.
// MPEG-2 may further scale these with extension_n / extension_d from the sequence
// extension, which is how pulldown-adjusted rates are signalled.
// ---------------------------------------------------------------------------------------

const FRAME_RATE_TABLE = [
    null,
    { num: 24000, den: 1001 },
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30000, den: 1001 },
    { num: 30, den: 1 },
    { num: 50, den: 1 },
    { num: 60000, den: 1001 },
    { num: 60, den: 1 },
];

// ---------------------------------------------------------------------------------------
// Aspect ratio.
//
// Note this is a DISPLAY aspect ratio in MPEG-2. The same field in MPEG-1 held a PIXEL
// aspect ratio, so reusing MPEG-1 tables here produces wrong display geometry.
// ---------------------------------------------------------------------------------------

const ASPECT_RATIO_TABLE = [
    null,
    { name: 'square pixels', num: 1, den: 1 },
    { name: '4:3', num: 4, den: 3 },
    { name: '16:9', num: 16, den: 9 },
    { name: '2.21:1', num: 221, den: 100 },
];

// ---------------------------------------------------------------------------------------
// Systems layer (ISO/IEC 13818-1), needed by the Program and Transport stream demuxers.
// ---------------------------------------------------------------------------------------

const PACK_START_CODE = 0xba;
const SYSTEM_HEADER_START_CODE = 0xbb;
const PROGRAM_STREAM_MAP = 0xbc;
const PRIVATE_STREAM_1 = 0xbd;
const PADDING_STREAM = 0xbe;
const PRIVATE_STREAM_2 = 0xbf;
const PROGRAM_END_CODE = 0xb9;

/** Video PES stream ids occupy 0xE0..0xEF. */
const VIDEO_STREAM_ID_MIN = 0xe0;
const VIDEO_STREAM_ID_MAX = 0xef;
/** Audio PES stream ids occupy 0xC0..0xDF. Demuxed away and discarded. */
const AUDIO_STREAM_ID_MIN = 0xc0;
const AUDIO_STREAM_ID_MAX = 0xdf;

const TS_SYNC_BYTE = 0x47;
const TS_PACKET_SIZE = 188;
/** M2TS/BDAV prefixes each packet with a 4-byte arrival timecode. */
const TS_PACKET_SIZE_M2TS = 192;
/** DVB packets with Reed-Solomon parity appended. */
const TS_PACKET_SIZE_RS = 204;

const TS_STREAM_TYPE_MPEG1_VIDEO = 0x01;
const TS_STREAM_TYPE_MPEG2_VIDEO = 0x02;

return { START_CODE_PREFIX, PICTURE_START_CODE, SLICE_START_CODE_MIN, SLICE_START_CODE_MAX, USER_DATA_START_CODE, SEQUENCE_HEADER_CODE, SEQUENCE_ERROR_CODE, EXTENSION_START_CODE, SEQUENCE_END_CODE, GROUP_START_CODE, EXT_SEQUENCE, EXT_SEQUENCE_DISPLAY, EXT_QUANT_MATRIX, EXT_COPYRIGHT, EXT_SEQUENCE_SCALABLE, EXT_PICTURE_DISPLAY, EXT_PICTURE_CODING, EXT_PICTURE_SPATIAL_SCALABLE, EXT_PICTURE_TEMPORAL_SCALABLE, PICTURE_TYPE_I, PICTURE_TYPE_P, PICTURE_TYPE_B, PICTURE_TYPE_D, PICTURE_TYPE_NAME, PICTURE_STRUCTURE_TOP_FIELD, PICTURE_STRUCTURE_BOTTOM_FIELD, PICTURE_STRUCTURE_FRAME, PICTURE_STRUCTURE_NAME, CHROMA_420, CHROMA_422, CHROMA_444, CHROMA_FORMAT_NAME, PROFILE_HIGH, PROFILE_SPATIALLY_SCALABLE, PROFILE_SNR_SCALABLE, PROFILE_MAIN, PROFILE_SIMPLE, PROFILE_NAME, LEVEL_HIGH, LEVEL_HIGH_1440, LEVEL_MAIN, LEVEL_LOW, LEVEL_NAME, MAX_FRAME_DIMENSION, FRAME_RATE_TABLE, ASPECT_RATIO_TABLE, PACK_START_CODE, SYSTEM_HEADER_START_CODE, PROGRAM_STREAM_MAP, PRIVATE_STREAM_1, PADDING_STREAM, PRIVATE_STREAM_2, PROGRAM_END_CODE, VIDEO_STREAM_ID_MIN, VIDEO_STREAM_ID_MAX, AUDIO_STREAM_ID_MIN, AUDIO_STREAM_ID_MAX, TS_SYNC_BYTE, TS_PACKET_SIZE, TS_PACKET_SIZE_M2TS, TS_PACKET_SIZE_RS, TS_STREAM_TYPE_MPEG1_VIDEO, TS_STREAM_TYPE_MPEG2_VIDEO };
});

__def("bitreader.js", function (__req) {
// Bit-level reader for MPEG-2 bitstreams, plus start-code scanning.
//
// MPEG-2 packs fields at arbitrary bit positions, most significant bit first, so a byte
// reader is not enough. This keeps a 32-bit most-significant-bit-aligned cache and refills
// it a byte at a time.
//
// Everything uses >>> rather than >>. A cache value with bit 31 set is a negative number
// under >>, and every shift after that would be wrong. This is the single easiest way to
// introduce a bug here that only appears on high-bitrate content.
//
// Reads are limited to 25 bits at a time. The refill guarantees at least 25 valid bits are
// present, and JavaScript shift counts are taken modulo 32, so a 32-bit shift would
// silently become a no-op. Every field in MPEG-2 fits within 25 bits; the one 32-bit
// quantity, a start code, is read byte-wise instead.

const { BitstreamError } = __req('errors.js');
const { START_CODE_PREFIX } = __req('constants.js');

/** Maximum bits readable in one call. See the note above about shift counts. */
const MAX_READ_BITS = 25;

class BitReader {
    /**
     * @param {Uint8Array} data
     * @param {number} [start] first byte to read
     * @param {number} [end] one past the last byte to read
     */
    constructor(data, start = 0, end = data.length) {
        this.data = data;
        this.start = start;
        this.end = end;

        this.pos = start;      // next byte to pull into the cache
        this.cache = 0;        // MSB-aligned, always treated as unsigned
        this.cacheBits = 0;    // number of valid bits currently in the cache
        this.overrun = false;  // set once a read went past the end of the data
    }

    /** Absolute bit position from `start`. */
    get bitPosition() {
        return (this.pos - this.start) * 8 - this.cacheBits;
    }

    /** Byte offset into the underlying array of the next unread bit's byte. */
    get byteOffset() {
        return this.start + (this.bitPosition >> 3);
    }

    get bitsRemaining() {
        return (this.end - this.start) * 8 - this.bitPosition;
    }

    get isByteAligned() {
        return (this.bitPosition & 7) === 0;
    }

    _fill() {
        while (this.cacheBits <= 24 && this.pos < this.end) {
            // 24 - cacheBits is 24, 16, 8, then 0. Never negative, so no wrap-around.
            this.cache = (this.cache | (this.data[this.pos++] << (24 - this.cacheBits))) >>> 0;
            this.cacheBits += 8;
        }
    }

    /**
     * Look at the next `n` bits without consuming them.
     * Past the end of data this reads as zeros and sets `overrun`.
     */
    peek(n) {
        this._fill();
        if (this.cacheBits < n) this.overrun = true;
        return this.cache >>> (32 - n);
    }

    /** Consume and return the next `n` bits (1..25). */
    read(n) {
        const value = this.peek(n);
        // n is at most 25, so this shift is well defined.
        this.cache = (this.cache << n) >>> 0;
        this.cacheBits -= n;
        return value;
    }

    /** Consume a single bit as a number (0 or 1). */
    read1() {
        return this.read(1);
    }

    /** Consume a single bit as a boolean. */
    readFlag() {
        return this.read(1) === 1;
    }

    /** Read `n` bits as a two's complement signed value. */
    readSigned(n) {
        const value = this.read(n);
        const signBit = 1 << (n - 1);
        return value & signBit ? value - (1 << n) : value;
    }

    /** Jump to an absolute bit position measured from `start`. */
    seekBit(bit) {
        if (bit < 0) throw new BitstreamError('seek before start of data');
        this.pos = this.start + (bit >>> 3);
        this.cache = 0;
        this.cacheBits = 0;
        const partial = bit & 7;
        if (partial) this.read(partial);
    }

    /** Jump to an absolute byte offset in the underlying array. */
    seekByte(offset) {
        this.seekBit((offset - this.start) * 8);
    }

    /** Skip `n` bits. Handles counts larger than a single read. */
    skip(n) {
        if (n <= MAX_READ_BITS) {
            this.read(n);
            return;
        }
        this.seekBit(this.bitPosition + n);
    }

    /** Advance to the next byte boundary. No-op if already aligned. */
    align() {
        const partial = this.bitPosition & 7;
        if (partial) this.skip(8 - partial);
    }

    /**
     * A marker_bit is a spec-mandated 1 bit used to prevent start code emulation. A zero
     * here means we have lost synchronisation, and continuing would produce nonsense that
     * is harder to diagnose than an immediate failure.
     */
    readMarkerBit(context) {
        if (this.read(1) !== 1) {
            throw new BitstreamError(
                `expected marker bit to be 1${context ? ` in ${context}` : ''}; lost sync`,
                this.byteOffset
            );
        }
    }

    /**
     * True when the next 24 bits are a start code prefix. Only meaningful when byte
     * aligned, which is where start codes always sit.
     */
    atStartCode() {
        return this.bitsRemaining >= 24 && this.peek(24) === START_CODE_PREFIX;
    }

    /**
     * Byte-align, then advance to the next start code, and consume the 32-bit start code.
     * Returns the start code value (the byte after the prefix), or -1 at end of data.
     */
    nextStartCode() {
        this.align();
        const found = findStartCode(this.data, this.byteOffset, this.end);
        if (found < 0) {
            this.seekByte(this.end);
            return -1;
        }
        this.seekByte(found + 3);
        return this.read(8);
    }
}

/**
 * Find the next `00 00 01` prefix at or after `from`, returning the index of its first
 * zero byte, or -1.
 *
 * Any number of zero bytes may precede a start code as stuffing, so this counts a zero run
 * rather than testing fixed triples. Scanning for the 0x01 and looking backwards is the
 * usual speed trick, but correctness comes first here; this is not a hot path, since the
 * decoder walks structure rather than searching.
 */
function findStartCode(data, from, end = data.length) {
    let zeros = 0;
    for (let i = Math.max(0, from); i < end; i++) {
        const byte = data[i];
        if (byte === 0) {
            zeros++;
        } else if (byte === 1 && zeros >= 2) {
            return i - 2;
        } else {
            zeros = 0;
        }
    }
    return -1;
}

/**
 * Find the next start code whose code byte satisfies `predicate`.
 * Returns the index of the prefix's first zero byte, or -1.
 */
function findStartCodeWhere(data, from, predicate, end = data.length) {
    let at = from;
    for (;;) {
        const found = findStartCode(data, at, end);
        if (found < 0) return -1;
        if (found + 3 >= end) return -1;
        if (predicate(data[found + 3])) return found;
        at = found + 3;
    }
}

return { MAX_READ_BITS, BitReader, findStartCode, findStartCodeWhere };
});

__def("demux/detect.js", function (__req) {
// Container detection.
//
// Scored rather than short-circuited on a single byte. A transport stream's sync byte
// (0x47) is a perfectly ordinary byte to find at offset 0 of an elementary stream, and a
// program stream can begin with leading garbage. Testing one byte gets this wrong on real
// files, so each candidate is scored over a window and the best is chosen.

const { PACK_START_CODE, SEQUENCE_HEADER_CODE, TS_PACKET_SIZE, TS_PACKET_SIZE_M2TS, TS_PACKET_SIZE_RS, TS_SYNC_BYTE } = __req('constants.js');
const { findStartCode } = __req('bitreader.js');

const CONTAINER_ELEMENTARY = 'elementary';
const CONTAINER_PROGRAM = 'program';
const CONTAINER_TRANSPORT = 'transport';
const CONTAINER_UNKNOWN = 'unknown';

/** How much of the stream to consider. Enough for many TS packets without scanning a whole file. */
const WINDOW = 64 * 1024;

/** Transport packet sizes to try, in order of how common they are. */
const TS_SIZES = [TS_PACKET_SIZE, TS_PACKET_SIZE_M2TS, TS_PACKET_SIZE_RS];

/**
 * Score a transport stream hypothesis: how consistently does a sync byte appear every
 * `packetSize` bytes, starting at `offset`?
 */
function scoreTransport(data, offset, packetSize, limit) {
    let hits = 0;
    let tried = 0;
    for (let p = offset; p + 1 <= limit; p += packetSize) {
        tried++;
        if (data[p] === TS_SYNC_BYTE) hits++;
        else break; // A single miss breaks the lock; a real TS is exact.
        if (tried >= 32) break;
    }
    return { hits, tried };
}

/**
 * Find the transport stream packet size and byte offset of the first packet, or null.
 * Leading garbage before the first full packet is common in captures, so the search covers
 * a range of starting offsets rather than assuming zero.
 */
function detectTransportLayout(data, limit = Math.min(data.length, WINDOW)) {
    let best = null;
    for (const packetSize of TS_SIZES) {
        // A packet must start within the first packetSize bytes if the stream is aligned
        // at all, so there is no need to search further than one packet in.
        for (let offset = 0; offset < packetSize && offset < limit; offset++) {
            if (data[offset] !== TS_SYNC_BYTE) continue;
            const { hits } = scoreTransport(data, offset, packetSize, limit);
            // Require several consecutive hits: one stray 0x47 proves nothing.
            if (hits >= 4 && (!best || hits > best.hits)) {
                best = { packetSize, offset, hits };
            }
        }
        if (best && best.hits >= 32) break;
    }
    return best;
}

/**
 * Identify the container.
 * @returns {{container: string, offset: number, packetSize?: number, confidence: string}}
 */
function detectContainer(data) {
    const limit = Math.min(data.length, WINDOW);

    // Transport first: its structure is the most distinctive, and a TS payload legitimately
    // contains the start codes the other two are identified by, so testing those first
    // would misidentify it.
    const ts = detectTransportLayout(data, limit);
    if (ts && ts.hits >= 8) {
        return {
            container: CONTAINER_TRANSPORT,
            offset: ts.offset,
            packetSize: ts.packetSize,
            confidence: ts.hits >= 32 ? 'high' : 'medium',
        };
    }

    // Program stream: a pack header, normally at the very start.
    const pack = findStartCode(data, 0, limit);
    if (pack >= 0 && data[pack + 3] === PACK_START_CODE) {
        return { container: CONTAINER_PROGRAM, offset: pack, confidence: 'high' };
    }

    // Elementary stream: a sequence header. Leading garbage is tolerated.
    let at = 0;
    for (let guard = 0; guard < 64; guard++) {
        const found = findStartCode(data, at, limit);
        if (found < 0) break;
        const code = data[found + 3];
        if (code === SEQUENCE_HEADER_CODE) {
            return { container: CONTAINER_ELEMENTARY, offset: found, confidence: 'high' };
        }
        if (code === PACK_START_CODE) {
            return { container: CONTAINER_PROGRAM, offset: found, confidence: 'medium' };
        }
        at = found + 3;
    }

    // A weaker transport match is still better than nothing if we got this far.
    if (ts) {
        return {
            container: CONTAINER_TRANSPORT,
            offset: ts.offset,
            packetSize: ts.packetSize,
            confidence: 'low',
        };
    }

    return { container: CONTAINER_UNKNOWN, offset: 0, confidence: 'none' };
}

return { CONTAINER_ELEMENTARY, CONTAINER_PROGRAM, CONTAINER_TRANSPORT, CONTAINER_UNKNOWN, detectTransportLayout, detectContainer };
});

__def("demux/transport.js", function (__req) {
// MPEG-2 Transport Stream demuxer (ISO/IEC 13818-1).
//
// A transport stream is a flat run of fixed-size packets, each tagged with a PID. Finding
// the video means reading the program tables to learn which PID carries it, then
// reassembling that PID's PES packets.
//
// Packet size and alignment come from detect.js, which scores sync-byte positions rather
// than trusting byte 0, because captures routinely begin mid-packet.

const { BitstreamError, UnsupportedStreamError } = __req('errors.js');
const { SEQUENCE_HEADER_CODE, TS_PACKET_SIZE, TS_PACKET_SIZE_M2TS, TS_STREAM_TYPE_MPEG1_VIDEO, TS_STREAM_TYPE_MPEG2_VIDEO, TS_SYNC_BYTE } = __req('constants.js');
const { findStartCodeWhere } = __req('bitreader.js');
const { detectTransportLayout } = __req('demux/detect.js');

const PAT_PID = 0x0000;
const NULL_PID = 0x1fff;

/** M2TS packets carry a 4-byte arrival timestamp before the sync byte. */
function payloadStartFor(packetSize) {
    return packetSize === TS_PACKET_SIZE_M2TS ? 4 : 0;
}

/** Reassembles PSI sections, which may span packets. */
class SectionAssembler {
    constructor() {
        this.buffer = null;
        this.expected = 0;
    }

    /** @returns {Uint8Array|null} a complete section, if one finished */
    push(data, payloadUnitStart) {
        let at = 0;
        if (payloadUnitStart) {
            // A pointer_field gives the offset to the start of the first section.
            const pointer = data[0];
            at = 1 + pointer;
            if (at >= data.length) return null;
            this.buffer = data.subarray(at);
            // section_length is 12 bits after the 1-byte table id and 4 flag bits.
            if (this.buffer.length < 3) return null;
            this.expected = (((this.buffer[1] & 0x0f) << 8) | this.buffer[2]) + 3;
        } else if (this.buffer) {
            const merged = new Uint8Array(this.buffer.length + data.length);
            merged.set(this.buffer, 0);
            merged.set(data, this.buffer.length);
            this.buffer = merged;
        } else {
            return null;
        }

        if (this.expected > 0 && this.buffer.length >= this.expected) {
            const section = this.buffer.subarray(0, this.expected);
            this.buffer = null;
            this.expected = 0;
            return section;
        }
        return null;
    }
}

/** Parse a Program Association Table, returning the first program's PMT PID. */
function parsePat(section) {
    // table_id(8) section_length(12 with flags) transport_stream_id(16) version(8)
    // section_number(8) last_section_number(8), then 4-byte program entries, then CRC32.
    const end = section.length - 4; // strip CRC32
    for (let at = 8; at + 4 <= end; at += 4) {
        const programNumber = (section[at] << 8) | section[at + 1];
        const pid = ((section[at + 2] & 0x1f) << 8) | section[at + 3];
        // Program 0 is the network information table, not a real program.
        if (programNumber !== 0) return pid;
    }
    return -1;
}

/** Parse a Program Map Table, returning the elementary PID carrying MPEG video. */
function parsePmt(section) {
    const end = section.length - 4;
    if (section.length < 12) return -1;
    const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
    let at = 12 + programInfoLength;

    let fallback = -1;
    while (at + 5 <= end) {
        const streamType = section[at];
        const pid = ((section[at + 1] & 0x1f) << 8) | section[at + 2];
        const esInfoLength = ((section[at + 3] & 0x0f) << 8) | section[at + 4];

        if (streamType === TS_STREAM_TYPE_MPEG2_VIDEO) return pid;
        if (streamType === TS_STREAM_TYPE_MPEG1_VIDEO && fallback < 0) fallback = pid;

        at += 5 + esInfoLength;
    }
    return fallback;
}

/** Strip a PES header, returning the offset of its payload. */
function pesPayloadOffset(data) {
    if (data.length < 9) return -1;
    if (!(data[0] === 0 && data[1] === 0 && data[2] === 1)) return -1;
    // Only the MPEG-2 PES layout appears in transport streams.
    const headerDataLength = data[8];
    return 9 + headerDataLength;
}

/**
 * Demux a transport stream into its video elementary stream.
 *
 * @param {Uint8Array} data
 * @returns {{video: Uint8Array, pts: Array, stats: object}}
 */
/**
 * First pass: find which PID carries the video.
 *
 * This has to happen before any payload is collected, because a stream is under no
 * obligation to place its program tables at the front. Real captures routinely carry
 * hundreds of video packets before the first PAT, and discarding those loses the sequence
 * header along with them, leaving an elementary stream that begins mid-picture.
 *
 * @returns {number} the elementary PID carrying video, or -1
 */
function findVideoPid(data, layout) {
    const packetSize = layout.packetSize;
    const skip = payloadStartFor(packetSize);

    const patAssembler = new SectionAssembler();
    const pmtAssembler = new SectionAssembler();
    let pmtPid = -1;

    for (let at = layout.offset; at + packetSize <= data.length; at += packetSize) {
        const packet = at + skip;
        if (data[packet] !== TS_SYNC_BYTE) continue;

        const pid = ((data[packet + 1] & 0x1f) << 8) | data[packet + 2];
        if (pid !== PAT_PID && pid !== pmtPid) continue;

        const payloadUnitStart = (data[packet + 1] & 0x40) !== 0;
        const adaptationControl = (data[packet + 3] & 0x30) >> 4;
        if (adaptationControl === 0 || adaptationControl === 2) continue;

        let payload = packet + 4;
        if (adaptationControl === 3) payload += 1 + data[payload];

        const payloadEnd = packet + packetSize - (packetSize === 204 ? 16 : 0);
        if (payload >= payloadEnd) continue;
        const body = data.subarray(payload, payloadEnd);

        if (pid === PAT_PID) {
            const section = patAssembler.push(body, payloadUnitStart);
            if (section) {
                const found = parsePat(section);
                if (found >= 0) pmtPid = found;
            }
        } else {
            const section = pmtAssembler.push(body, payloadUnitStart);
            if (section) {
                const found = parsePmt(section);
                if (found >= 0) return found;
            }
        }
    }
    return -1;
}

function demuxTransportStream(data, options = {}) {
    const layout = options.layout ?? detectTransportLayout(data, data.length);
    if (!layout) {
        throw new BitstreamError('no transport stream packet alignment found');
    }

    const packetSize = layout.packetSize;
    const skip = payloadStartFor(packetSize);

    // Resolve the video PID up front, so packets preceding the program tables are still
    // collected rather than thrown away.
    const videoPid = findVideoPid(data, layout);

    const chunks = [];
    let videoLength = 0;
    let pending = null;

    const stats = {
        packets: 0,
        videoPackets: 0,
        scrambled: 0,
        discontinuities: 0,
        packetSize,
    };

    for (let at = layout.offset; at + packetSize <= data.length; at += packetSize) {
        const packet = at + skip;
        if (data[packet] !== TS_SYNC_BYTE) {
            // Lost alignment. Hunt for the next sync byte rather than abandoning the file.
            let resync = -1;
            for (let p = packet + 1; p + packetSize <= data.length; p++) {
                if (data[p] === TS_SYNC_BYTE && data[p + packetSize] === TS_SYNC_BYTE) {
                    resync = p;
                    break;
                }
            }
            if (resync < 0) break;
            at = resync - skip;
            stats.discontinuities++;
            continue;
        }
        stats.packets++;

        const payloadUnitStart = (data[packet + 1] & 0x40) !== 0;
        const pid = ((data[packet + 1] & 0x1f) << 8) | data[packet + 2];
        const scrambling = (data[packet + 3] & 0xc0) >> 6;
        const adaptationControl = (data[packet + 3] & 0x30) >> 4;

        if (pid === NULL_PID) continue;
        if (scrambling !== 0) {
            stats.scrambled++;
            continue;
        }

        let payload = packet + 4;
        if (adaptationControl === 0 || adaptationControl === 2) continue; // no payload
        if (adaptationControl === 3) {
            const adaptationLength = data[payload];
            // A length of zero is legal and consumes exactly the length byte itself.
            payload += 1 + adaptationLength;
        }

        const payloadEnd = packet + packetSize - (packetSize === 204 ? 16 : 0);
        if (payload >= payloadEnd) continue;
        const body = data.subarray(payload, payloadEnd);

        if (pid !== videoPid || videoPid < 0) continue;

        stats.videoPackets++;

        if (payloadUnitStart) {
            // A PES packet length of zero is legal for video in a transport stream: the
            // packet simply runs until the next payload_unit_start on this PID. Truncating
            // there would lose the tail of every picture.
            if (pending) {
                chunks.push(pending);
                videoLength += pending.length;
            }
            const offset = pesPayloadOffset(body);
            // A packet flagged as starting a PES packet that does not actually carry a PES
            // header is damaged. Taking its payload anyway splices noise into the
            // elementary stream, so drop it and wait for the next clean start.
            pending = offset < 0 ? null : body.subarray(offset);
        } else if (pending) {
            // Continuation packets before the first PES start belong to a packet whose
            // header we never saw. That data cannot be reassembled, and `pending` being
            // null here is what discards it.
            const merged = new Uint8Array(pending.length + body.length);
            merged.set(pending, 0);
            merged.set(body, pending.length);
            pending = merged;
        }
    }

    if (pending) {
        chunks.push(pending);
        videoLength += pending.length;
    }

    if (videoPid < 0) {
        throw new UnsupportedStreamError(
            'no MPEG-1 or MPEG-2 video stream found in the transport stream program map'
        );
    }
    if (videoLength === 0) {
        throw new BitstreamError('transport stream contained no video payload');
    }

    const assembled = new Uint8Array(videoLength);
    let out = 0;
    for (const chunk of chunks) {
        assembled.set(chunk, out);
        out += chunk.length;
    }

    // Trim to the first sequence header, as the elementary demuxer does.
    //
    // PES packet boundaries do not align with picture boundaries, so a capture that begins
    // mid-group-of-pictures yields a first PES payload that starts mid-picture. That data
    // references a sequence header and reference frames that were never captured, so it is
    // undecodable; keeping it only produces a stream that begins with a partial picture.
    const requireSequenceHeader = options.requireSequenceHeader ?? true;
    if (!requireSequenceHeader) {
        return { video: assembled, pts: [], stats, videoPid };
    }

    const firstSequenceHeader = findStartCodeWhere(
        assembled,
        0,
        (code) => code === SEQUENCE_HEADER_CODE
    );
    if (firstSequenceHeader < 0) {
        throw new BitstreamError(
            'transport stream video contained no sequence header; nothing decodable'
        );
    }
    stats.trimmedLeadingBytes = firstSequenceHeader;

    return { video: assembled.subarray(firstSequenceHeader), pts: [], stats, videoPid };
}

return { demuxTransportStream };
});

__def("tables.js", function (__req) {
// Static tables from ISO/IEC 13818-2.
//
// Coefficient VLC tables arrive with the intra decoder (M2). This file currently holds the
// coefficient scan orders and the default quantiser matrices, both of which the header
// parser already needs.

// ---------------------------------------------------------------------------------------
// Coefficient scan orders.
//
// Both map a scan position (0..63) to a raster position within the 8x8 block. Which one is
// in force is a per-picture flag (alternate_scan) and is NOT implied by interlacing:
// progressive pictures may use the alternate scan.
// ---------------------------------------------------------------------------------------

/** The default "zigzag" scan. */
const SCAN_ZIGZAG = new Uint8Array([
     0,  1,  8, 16,  9,  2,  3, 10,
    17, 24, 32, 25, 18, 11,  4,  5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13,  6,  7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
]);

/** The alternate scan, selected by alternate_scan=1. MPEG-2 only. */
const SCAN_ALTERNATE = new Uint8Array([
     0,  8, 16, 24,  1,  9,  2, 10,
    17, 25, 32, 40, 48, 56, 57, 49,
    41, 33, 26, 18,  3, 11,  4, 12,
    19, 27, 34, 42, 50, 58, 35, 43,
    51, 59, 20, 28,  5, 13,  6, 14,
    21, 29, 36, 44, 52, 60, 37, 45,
    53, 61, 22, 30,  7, 15, 23, 31,
    38, 46, 54, 62, 39, 47, 55, 63,
]);

// ---------------------------------------------------------------------------------------
// Default quantiser matrices.
//
// Both are expressed here in ZIGZAG order, which is the order matrices are transmitted in
// and therefore the order they are conventionally written. Use dezigzag() before indexing
// them by raster position.
// ---------------------------------------------------------------------------------------

/** Default intra quantiser matrix, in zigzag order. */
const DEFAULT_INTRA_QUANTISER_MATRIX = new Uint8Array([
     8, 16, 16, 19, 16, 19, 22, 22,
    22, 22, 22, 22, 26, 24, 26, 27,
    27, 27, 26, 26, 26, 26, 27, 27,
    27, 29, 29, 29, 34, 34, 34, 29,
    29, 29, 27, 27, 29, 29, 32, 32,
    34, 34, 37, 38, 37, 35, 35, 34,
    35, 38, 38, 40, 40, 40, 48, 48,
    46, 46, 56, 56, 58, 69, 69, 83,
]);

/** Default non-intra quantiser matrix: uniform, so scan order does not affect it. */
const DEFAULT_NON_INTRA_QUANTISER_MATRIX = new Uint8Array(64).fill(16);

/**
 * Convert a matrix from transmitted (zigzag) order into raster order.
 *
 * Quantiser matrices are ALWAYS transmitted in the default zigzag order, even when the
 * picture uses the alternate scan. Applying the alternate scan here instead produces a
 * mild, uniform quality loss that looks entirely plausible, which is why this function
 * takes no scan argument: there is only one correct answer.
 */
function dezigzag(zigzagOrdered, out = new Uint8Array(64)) {
    for (let i = 0; i < 64; i++) out[SCAN_ZIGZAG[i]] = zigzagOrdered[i];
    return out;
}

/** Default intra quantiser matrix in raster order, ready to index by coefficient position. */
const DEFAULT_INTRA_QUANTISER_MATRIX_RASTER = dezigzag(DEFAULT_INTRA_QUANTISER_MATRIX);

/** Default non-intra quantiser matrix in raster order. */
const DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER = dezigzag(
    DEFAULT_NON_INTRA_QUANTISER_MATRIX
);

// ---------------------------------------------------------------------------------------
// Quantiser scale.
// ---------------------------------------------------------------------------------------

/**
 * Non-linear quantiser scale, selected by q_scale_type=1, indexed by quantiser_scale_code.
 * Index 0 is unused; a code of 0 is not valid in a bitstream.
 *
 * When q_scale_type=0 the scale is simply 2 * quantiser_scale_code.
 */
const NON_LINEAR_QUANTISER_SCALE = new Uint8Array([
     0,  1,  2,  3,  4,  5,   6,   7,
     8, 10, 12, 14, 16, 18,  20,  22,
    24, 28, 32, 36, 40, 44,  48,  52,
    56, 64, 72, 80, 88, 96, 104, 112,
]);

/** Resolve quantiser_scale_code to the effective quantiser scale. */
function quantiserScale(code, qScaleType) {
    return qScaleType ? NON_LINEAR_QUANTISER_SCALE[code] : code << 1;
}

return { SCAN_ZIGZAG, SCAN_ALTERNATE, DEFAULT_INTRA_QUANTISER_MATRIX, DEFAULT_NON_INTRA_QUANTISER_MATRIX, dezigzag, DEFAULT_INTRA_QUANTISER_MATRIX_RASTER, DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER, NON_LINEAR_QUANTISER_SCALE, quantiserScale };
});

__def("sequence.js", function (__req) {
// Sequence layer: sequence_header, sequence_extension, sequence_display_extension and
// quant_matrix_extension.
//
// SequenceState accumulates configuration across those headers and persists until the next
// sequence header. A stream may repeat sequence headers periodically (every GOP is common,
// to allow random access), so parsing must be idempotent and must handle values changing
// mid-stream.

const { BitstreamError, UnsupportedStreamError } = __req('errors.js');
const { ASPECT_RATIO_TABLE, CHROMA_420, CHROMA_FORMAT_NAME, FRAME_RATE_TABLE, LEVEL_NAME, MAX_FRAME_DIMENSION, PROFILE_MAIN, PROFILE_NAME, PROFILE_SIMPLE } = __req('constants.js');
const { DEFAULT_INTRA_QUANTISER_MATRIX_RASTER, DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER, dezigzag } = __req('tables.js');

/** Read a 64-entry quantiser matrix and convert it from transmitted order to raster order. */
function readQuantiserMatrix(reader, out) {
    // Transmitted in zigzag order ALWAYS, regardless of the picture's alternate_scan flag.
    const zigzag = new Uint8Array(64);
    for (let i = 0; i < 64; i++) zigzag[i] = reader.read(8);
    return dezigzag(zigzag, out);
}

class SequenceState {
    constructor() {
        // Set once a sequence header has been seen.
        this.hasHeader = false;
        // Set once a sequence extension has been seen. Its absence means MPEG-1.
        this.isMpeg2 = false;

        this.width = 0;
        this.height = 0;
        this.aspectRatioCode = 0;
        this.frameRateCode = 0;
        this.bitRateValue = 0;
        this.vbvBufferSizeValue = 0;
        this.constrainedParameters = false;

        this.profile = 0;
        this.level = 0;
        this.escapedProfileLevel = false;
        this.progressiveSequence = true;
        this.chromaFormat = CHROMA_420;
        this.lowDelay = false;
        this.frameRateExtensionN = 0;
        this.frameRateExtensionD = 0;

        // Display extension. Absent in most streams.
        this.hasDisplayExtension = false;
        this.videoFormat = 5; // "unspecified"
        this.colourDescription = false;
        this.colourPrimaries = 1;
        this.transferCharacteristics = 1;
        this.matrixCoefficients = 1;
        this.displayWidth = 0;
        this.displayHeight = 0;

        // Quantiser matrices, held in RASTER order ready for dequantisation.
        this.intraQuantiserMatrix = new Uint8Array(DEFAULT_INTRA_QUANTISER_MATRIX_RASTER);
        this.nonIntraQuantiserMatrix = new Uint8Array(DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER);
        // 4:2:0 shares the luma matrices for chroma; separate chroma matrices only carry
        // meaning at 4:2:2 and above. Parsed for correct bit consumption regardless.
        this.chromaIntraQuantiserMatrix = new Uint8Array(DEFAULT_INTRA_QUANTISER_MATRIX_RASTER);
        this.chromaNonIntraQuantiserMatrix = new Uint8Array(
            DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER
        );
    }

    /** Macroblocks per row. */
    get mbWidth() {
        return (this.width + 15) >> 4;
    }

    /**
     * Macroblock rows in a full frame.
     *
     * An interlaced sequence must have an even number of macroblock rows, so that each
     * field gets a whole number of them. The coded frame is therefore rounded up to a
     * multiple of 32 lines rather than 16.
     *
     * The two formulas agree whenever the height is already a multiple of 32, which covers
     * 480 and 576 line content and hides the distinction on most real material. They differ
     * at, for example, 112 lines: 7 rows if treated as progressive, 8 if interlaced. Get it
     * wrong and the final slice row of every picture is rejected as out of range.
     */
    get mbHeight() {
        return this.progressiveSequence
            ? (this.height + 15) >> 4
            : 2 * ((this.height + 31) >> 5);
    }

    /** Frames per second as a number, including the MPEG-2 extension scaling. */
    get frameRate() {
        const base = FRAME_RATE_TABLE[this.frameRateCode];
        if (!base) return 0;
        const n = this.frameRateExtensionN + 1;
        const d = this.frameRateExtensionD + 1;
        return (base.num * n) / (base.den * d);
    }

    get aspectRatio() {
        return ASPECT_RATIO_TABLE[this.aspectRatioCode] || null;
    }

    get profileName() {
        return PROFILE_NAME[this.profile] || `unknown(${this.profile})`;
    }

    get levelName() {
        return LEVEL_NAME[this.level] || `unknown(${this.level})`;
    }

    /** Bitrate in bits per second, or 0 when unspecified. */
    get bitrate() {
        return this.bitRateValue * 400;
    }
}

/**
 * Parse sequence_header(), with the start code already consumed.
 */
function parseSequenceHeader(reader, state, offset) {
    const horizontalSizeValue = reader.read(12);
    const verticalSizeValue = reader.read(12);
    if (horizontalSizeValue === 0 || verticalSizeValue === 0) {
        throw new BitstreamError(
            `invalid sequence dimensions ${horizontalSizeValue}x${verticalSizeValue}`,
            offset
        );
    }

    state.aspectRatioCode = reader.read(4);
    state.frameRateCode = reader.read(4);
    state.bitRateValue = reader.read(18);
    reader.readMarkerBit('sequence_header');
    state.vbvBufferSizeValue = reader.read(10);
    state.constrainedParameters = reader.readFlag();

    // Held separately from the final size: the sequence extension supplies high-order bits
    // that are only known once it has been parsed.
    state.horizontalSizeValue = horizontalSizeValue;
    state.verticalSizeValue = verticalSizeValue;
    state.width = horizontalSizeValue;
    state.height = verticalSizeValue;

    // A zero flag here means REVERT TO DEFAULT, not "leave unchanged". The identically
    // named flag in quant_matrix_extension means the opposite. Getting this backwards makes
    // a stream that loads a matrix once and then omits it decode with wrong contrast
    // forever after.
    if (reader.readFlag()) {
        readQuantiserMatrix(reader, state.intraQuantiserMatrix);
    } else {
        state.intraQuantiserMatrix.set(DEFAULT_INTRA_QUANTISER_MATRIX_RASTER);
    }
    if (reader.readFlag()) {
        readQuantiserMatrix(reader, state.nonIntraQuantiserMatrix);
    } else {
        state.nonIntraQuantiserMatrix.set(DEFAULT_NON_INTRA_QUANTISER_MATRIX_RASTER);
    }
    // At 4:2:0 chroma reuses the luma matrices unless a quant_matrix_extension overrides.
    state.chromaIntraQuantiserMatrix.set(state.intraQuantiserMatrix);
    state.chromaNonIntraQuantiserMatrix.set(state.nonIntraQuantiserMatrix);

    state.hasHeader = true;
    return state;
}

/**
 * Parse sequence_extension(), with the extension start code and its 4-bit identifier
 * already consumed.
 */
function parseSequenceExtension(reader, state, offset) {
    if (!state.hasHeader) {
        throw new BitstreamError('sequence extension before any sequence header', offset);
    }

    const profileAndLevel = reader.read(8);
    // The top bit is an escape flag for profiles outside the basic set.
    state.escapedProfileLevel = (profileAndLevel & 0x80) !== 0;
    state.profile = (profileAndLevel >> 4) & 0x07;
    state.level = profileAndLevel & 0x0f;

    state.progressiveSequence = reader.readFlag();
    state.chromaFormat = reader.read(2);
    const horizontalSizeExtension = reader.read(2);
    const verticalSizeExtension = reader.read(2);
    const bitRateExtension = reader.read(12);
    reader.readMarkerBit('sequence_extension');
    const vbvBufferSizeExtension = reader.read(8);
    state.lowDelay = reader.readFlag();
    state.frameRateExtensionN = reader.read(2);
    state.frameRateExtensionD = reader.read(5);

    // MPEG-1 has no extension bits; these widen the sizes beyond 12 bits.
    state.width = (horizontalSizeExtension << 12) | state.horizontalSizeValue;
    state.height = (verticalSizeExtension << 12) | state.verticalSizeValue;
    state.bitRateValue = (bitRateExtension << 18) | state.bitRateValue;
    state.vbvBufferSizeValue = (vbvBufferSizeExtension << 10) | state.vbvBufferSizeValue;

    state.isMpeg2 = true;
    return state;
}

/** Parse sequence_display_extension(), identifier already consumed. */
function parseSequenceDisplayExtension(reader, state) {
    state.videoFormat = reader.read(3);
    state.colourDescription = reader.readFlag();
    if (state.colourDescription) {
        state.colourPrimaries = reader.read(8);
        state.transferCharacteristics = reader.read(8);
        state.matrixCoefficients = reader.read(8);
    }
    state.displayWidth = reader.read(14);
    reader.readMarkerBit('sequence_display_extension');
    state.displayHeight = reader.read(14);
    state.hasDisplayExtension = true;
    return state;
}

/**
 * Parse quant_matrix_extension(), identifier already consumed.
 *
 * Note the flag semantics are the OPPOSITE of the sequence header: a zero here means
 * "unchanged", not "revert to default".
 *
 * A loaded luma matrix REPLACES the chroma matrix too. The spec states it for 4:2:2 and
 * 4:4:4 ("the new values shall be used for both the luminance intra matrix and the
 * chrominance intra matrix"), and at 4:2:0 it is unavoidable, because there
 * load_chroma_intra_quantiser_matrix shall be zero and so a separate chroma matrix can
 * never be loaded at all: the luma matrix is the only matrix there is.
 *
 * Leaving the chroma copies behind here is a nasty defect. Luma decodes perfectly while
 * chroma dequantises against a stale matrix, so the picture keeps its detail and only
 * colour drifts, by an amount too small to look like a decoder fault. The order below
 * matters as well: the chroma load comes after, because 4:2:2 and 4:4:4 are allowed to
 * override with a different matrix once this one has been applied.
 */
function parseQuantMatrixExtension(reader, state) {
    if (reader.readFlag()) {
        readQuantiserMatrix(reader, state.intraQuantiserMatrix);
        state.chromaIntraQuantiserMatrix.set(state.intraQuantiserMatrix);
    }
    if (reader.readFlag()) {
        readQuantiserMatrix(reader, state.nonIntraQuantiserMatrix);
        state.chromaNonIntraQuantiserMatrix.set(state.nonIntraQuantiserMatrix);
    }
    if (reader.readFlag()) readQuantiserMatrix(reader, state.chromaIntraQuantiserMatrix);
    if (reader.readFlag()) readQuantiserMatrix(reader, state.chromaNonIntraQuantiserMatrix);
    return state;
}

/**
 * Reject streams this decoder does not implement, with a message that says what and why.
 *
 * Called once a sequence header and extension have both been seen. Failing loudly here is
 * the whole point: decoding an out-of-scope stream anyway produces plausible-looking
 * garbage that is far harder to diagnose than a refusal.
 */
function validateSequence(state, offset) {
    if (!state.isMpeg2) {
        throw new UnsupportedStreamError(
            'stream appears to be MPEG-1 (no sequence extension). This decoder implements ' +
            'MPEG-2, which differs in escape coding, dequantisation and mismatch control',
            offset,
            { reason: 'mpeg1' }
        );
    }
    if (state.chromaFormat !== CHROMA_420) {
        const name = CHROMA_FORMAT_NAME[state.chromaFormat] || state.chromaFormat;
        throw new UnsupportedStreamError(
            `chroma format ${name} is not supported; this decoder implements 4:2:0 only`,
            offset,
            { reason: 'chroma', chromaFormat: state.chromaFormat }
        );
    }
    if (state.profile !== PROFILE_MAIN && state.profile !== PROFILE_SIMPLE) {
        throw new UnsupportedStreamError(
            `profile ${state.profileName} is not supported; Main and Simple only`,
            offset,
            { reason: 'profile', profile: state.profile }
        );
    }
    // Every level defined for Main Profile decodes: Low, Main, High 1440 and High all use the
    // same coding tools, and nothing in this decoder is sized to a particular level. High
    // Level is what DICOM PS3.5 8.2.6 requires (transfer syntax 1.2.840.10008.1.2.4.101),
    // Main Level what 8.2.5 requires (1.2.840.10008.1.2.4.100). Only reserved values are
    // rejected, because a level this table does not know is a header that was not understood.
    if (LEVEL_NAME[state.level] === undefined) {
        throw new UnsupportedStreamError(
            `level ${state.level} is reserved and not defined by this specification`,
            offset,
            { reason: 'level', level: state.level }
        );
    }
    // Guard the frame pool against a header asking for an absurd frame. See
    // MAX_FRAME_DIMENSION: this bounds memory, it does not check level conformance.
    if (state.width > MAX_FRAME_DIMENSION || state.height > MAX_FRAME_DIMENSION) {
        throw new UnsupportedStreamError(
            `frame size ${state.width}x${state.height} exceeds the ${MAX_FRAME_DIMENSION} ` +
            'sample limit this decoder will allocate buffers for',
            offset,
            { reason: 'size', width: state.width, height: state.height }
        );
    }
    return state;
}

return { SequenceState, parseSequenceHeader, parseSequenceExtension, parseSequenceDisplayExtension, parseQuantMatrixExtension, validateSequence };
});

__def("picture.js", function (__req) {
// Picture layer: group_of_pictures_header, picture_header and picture_coding_extension.
//
// PictureState is reset per picture. Nothing here decodes pixels; it establishes the
// parameters every later stage depends on.

const { BitstreamError } = __req('errors.js');
const { PICTURE_STRUCTURE_FRAME, PICTURE_STRUCTURE_NAME, PICTURE_TYPE_B, PICTURE_TYPE_D, PICTURE_TYPE_I, PICTURE_TYPE_NAME, PICTURE_TYPE_P } = __req('constants.js');

/** f_code value meaning "no motion vectors in this direction". Not a real range. */
const F_CODE_UNUSED = 15;

class PictureState {
    constructor() {
        this.reset();
    }

    reset() {
        this.temporalReference = 0;
        this.codingType = 0;
        this.vbvDelay = 0;

        // f_code[direction][component]: direction 0 = forward, 1 = backward;
        // component 0 = horizontal, 1 = vertical.
        //
        // The index order matters and is easy to transpose. In progressive content the four
        // values are often equal, which hides a transposition completely; interlaced content
        // typically uses a smaller vertical code and exposes it immediately.
        this.fCode = [
            [F_CODE_UNUSED, F_CODE_UNUSED],
            [F_CODE_UNUSED, F_CODE_UNUSED],
        ];

        this.intraDcPrecision = 0;
        this.pictureStructure = PICTURE_STRUCTURE_FRAME;
        this.topFieldFirst = false;
        this.framePredFrameDct = false;
        this.concealmentMotionVectors = false;
        this.qScaleType = false;
        this.intraVlcFormat = false;
        this.alternateScan = false;
        this.repeatFirstField = false;
        this.chroma420Type = false;
        this.progressiveFrame = false;
        this.compositeDisplayFlag = false;

        this.hasCodingExtension = false;
    }

    get typeName() {
        return PICTURE_TYPE_NAME[this.codingType] || `unknown(${this.codingType})`;
    }

    get structureName() {
        return PICTURE_STRUCTURE_NAME[this.pictureStructure] || `unknown(${this.pictureStructure})`;
    }

    get isFramePicture() {
        return this.pictureStructure === PICTURE_STRUCTURE_FRAME;
    }

    /** True when this picture is used as a reference by later pictures. */
    get isReference() {
        return this.codingType === PICTURE_TYPE_I || this.codingType === PICTURE_TYPE_P;
    }
}

class GopState {
    constructor() {
        this.hours = 0;
        this.minutes = 0;
        this.seconds = 0;
        this.frames = 0;
        this.dropFrame = false;
        this.closedGop = false;
        this.brokenLink = false;
    }
}

/** Parse group_of_pictures_header(), start code already consumed. */
function parseGopHeader(reader, gop = new GopState()) {
    // time_code is 25 bits: drop frame flag, hours, minutes, a marker, seconds, frames.
    gop.dropFrame = reader.readFlag();
    gop.hours = reader.read(5);
    gop.minutes = reader.read(6);
    reader.readMarkerBit('group_of_pictures_header time_code');
    gop.seconds = reader.read(6);
    gop.frames = reader.read(6);

    // closed_gop=0 at a random access point means the leading B pictures reference a frame
    // that was never decoded; broken_link=1 means the same after an edit. Both are recorded
    // so the frame store can drop those B pictures instead of predicting from nothing.
    gop.closedGop = reader.readFlag();
    gop.brokenLink = reader.readFlag();
    return gop;
}

/** Parse picture_header(), start code already consumed. */
function parsePictureHeader(reader, picture, offset) {
    picture.reset();
    picture.temporalReference = reader.read(10);
    picture.codingType = reader.read(3);
    picture.vbvDelay = reader.read(16);

    if (picture.codingType === PICTURE_TYPE_D) {
        throw new BitstreamError('D pictures are MPEG-1 only and not valid in MPEG-2', offset);
    }
    if (picture.codingType < PICTURE_TYPE_I || picture.codingType > PICTURE_TYPE_D) {
        throw new BitstreamError(`invalid picture_coding_type ${picture.codingType}`, offset);
    }

    // These are MPEG-1 legacy fields. They must be READ so the bit position stays correct,
    // and then IGNORED: in MPEG-2 the real f_codes come from picture_coding_extension, and
    // a conformant encoder writes 7 here. Using these values decodes every motion vector
    // wrong while still looking like a plausible decoder.
    if (picture.codingType === PICTURE_TYPE_P || picture.codingType === PICTURE_TYPE_B) {
        reader.read(1); // full_pel_forward_vector - MPEG-1 only, always 0 in MPEG-2
        reader.read(3); // forward_f_code - superseded by picture_coding_extension
    }
    if (picture.codingType === PICTURE_TYPE_B) {
        reader.read(1); // full_pel_backward_vector
        reader.read(3); // backward_f_code
    }

    // extra_information_picture: a 1 bit introduces another byte, terminated by a 0 bit.
    let guard = 0;
    while (reader.read(1) === 1) {
        reader.read(8);
        if (++guard > 4096) {
            throw new BitstreamError('runaway extra_information_picture; lost sync', offset);
        }
    }

    return picture;
}

/** Parse picture_coding_extension(), extension identifier already consumed. */
function parsePictureCodingExtension(reader, picture, offset) {
    picture.fCode[0][0] = reader.read(4);
    picture.fCode[0][1] = reader.read(4);
    picture.fCode[1][0] = reader.read(4);
    picture.fCode[1][1] = reader.read(4);

    picture.intraDcPrecision = reader.read(2);
    picture.pictureStructure = reader.read(2);
    picture.topFieldFirst = reader.readFlag();
    picture.framePredFrameDct = reader.readFlag();
    picture.concealmentMotionVectors = reader.readFlag();
    picture.qScaleType = reader.readFlag();
    picture.intraVlcFormat = reader.readFlag();
    picture.alternateScan = reader.readFlag();
    picture.repeatFirstField = reader.readFlag();
    picture.chroma420Type = reader.readFlag();
    picture.progressiveFrame = reader.readFlag();
    picture.compositeDisplayFlag = reader.readFlag();

    if (picture.compositeDisplayFlag) {
        reader.read(1); // v_axis
        reader.read(3); // field_sequence
        reader.read(1); // sub_carrier
        reader.read(7); // burst_amplitude
        reader.read(8); // sub_carrier_phase
    }

    if (picture.pictureStructure === 0) {
        throw new BitstreamError('picture_structure 0 is reserved', offset);
    }

    // A frame picture that claims to be progressive must also use frame prediction and
    // frame DCT. If this ever fires, either the stream is malformed or the parse has
    // desynchronised, and both are better caught here than as corrupt pixels later.
    if (picture.progressiveFrame && !picture.framePredFrameDct) {
        throw new BitstreamError(
            'progressive_frame=1 requires frame_pred_frame_dct=1; likely lost sync',
            offset
        );
    }

    picture.hasCodingExtension = true;
    return picture;
}

/**
 * Number of macroblock rows in this picture.
 *
 * A field picture covers half the frame's rows, so this is NOT simply the frame's
 * macroblock height. Using the frame value for a field picture walks off the end of the
 * slice structure.
 */
function pictureMbHeight(sequence, picture) {
    return picture.isFramePicture ? sequence.mbHeight : (sequence.mbHeight + 1) >> 1;
}

return { F_CODE_UNUSED, PictureState, GopState, parseGopHeader, parsePictureHeader, parsePictureCodingExtension, pictureMbHeight };
});

__def("frame.js", function (__req) {
// Decoded frame buffers and the pool that recycles them.
//
// One ArrayBuffer holds all three planes. That is deliberate: it makes a frame a single
// transferable object, so handing one to the main thread from a worker costs one postMessage
// with one transfer rather than three.
//
// Planes carry a border on all four sides. Motion vectors are allowed to point outside the
// picture, and replicating the edges once per frame is both cheaper and less error-prone
// than clamping coordinates on every pixel access in the interpolation loops.

/** Border in luma samples on each side. Sized to cover the largest legal vector overhang. */
const LUMA_BORDER = 32;
/** Chroma is half resolution in both directions at 4:2:0. */
const CHROMA_BORDER = LUMA_BORDER >> 1;

class Frame {
    /**
     * @param {number} mbWidth macroblocks per row
     * @param {number} mbHeight macroblock rows in a full frame
     */
    constructor(mbWidth, mbHeight) {
        this.mbWidth = mbWidth;
        this.mbHeight = mbHeight;

        this.codedWidth = mbWidth * 16;
        this.codedHeight = mbHeight * 16;

        this.lumaStride = this.codedWidth + LUMA_BORDER * 2;
        this.lumaHeight = this.codedHeight + LUMA_BORDER * 2;
        this.chromaStride = this.lumaStride >> 1;
        this.chromaHeight = this.lumaHeight >> 1;

        const lumaSize = this.lumaStride * this.lumaHeight;
        const chromaSize = this.chromaStride * this.chromaHeight;

        this.buffer = new ArrayBuffer(lumaSize + chromaSize * 2);
        this.y = new Uint8Array(this.buffer, 0, lumaSize);
        this.cb = new Uint8Array(this.buffer, lumaSize, chromaSize);
        this.cr = new Uint8Array(this.buffer, lumaSize + chromaSize, chromaSize);

        // Offset of picture sample (0,0) within each plane, skipping the border.
        this.lumaOrigin = LUMA_BORDER * this.lumaStride + LUMA_BORDER;
        this.chromaOrigin = CHROMA_BORDER * this.chromaStride + CHROMA_BORDER;

        // Set by the decoder as the frame is produced.
        this.pictureCodingType = 0;
        this.temporalReference = 0;
        this.pts = null;
        this.displayIndex = -1;
        /** Which fields have been decoded into this frame, for field pairing. */
        this.fieldsDecoded = 0;
    }

    /** Byte offset of luma sample (x, y). */
    lumaOffset(x, y) {
        return this.lumaOrigin + y * this.lumaStride + x;
    }

    /** Byte offset of chroma sample (x, y), in chroma coordinates. */
    chromaOffset(x, y) {
        return this.chromaOrigin + y * this.chromaStride + x;
    }

    /** Fill the whole frame with mid grey. Used when a reference is missing. */
    clearToGrey() {
        this.y.fill(128);
        this.cb.fill(128);
        this.cr.fill(128);
    }

    /**
     * Replicate edge samples outward into the border.
     *
     * Must run after a frame is fully decoded and before it is used as a reference. With
     * field pictures the first field has to be padded as soon as it completes, because the
     * second field of the same frame may reference it.
     */
    padBorders() {
        padPlane(this.y, this.lumaStride, this.lumaHeight, LUMA_BORDER, this.codedWidth, this.codedHeight);
        padPlane(
            this.cb,
            this.chromaStride,
            this.chromaHeight,
            CHROMA_BORDER,
            this.codedWidth >> 1,
            this.codedHeight >> 1
        );
        padPlane(
            this.cr,
            this.chromaStride,
            this.chromaHeight,
            CHROMA_BORDER,
            this.codedWidth >> 1,
            this.codedHeight >> 1
        );
    }

    reset() {
        this.pictureCodingType = 0;
        this.temporalReference = 0;
        this.pts = null;
        this.displayIndex = -1;
        this.fieldsDecoded = 0;
    }
}

function padPlane(plane, stride, height, border, width, pictureHeight) {
    const origin = border * stride + border;

    // Left and right edges.
    for (let y = 0; y < pictureHeight; y++) {
        const row = origin + y * stride;
        const left = plane[row];
        const right = plane[row + width - 1];
        for (let i = 1; i <= border; i++) {
            plane[row - i] = left;
            plane[row + width - 1 + i] = right;
        }
    }

    // Top and bottom, copying whole rows now that the sides are filled.
    const firstRow = origin - border;
    const lastRow = origin + (pictureHeight - 1) * stride - border;
    const rowLength = width + border * 2;
    for (let i = 1; i <= border; i++) {
        plane.copyWithin(firstRow - i * stride, firstRow, firstRow + rowLength);
        plane.copyWithin(lastRow + i * stride, lastRow, lastRow + rowLength);
    }
}

/**
 * Recycles frames so steady-state decoding allocates nothing.
 *
 * Frames are refcounted rather than owned outright, because a frame can be simultaneously
 * a reference for future pictures and queued for display.
 */
class FramePool {
    constructor(mbWidth, mbHeight) {
        this.mbWidth = mbWidth;
        this.mbHeight = mbHeight;
        this.free = [];
        this.allocated = 0;
    }

    acquire() {
        const frame = this.free.pop() ?? this._allocate();
        frame.reset();
        frame.refCount = 1;
        return frame;
    }

    _allocate() {
        this.allocated++;
        const frame = new Frame(this.mbWidth, this.mbHeight);
        frame.pool = this;
        frame.refCount = 0;
        return frame;
    }

    release(frame) {
        if (!frame) return;
        if (--frame.refCount <= 0) {
            frame.refCount = 0;
            this.free.push(frame);
        }
    }

    /** True when every frame handed out has come back. Used by the leak test. */
    get isBalanced() {
        return this.free.length === this.allocated;
    }
}

function retain(frame) {
    if (frame) frame.refCount++;
    return frame;
}

return { LUMA_BORDER, CHROMA_BORDER, Frame, FramePool, retain };
});

__def("vlc.js", function (__req) {
// Variable length code tables and decoder (ISO/IEC 13818-2 Annex B).
//
// Tables are written as bit strings rather than packed numbers. That costs a little startup
// time to build the lookups, and buys the ability to read a table entry and check it against
// the specification by eye. Given that a single wrong entry produces subtly wrong pixels
// rather than an obvious failure, that trade is worth making.
//
// Decoding uses a two-level lookup: peek PRIMARY_BITS and resolve short codes immediately;
// longer codes escape into a small secondary table. Flat single-level tables would need
// 65536 entries for the coefficient tables, which is a lot of memory to carry around for
// no gain.

const { BitstreamError } = __req('errors.js');

/** Bits resolved by the first-level lookup. */
const PRIMARY_BITS = 9;

/** Returned by coefficient tables instead of a run/level pair. */
const VLC_END_OF_BLOCK = -1;
const VLC_ESCAPE = -2;
/** Returned by macroblock_address_increment for the escape code, which adds 33. */
const VLC_MACROBLOCK_ESCAPE = -3;
/** No code matched. Always a stream error or lost synchronisation. */
const VLC_INVALID = -0x7fffffff;

class Vlc {
    /**
     * @param {string} name for diagnostics
     * @param {Array<[string, number]>} entries [bit string, payload]
     */
    constructor(name, entries) {
        this.name = name;
        this.entries = entries;

        let maxLength = 0;
        for (const [code] of entries) maxLength = Math.max(maxLength, code.length);
        this.maxLength = maxLength;
        this.primaryBits = Math.min(PRIMARY_BITS, maxLength);
        this.secondaryBits = Math.max(0, maxLength - this.primaryBits);

        // Packed as (length << 24) | (payloadIndex + 1); 0 means "no code here".
        // Negative marks an escape into secondary[-value - 1].
        this.primary = new Int32Array(1 << this.primaryBits);
        this.payloads = [];
        this.secondary = [];

        this._build(entries);
    }

    _build(entries) {
        const pending = new Map(); // primary prefix -> entries needing a secondary table

        for (const [code, payload] of entries) {
            const bits = code.replace(/\s+/g, '');
            const length = bits.length;
            const value = parseInt(bits, 2);
            const payloadIndex = this.payloads.push(payload) - 1;

            if (length <= this.primaryBits) {
                // Fill every primary slot whose high bits match this code.
                const shift = this.primaryBits - length;
                const base = value << shift;
                const packed = (length << 24) | (payloadIndex + 1);
                for (let i = 0; i < 1 << shift; i++) {
                    this.primary[base + i] = packed;
                }
            } else {
                const prefix = value >>> (length - this.primaryBits);
                if (!pending.has(prefix)) pending.set(prefix, []);
                pending.get(prefix).push({ bits, length, payloadIndex });
            }
        }

        for (const [prefix, group] of pending) {
            const table = new Int32Array(1 << this.secondaryBits);
            for (const { length, bits, payloadIndex } of group) {
                const remaining = length - this.primaryBits;
                const suffix = parseInt(bits.slice(this.primaryBits), 2);
                const shift = this.secondaryBits - remaining;
                const base = suffix << shift;
                const packed = (length << 24) | (payloadIndex + 1);
                for (let i = 0; i < 1 << shift; i++) {
                    table[base + i] = packed;
                }
            }
            this.secondary.push(table);
            this.primary[prefix] = -this.secondary.length; // -1 based, so never 0
        }
    }

    /**
     * Decode one symbol. Returns the payload, or VLC_INVALID if no code matched.
     * On a valid match the reader is advanced by exactly the code length.
     */
    decode(reader) {
        let packed = this.primary[reader.peek(this.primaryBits)];

        if (packed < 0) {
            const table = this.secondary[-packed - 1];
            // Peeking the full width is safe: the reader zero-pads past the end.
            const full = reader.peek(this.maxLength);
            packed = table[full & ((1 << this.secondaryBits) - 1)];
        }

        if (packed === 0) return VLC_INVALID;

        reader.skip(packed >>> 24);
        return this.payloads[(packed & 0xffffff) - 1];
    }

    /** Decode, throwing rather than returning a sentinel. */
    decodeOrThrow(reader, context) {
        const value = this.decode(reader);
        if (value === VLC_INVALID) {
            throw new BitstreamError(
                `invalid ${this.name} code${context ? ` in ${context}` : ''}`,
                reader.byteOffset
            );
        }
        return value;
    }
}

// =======================================================================================
// Table B.1 - macroblock_address_increment
// =======================================================================================

const VLC_MACROBLOCK_ADDRESS_INCREMENT = new Vlc('macroblock_address_increment', [
    ['1', 1],
    ['011', 2],
    ['010', 3],
    ['0011', 4],
    ['0010', 5],
    ['00011', 6],
    ['00010', 7],
    ['0000111', 8],
    ['0000110', 9],
    ['00001011', 10],
    ['00001010', 11],
    ['00001001', 12],
    ['00001000', 13],
    ['00000111', 14],
    ['00000110', 15],
    ['0000010111', 16],
    ['0000010110', 17],
    ['0000010101', 18],
    ['0000010100', 19],
    ['0000010011', 20],
    ['0000010010', 21],
    ['00000100011', 22],
    ['00000100010', 23],
    ['00000100001', 24],
    ['00000100000', 25],
    ['00000011111', 26],
    ['00000011110', 27],
    ['00000011101', 28],
    ['00000011100', 29],
    ['00000011011', 30],
    ['00000011010', 31],
    ['00000011001', 32],
    ['00000011000', 33],
    // Adds 33 and may repeat. Note the "macroblock stuffing" code that MPEG-1 defined does
    // not exist in MPEG-2.
    ['00000001000', VLC_MACROBLOCK_ESCAPE],
]);

// =======================================================================================
// Tables B.2 to B.4 - macroblock_type
//
// Payload is a bit set, so the flags can be tested without a lookup object per macroblock.
// =======================================================================================

const MB_QUANT = 1 << 0;
const MB_MOTION_FORWARD = 1 << 1;
const MB_MOTION_BACKWARD = 1 << 2;
const MB_PATTERN = 1 << 3;
const MB_INTRA = 1 << 4;

/** Table B.2, I pictures. */
const VLC_MACROBLOCK_TYPE_I = new Vlc('macroblock_type (I)', [
    ['1', MB_INTRA],
    ['01', MB_QUANT | MB_INTRA],
]);

/** Table B.3, P pictures. */
const VLC_MACROBLOCK_TYPE_P = new Vlc('macroblock_type (P)', [
    ['1', MB_MOTION_FORWARD | MB_PATTERN],
    ['01', MB_PATTERN],
    ['001', MB_MOTION_FORWARD],
    ['00011', MB_INTRA],
    ['00010', MB_QUANT | MB_MOTION_FORWARD | MB_PATTERN],
    ['00001', MB_QUANT | MB_PATTERN],
    ['000001', MB_QUANT | MB_INTRA],
]);

/** Table B.4, B pictures. */
const VLC_MACROBLOCK_TYPE_B = new Vlc('macroblock_type (B)', [
    ['10', MB_MOTION_FORWARD | MB_MOTION_BACKWARD],
    ['11', MB_MOTION_FORWARD | MB_MOTION_BACKWARD | MB_PATTERN],
    ['010', MB_MOTION_BACKWARD],
    ['011', MB_MOTION_BACKWARD | MB_PATTERN],
    ['0010', MB_MOTION_FORWARD],
    ['0011', MB_MOTION_FORWARD | MB_PATTERN],
    ['00011', MB_INTRA],
    ['00010', MB_QUANT | MB_MOTION_FORWARD | MB_MOTION_BACKWARD | MB_PATTERN],
    ['000011', MB_QUANT | MB_MOTION_FORWARD | MB_PATTERN],
    ['000010', MB_QUANT | MB_MOTION_BACKWARD | MB_PATTERN],
    ['000001', MB_QUANT | MB_INTRA],
]);

// =======================================================================================
// Table B.9 - coded_block_pattern
//
// cbp bit 5 is block 0 and bit 0 is block 5, so a block is coded when
// cbp & (1 << (5 - blockIndex)).
// =======================================================================================

const VLC_CODED_BLOCK_PATTERN = new Vlc('coded_block_pattern', [
    ['111', 60],
    ['1101', 4],
    ['1100', 8],
    ['1011', 16],
    ['1010', 32],
    ['10011', 12],
    ['10010', 48],
    ['10001', 20],
    ['10000', 40],
    ['01111', 28],
    ['01110', 44],
    ['01101', 52],
    ['01100', 56],
    ['01011', 1],
    ['01010', 61],
    ['01001', 2],
    ['01000', 62],
    ['001111', 24],
    ['001110', 36],
    ['001101', 3],
    ['001100', 63],
    ['0010111', 5],
    ['0010110', 9],
    ['0010101', 17],
    ['0010100', 33],
    ['0010011', 6],
    ['0010010', 10],
    ['0010001', 18],
    ['0010000', 34],
    ['00011111', 7],
    ['00011110', 11],
    ['00011101', 19],
    ['00011100', 35],
    ['00011011', 13],
    ['00011010', 49],
    ['00011001', 21],
    ['00011000', 41],
    ['00010111', 14],
    ['00010110', 50],
    ['00010101', 22],
    ['00010100', 42],
    ['00010011', 15],
    ['00010010', 51],
    ['00010001', 23],
    ['00010000', 43],
    ['00001111', 25],
    ['00001110', 37],
    ['00001101', 26],
    ['00001100', 38],
    ['00001011', 29],
    ['00001010', 45],
    ['00001001', 53],
    ['00001000', 57],
    ['00000111', 30],
    ['00000110', 46],
    ['00000101', 54],
    ['00000100', 58],
    ['000000111', 31],
    ['000000110', 47],
    ['000000101', 55],
    ['000000100', 59],
    ['000000011', 27],
    ['000000010', 39],
    // cbp 0 exists only for 4:2:2 and 4:4:4, which are out of scope. Included so that an
    // out-of-scope stream fails on the chroma format check rather than as a bad VLC.
    ['000000001', 0],
]);

// =======================================================================================
// Table B.10 - motion_code, and Table B.11 - dmvector
// =======================================================================================

const VLC_MOTION_CODE = new Vlc('motion_code', [
    ['00000011001', -16],
    ['00000011011', -15],
    ['00000011101', -14],
    ['00000011111', -13],
    ['00000100001', -12],
    ['00000100011', -11],
    ['0000010011', -10],
    ['0000010101', -9],
    ['0000010111', -8],
    ['00000111', -7],
    ['00001001', -6],
    ['00001011', -5],
    ['0000111', -4],
    ['00011', -3],
    ['0011', -2],
    ['011', -1],
    ['1', 0],
    ['010', 1],
    ['0010', 2],
    ['00010', 3],
    ['0000110', 4],
    ['00001010', 5],
    ['00001000', 6],
    ['00000110', 7],
    ['0000010110', 8],
    ['0000010100', 9],
    ['0000010010', 10],
    ['00000100010', 11],
    ['00000100000', 12],
    ['00000011110', 13],
    ['00000011100', 14],
    ['00000011010', 15],
    ['00000011000', 16],
]);

const VLC_DMVECTOR = new Vlc('dmvector', [
    ['0', 0],
    ['10', 1],
    ['11', -1],
]);

// =======================================================================================
// Tables B.12 and B.13 - DC size for intra blocks
//
// MPEG-2 extends these to size 11; MPEG-1 stopped at 8. The extra entries only occur when
// intra_dc_precision is greater than zero, so an MPEG-1 table passes every 8-bit test and
// then desynchronises on the first higher-precision stream.
// =======================================================================================

const VLC_DCT_DC_SIZE_LUMINANCE = new Vlc('dct_dc_size_luminance', [
    ['100', 0],
    ['00', 1],
    ['01', 2],
    ['101', 3],
    ['110', 4],
    ['1110', 5],
    ['11110', 6],
    ['111110', 7],
    ['1111110', 8],
    ['11111110', 9],
    ['111111110', 10],
    ['111111111', 11],
]);

const VLC_DCT_DC_SIZE_CHROMINANCE = new Vlc('dct_dc_size_chrominance', [
    ['00', 0],
    ['01', 1],
    ['10', 2],
    ['110', 3],
    ['1110', 4],
    ['11110', 5],
    ['111110', 6],
    ['1111110', 7],
    ['11111110', 8],
    ['111111110', 9],
    ['1111111110', 10],
    ['1111111111', 11],
]);

// =======================================================================================
// Tables B.14 and B.15 - DCT coefficients
//
// Payload packs run and level as (run << 8) | level. The sign is a separate bit read after
// the code, so level here is always positive.
//
// Table selection (Table 7-3): intra blocks use B.15 when intra_vlc_format is 1, otherwise
// B.14. Non-intra blocks ALWAYS use B.14, whatever intra_vlc_format says.
// =======================================================================================

const rl = (run, level) => (run << 8) | level;

/**
 * Table B.14 entries shared between the normal and first-coefficient variants.
 * The two differ only in how a leading '1' is interpreted, handled below.
 */
const TABLE_B14_COMMON = [
    ['011', rl(1, 1)],
    ['0100', rl(0, 2)],
    ['0101', rl(2, 1)],
    ['00101', rl(0, 3)],
    ['00111', rl(3, 1)],
    ['00110', rl(4, 1)],
    ['000110', rl(1, 2)],
    ['000111', rl(5, 1)],
    ['000101', rl(6, 1)],
    ['000100', rl(7, 1)],
    ['0000110', rl(0, 4)],
    ['0000100', rl(2, 2)],
    ['0000111', rl(8, 1)],
    ['0000101', rl(9, 1)],
    ['000001', VLC_ESCAPE],
    ['00100110', rl(0, 5)],
    ['00100001', rl(0, 6)],
    ['00100101', rl(1, 3)],
    ['00100100', rl(3, 2)],
    ['00100111', rl(10, 1)],
    ['00100011', rl(11, 1)],
    ['00100010', rl(12, 1)],
    ['00100000', rl(13, 1)],
    ['0000001010', rl(0, 7)],
    ['0000001100', rl(1, 4)],
    ['0000001011', rl(2, 3)],
    ['0000001111', rl(4, 2)],
    ['0000001001', rl(5, 2)],
    ['0000001110', rl(14, 1)],
    ['0000001101', rl(15, 1)],
    ['0000001000', rl(16, 1)],
    ['000000011101', rl(0, 8)],
    ['000000011000', rl(0, 9)],
    ['000000010011', rl(0, 10)],
    ['000000010000', rl(0, 11)],
    ['000000011011', rl(1, 5)],
    ['000000010100', rl(2, 4)],
    ['000000011100', rl(3, 3)],
    ['000000010010', rl(4, 3)],
    ['000000011110', rl(6, 2)],
    ['000000010101', rl(7, 2)],
    ['000000010001', rl(8, 2)],
    ['000000011111', rl(17, 1)],
    ['000000011010', rl(18, 1)],
    ['000000011001', rl(19, 1)],
    ['000000010111', rl(20, 1)],
    ['000000010110', rl(21, 1)],
    ['0000000011010', rl(0, 12)],
    ['0000000011001', rl(0, 13)],
    ['0000000011000', rl(0, 14)],
    ['0000000010111', rl(0, 15)],
    ['0000000010110', rl(1, 6)],
    ['0000000010101', rl(1, 7)],
    ['0000000010100', rl(2, 5)],
    ['0000000010011', rl(3, 4)],
    ['0000000010010', rl(5, 3)],
    ['0000000010001', rl(9, 2)],
    ['0000000010000', rl(10, 2)],
    ['0000000011111', rl(22, 1)],
    ['0000000011110', rl(23, 1)],
    ['0000000011101', rl(24, 1)],
    ['0000000011100', rl(25, 1)],
    ['0000000011011', rl(26, 1)],
    ['00000000011111', rl(0, 16)],
    ['00000000011110', rl(0, 17)],
    ['00000000011101', rl(0, 18)],
    ['00000000011100', rl(0, 19)],
    ['00000000011011', rl(0, 20)],
    ['00000000011010', rl(0, 21)],
    ['00000000011001', rl(0, 22)],
    ['00000000011000', rl(0, 23)],
    ['00000000010111', rl(0, 24)],
    ['00000000010110', rl(0, 25)],
    ['00000000010101', rl(0, 26)],
    ['00000000010100', rl(0, 27)],
    ['00000000010011', rl(0, 28)],
    ['00000000010010', rl(0, 29)],
    ['00000000010001', rl(0, 30)],
    ['00000000010000', rl(0, 31)],
    ['000000000011000', rl(0, 32)],
    ['000000000010111', rl(0, 33)],
    ['000000000010110', rl(0, 34)],
    ['000000000010101', rl(0, 35)],
    ['000000000010100', rl(0, 36)],
    ['000000000010011', rl(0, 37)],
    ['000000000010010', rl(0, 38)],
    ['000000000010001', rl(0, 39)],
    ['000000000010000', rl(0, 40)],
    ['000000000011111', rl(1, 8)],
    ['000000000011110', rl(1, 9)],
    ['000000000011101', rl(1, 10)],
    ['000000000011100', rl(1, 11)],
    ['000000000011011', rl(1, 12)],
    ['000000000011010', rl(1, 13)],
    ['000000000011001', rl(1, 14)],
    ['0000000000010011', rl(1, 15)],
    ['0000000000010010', rl(1, 16)],
    ['0000000000010001', rl(1, 17)],
    ['0000000000010000', rl(1, 18)],
    ['0000000000010100', rl(6, 3)],
    ['0000000000011010', rl(11, 2)],
    ['0000000000011001', rl(12, 2)],
    ['0000000000011000', rl(13, 2)],
    ['0000000000010111', rl(14, 2)],
    ['0000000000010110', rl(15, 2)],
    ['0000000000010101', rl(16, 2)],
    ['0000000000011111', rl(27, 1)],
    ['0000000000011110', rl(28, 1)],
    ['0000000000011101', rl(29, 1)],
    ['0000000000011100', rl(30, 1)],
    ['0000000000011011', rl(31, 1)],
];

/**
 * Table B.14 as used for every coefficient except the first of a non-intra block:
 * '10' is end of block and '11' is run 0 level 1.
 */
const VLC_DCT_COEFF_TABLE0 = new Vlc('dct_coefficient (table 0)', [
    ['10', VLC_END_OF_BLOCK],
    ['11', rl(0, 1)],
    ...TABLE_B14_COMMON,
]);

/**
 * Table B.14 modified for the FIRST coefficient of a non-intra block.
 *
 * There, a leading '1' means run 0 level 1 outright, because end of block cannot legally
 * be the first code of a block (such a block would simply not be coded), so no ambiguity
 * arises. Intra blocks never use this variant: their first coefficient is the DC, coded
 * separately, so the first code that reaches this table is already the second coefficient.
 */
const VLC_DCT_COEFF_TABLE0_FIRST = new Vlc('dct_coefficient (table 0, first)', [
    ['1', rl(0, 1)],
    ...TABLE_B14_COMMON,
]);

/** Table B.15, used for intra blocks when intra_vlc_format is 1. */
const VLC_DCT_COEFF_TABLE1 = new Vlc('dct_coefficient (table 1)', [
    ['0110', VLC_END_OF_BLOCK],
    ['10', rl(0, 1)],
    ['010', rl(1, 1)],
    ['110', rl(0, 2)],
    ['00101', rl(2, 1)],
    ['0111', rl(0, 3)],
    ['00111', rl(3, 1)],
    ['000110', rl(4, 1)],
    ['00110', rl(1, 2)],
    ['000111', rl(5, 1)],
    ['0000110', rl(6, 1)],
    ['0000100', rl(7, 1)],
    ['11100', rl(0, 4)],
    ['0000111', rl(2, 2)],
    ['0000101', rl(8, 1)],
    ['1111000', rl(9, 1)],
    ['000001', VLC_ESCAPE],
    ['11101', rl(0, 5)],
    ['000101', rl(0, 6)],
    ['1111001', rl(1, 3)],
    ['00100110', rl(3, 2)],
    ['1111010', rl(10, 1)],
    ['00100001', rl(11, 1)],
    ['00100101', rl(12, 1)],
    ['00100100', rl(13, 1)],
    ['000100', rl(0, 7)],
    ['00100111', rl(1, 4)],
    ['11111100', rl(2, 3)],
    ['11111101', rl(4, 2)],
    ['000000100', rl(5, 2)],
    ['000000101', rl(14, 1)],
    ['000000111', rl(15, 1)],
    ['0000001101', rl(16, 1)],
    ['1111011', rl(0, 8)],
    ['1111100', rl(0, 9)],
    ['00100011', rl(0, 10)],
    ['00100010', rl(0, 11)],
    ['00100000', rl(1, 5)],
    ['0000001100', rl(2, 4)],
    ['000000011100', rl(3, 3)],
    ['000000010010', rl(4, 3)],
    ['000000011110', rl(6, 2)],
    ['000000010101', rl(7, 2)],
    ['000000010001', rl(8, 2)],
    ['000000011111', rl(17, 1)],
    ['000000011010', rl(18, 1)],
    ['000000011001', rl(19, 1)],
    ['000000010111', rl(20, 1)],
    ['000000010110', rl(21, 1)],
    ['11111010', rl(0, 12)],
    ['11111011', rl(0, 13)],
    ['11111110', rl(0, 14)],
    ['11111111', rl(0, 15)],
    ['0000000010110', rl(1, 6)],
    ['0000000010101', rl(1, 7)],
    ['0000000010100', rl(2, 5)],
    ['0000000010011', rl(3, 4)],
    ['0000000010010', rl(5, 3)],
    ['0000000010001', rl(9, 2)],
    ['0000000010000', rl(10, 2)],
    ['0000000011111', rl(22, 1)],
    ['0000000011110', rl(23, 1)],
    ['0000000011101', rl(24, 1)],
    ['0000000011100', rl(25, 1)],
    ['0000000011011', rl(26, 1)],
    ['00000000011111', rl(0, 16)],
    ['00000000011110', rl(0, 17)],
    ['00000000011101', rl(0, 18)],
    ['00000000011100', rl(0, 19)],
    ['00000000011011', rl(0, 20)],
    ['00000000011010', rl(0, 21)],
    ['00000000011001', rl(0, 22)],
    ['00000000011000', rl(0, 23)],
    ['00000000010111', rl(0, 24)],
    ['00000000010110', rl(0, 25)],
    ['00000000010101', rl(0, 26)],
    ['00000000010100', rl(0, 27)],
    ['00000000010011', rl(0, 28)],
    ['00000000010010', rl(0, 29)],
    ['00000000010001', rl(0, 30)],
    ['00000000010000', rl(0, 31)],
    ['000000000011000', rl(0, 32)],
    ['000000000010111', rl(0, 33)],
    ['000000000010110', rl(0, 34)],
    ['000000000010101', rl(0, 35)],
    ['000000000010100', rl(0, 36)],
    ['000000000010011', rl(0, 37)],
    ['000000000010010', rl(0, 38)],
    ['000000000010001', rl(0, 39)],
    ['000000000010000', rl(0, 40)],
    ['000000000011111', rl(1, 8)],
    ['000000000011110', rl(1, 9)],
    ['000000000011101', rl(1, 10)],
    ['000000000011100', rl(1, 11)],
    ['000000000011011', rl(1, 12)],
    ['000000000011010', rl(1, 13)],
    ['000000000011001', rl(1, 14)],
    ['0000000000010011', rl(1, 15)],
    ['0000000000010010', rl(1, 16)],
    ['0000000000010001', rl(1, 17)],
    ['0000000000010000', rl(1, 18)],
    ['0000000000010100', rl(6, 3)],
    ['0000000000011010', rl(11, 2)],
    ['0000000000011001', rl(12, 2)],
    ['0000000000011000', rl(13, 2)],
    ['0000000000010111', rl(14, 2)],
    ['0000000000010110', rl(15, 2)],
    ['0000000000010101', rl(16, 2)],
    ['0000000000011111', rl(27, 1)],
    ['0000000000011110', rl(28, 1)],
    ['0000000000011101', rl(29, 1)],
    ['0000000000011100', rl(30, 1)],
    ['0000000000011011', rl(31, 1)],
]);

/** Unpack a coefficient payload. */
const vlcRun = (payload) => payload >> 8;
const vlcLevel = (payload) => payload & 0xff;

return { VLC_END_OF_BLOCK, VLC_ESCAPE, VLC_MACROBLOCK_ESCAPE, VLC_INVALID, Vlc, VLC_MACROBLOCK_ADDRESS_INCREMENT, MB_QUANT, MB_MOTION_FORWARD, MB_MOTION_BACKWARD, MB_PATTERN, MB_INTRA, VLC_MACROBLOCK_TYPE_I, VLC_MACROBLOCK_TYPE_P, VLC_MACROBLOCK_TYPE_B, VLC_CODED_BLOCK_PATTERN, VLC_MOTION_CODE, VLC_DMVECTOR, VLC_DCT_DC_SIZE_LUMINANCE, VLC_DCT_DC_SIZE_CHROMINANCE, VLC_DCT_COEFF_TABLE0, VLC_DCT_COEFF_TABLE0_FIRST, VLC_DCT_COEFF_TABLE1, vlcRun, vlcLevel };
});

__def("idct.js", function (__req) {
// 8x8 inverse discrete cosine transform.
//
// Derived from the mathematical definition of the inverse DCT, not ported from or matched
// to any existing decoder. See docs/licensing.md for why that matters here.
//
// The transform is:
//
//   f[y][x] = 1/4 * SUM(u=0..7) SUM(v=0..7) C(u) C(v) F[v][u]
//                   * cos((2x+1) u PI / 16) * cos((2y+1) v PI / 16)
//
//   with C(0) = 1/sqrt(2) and C(k) = 1 otherwise.
//
// It separates into two one-dimensional passes, each of the form
// out[x] = SUM(u) B[x][u] * in[u], with B[x][u] = 1/2 * C(u) * cos((2x+1) u PI / 16).
// The 1/2 in each pass multiplies out to the 1/4 above.
//
// Each pass is then computed as an even/odd butterfly rather than as eight dot products,
// which is where about a third of the transform's running time went. The decomposition is
// derived here rather than taken from any published algorithm:
//
//   cos((2(7-x)+1) u PI/16) = cos(u PI - (2x+1) u PI/16) = (-1)^u cos((2x+1) u PI/16)
//
// so B[7-x][u] = (-1)^u B[x][u]. Splitting the sum into even and odd u gives
//
//   out[x]   = E[x] + O[x]      for x = 0..3
//   out[7-x] = E[x] - O[x]
//
// which halves the work outright, and the even half factors again because B[x][0] and B[x][4]
// have the same magnitude (cos(PI/4) = 1/sqrt2). That leaves 22 multiplies per pass against 64.
//
// This is EXACT, not an approximation. It only regroups a sum of integer products, and integer
// addition does not care how it is grouped, so every constant it uses is an entry of the basis
// matrix and is read from there rather than rounded from a cosine a second time. Output is bit
// for bit what the direct form produced, which is worth having: it means the whole fixture
// corpus still compares by hash, and IEEE 1180 conformance carries over unchanged instead of
// having to be re-established.
//
// ISO/IEC 13818-2 deliberately does not specify a bit-exact IDCT. Conformance is defined by
// the IEEE 1180 accuracy criteria, which test/unit/idct.test.js checks directly. This is
// the only component of the decoder permitted to differ from another conforming decoder;
// everything else is bit-exact specified.

/** Fixed-point fractional bits in the basis matrix. */
const BASIS_BITS = 14;

/**
 * Bits dropped after the row pass, leaving 4 fractional bits in the intermediate result.
 *
 * This is set by accuracy, not convenience. At 2 fractional bits the overall mean squared
 * error measured against a double-precision transform is about 0.037, which fails the IEEE
 * 1180 limit of 0.02. Each extra fractional bit cuts that error variance fourfold.
 */
const ROW_SHIFT = 10;

/** Bits dropped after the column pass: BASIS_BITS plus the 4 fractional bits kept above. */
const COLUMN_SHIFT = 18;

const ROW_ROUND = 1 << (ROW_SHIFT - 1);
const COLUMN_ROUND = 1 << (COLUMN_SHIFT - 1);
const ROW_DIVISOR = 1 << ROW_SHIFT;
const COLUMN_DIVISOR = 1 << COLUMN_SHIFT;

/**
 * Round to nearest, halves away from zero, and scale down by a power of two.
 *
 * Two reasons this is not the usual `(sum + round) >> shift`:
 *
 * 1. `>>` rounds toward negative infinity, so negating the input does not negate the
 *    output. IEEE 1180 requires exactly that symmetry, and without it the DC-only shortcut
 *    also disagrees with the full transform on negative coefficients.
 * 2. `>>` coerces to int32. At this precision the theoretical worst-case column sum exceeds
 *    2^31, so a shift could wrap. Dividing keeps the arithmetic in doubles, which are exact
 *    well beyond the range involved here.
 *
 * There are two of these rather than one function taking the divisor, and that is the single
 * largest win in this file. With the divisor as a parameter it is a runtime value, so the
 * engine has to emit a real double division; as a literal constant it folds into a
 * multiplication by the reciprocal. A power of two reciprocal is exact, so the results are
 * bit-identical. It runs around 128 times per block, which is why it outweighs the ~1000
 * multiply-accumulates the transform itself performs.
 */
function scaleRow(sum) {
    return sum >= 0
        ? Math.floor((sum + ROW_ROUND) / ROW_DIVISOR)
        : -Math.floor((ROW_ROUND - sum) / ROW_DIVISOR);
}

function scaleColumn(sum) {
    return sum >= 0
        ? Math.floor((sum + COLUMN_ROUND) / COLUMN_DIVISOR)
        : -Math.floor((COLUMN_ROUND - sum) / COLUMN_DIVISOR);
}

/** Annex A saturates IDCT output to this range. */
const IDCT_OUTPUT_MIN = -256;
const IDCT_OUTPUT_MAX = 255;

/**
 * Basis matrix in fixed point, indexed [x * 8 + u].
 * Built once at module load from the cosine definition above.
 */
const IDCT_BASIS = (() => {
    const basis = new Int32Array(64);
    const scale = 1 << BASIS_BITS;
    for (let x = 0; x < 8; x++) {
        for (let u = 0; u < 8; u++) {
            const c = u === 0 ? Math.SQRT1_2 : 1;
            const value = 0.5 * c * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
            basis[x * 8 + u] = Math.round(value * scale);
        }
    }
    return basis;
})();

/**
 * Butterfly constants, taken from the basis matrix rather than recomputed from cosines.
 *
 * Every constant a butterfly needs is already an entry of row 0, because the decomposition
 * only ever regroups terms that were there anyway. Reading them from IDCT_BASIS instead of
 * rounding a cosine a second time is what makes the fast path bit-identical to the direct
 * transform rather than merely close to it, and it means the two cannot drift apart if
 * BASIS_BITS ever changes. test/unit/idct.test.js checks the implied matrix entry by entry.
 */
const K0 = IDCT_BASIS[0]; // 0.5/sqrt2, and equal to IDCT_BASIS[4] by cos(pi/4) = 1/sqrt2
const K1 = IDCT_BASIS[1];
const K2 = IDCT_BASIS[2];
const K3 = IDCT_BASIS[3];
const K5 = IDCT_BASIS[5];
const K6 = IDCT_BASIS[6];
const K7 = IDCT_BASIS[7];

/** Scratch for the row pass. Module-level so the hot path allocates nothing. */
const intermediate = new Int32Array(64);

/**
 * Which rows of `intermediate` carry data, filled by the row pass and read by the column pass.
 *
 * This is where nearly all of the transform's cost is decided, and the reason is mismatch
 * control. It toggles the low bit of the last coefficient whenever the block's sum is even, so
 * roughly half of all blocks end up with a lone coefficient sitting at raster index 63. That
 * one coefficient is in the last row, which is why measured over a 1920x1080 stream:
 *
 *   - the DC-only shortcut below fires on 0.8% of blocks, not the majority the design expected
 *   - 59.5% of blocks have exactly two non-zero rows, and they are rows 0 and 7
 *   - only 27.4% are dense (0.4% on the real DICOM content)
 *
 * So the useful sparsity is not "how many coefficients" but "which rows", and it survives
 * mismatch control where every other shortcut does not.
 */
const activeRows = new Int32Array(8);

function saturate(value) {
    if (value < IDCT_OUTPUT_MIN) return IDCT_OUTPUT_MIN;
    if (value > IDCT_OUTPUT_MAX) return IDCT_OUTPUT_MAX;
    return value;
}

/**
 * Inverse DCT of an 8x8 block.
 *
 * @param {Int16Array|Int32Array} block 64 dequantised coefficients in raster order
 * @param {Int16Array} out 64 spatial samples, saturated to [-256, 255]
 * @param {number} [nonZeroCount] number of non-zero coefficients, if already known
 * @param {number} [lastNonZero] highest raster index holding a non-zero coefficient
 */
function idct(block, out, nonZeroCount = -1, lastNonZero = -1) {
    // DC-only blocks are extremely common, especially in predicted pictures, and the whole
    // transform collapses to a constant: every output equals F[0][0] / 8.
    if (nonZeroCount === 1 && lastNonZero === 0) {
        // A DC-only block produces a constant, so the whole transform collapses to one
        // value. This reproduces the general path's arithmetic exactly rather than taking
        // the mathematically exact F[0][0]/8: the two-pass path rounds twice and the exact
        // form rounds once, so they disagree by one often enough to matter. Identical
        // output regardless of which path runs is worth more here than the extra accuracy,
        // since the general path is what IEEE 1180 conformance was measured on.
        //
        // Basis column u=0 is constant across x, so a single coefficient serves both passes.
        const basis = IDCT_BASIS[0];
        const rowValue = scaleRow(basis * block[0]);
        const dc = saturate(scaleColumn(basis * rowValue));
        out.fill(dc);
        return out;
    }

    // Row pass. Rows that contribute nothing are left out of activeRows rather than zeroed,
    // so the sparse column paths never read them and the stale values they still hold cost
    // nothing. The dense column path does read all eight, and zeroes them first.
    let activeCount = 0;
    let rowMask = 0;

    for (let y = 0; y < 8; y++) {
        const row = y << 3;
        const dc = block[row];
        const ac =
            block[row + 1] |
            block[row + 2] |
            block[row + 3] |
            block[row + 4] |
            block[row + 5] |
            block[row + 6] |
            block[row + 7];

        if (ac === 0) {
            if (dc === 0) continue;

            // Basis column u=0 is 0.5 * (1/sqrt2) * cos(0) for every x, so a row holding only
            // its first coefficient transforms to a constant row. Splitting the zero test into
            // "first coefficient" and "the rest" costs nothing over testing all eight at once
            // and catches this, which is the row 0 of every block in the dominant case above.
            const value = scaleRow(K0 * dc);
            intermediate[row] = value;
            intermediate[row + 1] = value;
            intermediate[row + 2] = value;
            intermediate[row + 3] = value;
            intermediate[row + 4] = value;
            intermediate[row + 5] = value;
            intermediate[row + 6] = value;
            intermediate[row + 7] = value;
            activeRows[activeCount++] = y;
            rowMask |= 1 << y;
            continue;
        }

        // Even/odd butterfly: 22 multiplies for all eight outputs where the direct form needs
        // 64. See the note above the pass for why the result is identical rather than merely
        // equivalent to within rounding.
        const f1 = block[row + 1];
        const f2 = block[row + 2];
        const f3 = block[row + 3];
        const f4 = block[row + 4];
        const f5 = block[row + 5];
        const f6 = block[row + 6];
        const f7 = block[row + 7];

        const ea = K0 * (dc + f4);
        const eb = K0 * (dc - f4);
        const ec = K2 * f2 + K6 * f6;
        const ed = K6 * f2 - K2 * f6;

        const e0 = ea + ec;
        const e1 = eb + ed;
        const e2 = eb - ed;
        const e3 = ea - ec;

        const o0 = K1 * f1 + K3 * f3 + K5 * f5 + K7 * f7;
        const o1 = K3 * f1 - K7 * f3 - K1 * f5 - K5 * f7;
        const o2 = K5 * f1 - K1 * f3 + K7 * f5 + K3 * f7;
        const o3 = K7 * f1 - K5 * f3 + K3 * f5 - K1 * f7;

        intermediate[row] = scaleRow(e0 + o0);
        intermediate[row + 1] = scaleRow(e1 + o1);
        intermediate[row + 2] = scaleRow(e2 + o2);
        intermediate[row + 3] = scaleRow(e3 + o3);
        intermediate[row + 4] = scaleRow(e3 - o3);
        intermediate[row + 5] = scaleRow(e2 - o2);
        intermediate[row + 6] = scaleRow(e1 - o1);
        intermediate[row + 7] = scaleRow(e0 - o0);

        activeRows[activeCount++] = y;
        rowMask |= 1 << y;
    }

    // Column pass, in two regimes.
    //
    // With one or two rows carrying data it is cheaper to sum just those terms than to run a
    // butterfly: one or two multiplies per output against 22 per column. Dropping terms that
    // are exactly zero cannot change the result, so this stays bit-identical too. Those two
    // cases are written out rather than looped because between them they are 61.6% of blocks
    // at HD and 38.8% on the real DICOM content.
    //
    // From three rows up the butterfly wins, and that path follows below.
    if (activeCount === 0) {
        out.fill(0);
        return out;
    }

    if (activeCount === 1) {
        const v0 = activeRows[0];
        const i0 = v0 << 3;
        for (let x = 0; x < 8; x++) {
            const s0 = intermediate[i0 + x];
            for (let y = 0; y < 8; y++) {
                out[(y << 3) + x] = saturate(scaleColumn(IDCT_BASIS[(y << 3) + v0] * s0));
            }
        }
        return out;
    }

    if (activeCount === 2) {
        const v0 = activeRows[0];
        const v1 = activeRows[1];
        const i0 = v0 << 3;
        const i1 = v1 << 3;
        for (let x = 0; x < 8; x++) {
            const s0 = intermediate[i0 + x];
            const s1 = intermediate[i1 + x];
            for (let y = 0; y < 8; y++) {
                const b = y << 3;
                out[b + x] = saturate(scaleColumn(IDCT_BASIS[b + v0] * s0 + IDCT_BASIS[b + v1] * s1));
            }
        }
        return out;
    }

    // Three or more rows: the butterfly's 22 multiplies per column beat summing `activeCount`
    // terms for each of eight outputs, which is where the crossover sits. Below three the
    // sparse paths above are cheaper, which is why they are kept rather than replaced.
    //
    // The butterfly reads all eight rows, so the ones the row pass skipped have to be zeroed
    // now. That is up to five rows of stores, still less than the multiplies it saves.
    for (let y = 0; y < 8; y++) {
        if (rowMask & (1 << y)) continue;
        const row = y << 3;
        intermediate[row] = 0;
        intermediate[row + 1] = 0;
        intermediate[row + 2] = 0;
        intermediate[row + 3] = 0;
        intermediate[row + 4] = 0;
        intermediate[row + 5] = 0;
        intermediate[row + 6] = 0;
        intermediate[row + 7] = 0;
    }

    for (let x = 0; x < 8; x++) {
        const f0 = intermediate[x];
        const f1 = intermediate[8 + x];
        const f2 = intermediate[16 + x];
        const f3 = intermediate[24 + x];
        const f4 = intermediate[32 + x];
        const f5 = intermediate[40 + x];
        const f6 = intermediate[48 + x];
        const f7 = intermediate[56 + x];

        const ea = K0 * (f0 + f4);
        const eb = K0 * (f0 - f4);
        const ec = K2 * f2 + K6 * f6;
        const ed = K6 * f2 - K2 * f6;

        const e0 = ea + ec;
        const e1 = eb + ed;
        const e2 = eb - ed;
        const e3 = ea - ec;

        const o0 = K1 * f1 + K3 * f3 + K5 * f5 + K7 * f7;
        const o1 = K3 * f1 - K7 * f3 - K1 * f5 - K5 * f7;
        const o2 = K5 * f1 - K1 * f3 + K7 * f5 + K3 * f7;
        const o3 = K7 * f1 - K5 * f3 + K3 * f5 - K1 * f7;

        out[x] = saturate(scaleColumn(e0 + o0));
        out[8 + x] = saturate(scaleColumn(e1 + o1));
        out[16 + x] = saturate(scaleColumn(e2 + o2));
        out[24 + x] = saturate(scaleColumn(e3 + o3));
        out[32 + x] = saturate(scaleColumn(e3 - o3));
        out[40 + x] = saturate(scaleColumn(e2 - o2));
        out[48 + x] = saturate(scaleColumn(e1 - o1));
        out[56 + x] = saturate(scaleColumn(e0 - o0));
    }

    return out;
}

/**
 * Double-precision reference IDCT, straight from the definition.
 * Used only by the accuracy tests, as the ground truth the integer transform is measured
 * against. Never called during decoding.
 */
function idctReferenceFloat(block, out) {
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            let sum = 0;
            for (let v = 0; v < 8; v++) {
                const cv = v === 0 ? Math.SQRT1_2 : 1;
                for (let u = 0; u < 8; u++) {
                    const cu = u === 0 ? Math.SQRT1_2 : 1;
                    sum +=
                        cu *
                        cv *
                        block[v * 8 + u] *
                        Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
                        Math.cos(((2 * y + 1) * v * Math.PI) / 16);
                }
            }
            out[y * 8 + x] = sum / 4;
        }
    }
    return out;
}

return { IDCT_OUTPUT_MIN, IDCT_OUTPUT_MAX, IDCT_BASIS, idct, idctReferenceFloat };
});

__def("block.js", function (__req) {
// Block layer: coefficient decoding, inverse scan, dequantisation and mismatch control.
//
// This file holds the densest concentration of things that go wrong quietly. Almost every
// rule here has an MPEG-1 counterpart that differs slightly, and getting one wrong produces
// output that looks like a slightly noisy or slightly soft picture rather than anything
// obviously broken. Each one is called out at the point it applies.

const { BitstreamError } = __req('errors.js');
const { SCAN_ALTERNATE, SCAN_ZIGZAG, quantiserScale } = __req('tables.js');
const { VLC_DCT_COEFF_TABLE0, VLC_DCT_COEFF_TABLE0_FIRST, VLC_DCT_COEFF_TABLE1, VLC_DCT_DC_SIZE_CHROMINANCE, VLC_DCT_DC_SIZE_LUMINANCE, VLC_END_OF_BLOCK, VLC_ESCAPE, VLC_INVALID, vlcLevel, vlcRun } = __req('vlc.js');

/** Dequantised coefficients are clamped to this range before mismatch control. */
const COEFF_MIN = -2048;
const COEFF_MAX = 2047;

/** Colour component index per block, for 4:2:0: blocks 0..3 luma, 4 is Cb, 5 is Cr. */
const BLOCK_COLOUR_COMPONENT = new Uint8Array([0, 0, 0, 0, 1, 2]);

class BlockDecoder {
    constructor() {
        /** Dequantised coefficients in raster order, reused for every block. */
        this.coefficients = new Int16Array(64);
        /** DC predictors, one per colour component. */
        this.dcPredictor = new Int32Array(3);

        this.nonZeroCount = 0;
        this.lastNonZero = -1;

        // Scratch list of written positions, so the buffer can be cleared by touching only
        // what was set. Blocks are typically sparse, and clearing all 64 entries per block
        // is a measurable cost across a frame.
        this._written = new Uint8Array(64);
        this._writtenCount = 0;
    }

    /**
     * Reset the DC predictors.
     *
     * Required at exactly three points: the start of every slice, after any non-intra
     * macroblock, and after any skipped macroblock. Not at every macroblock, and not only
     * at slice start.
     *
     * The reset value depends on intra_dc_precision, because the predictor is held in the
     * quantised domain and scaled at dequantisation time. That formulation is what lets the
     * same code serve all four precisions.
     */
    resetDcPredictors(intraDcPrecision) {
        const value = 1 << (7 + intraDcPrecision);
        this.dcPredictor[0] = value;
        this.dcPredictor[1] = value;
        this.dcPredictor[2] = value;
    }

    /** Clear only the coefficients written by the previous block. */
    _clear() {
        const written = this._written;
        const coefficients = this.coefficients;
        for (let i = 0; i < this._writtenCount; i++) coefficients[written[i]] = 0;
        this._writtenCount = 0;
        this.nonZeroCount = 0;
        this.lastNonZero = -1;
    }

    _store(position, value) {
        this.coefficients[position] = value;
        this._written[this._writtenCount++] = position;
        if (value !== 0) {
            this.nonZeroCount++;
            if (position > this.lastNonZero) this.lastNonZero = position;
        }
    }

    /**
     * Decode one intra block.
     *
     * @param {BitReader} reader
     * @param {number} blockIndex 0..5
     * @param {object} picture PictureState
     * @param {Uint8Array} quantiserMatrix in RASTER order
     * @param {number} quantiserScaleCode
     * @returns {Int16Array} dequantised coefficients in raster order
     */
    decodeIntra(reader, blockIndex, picture, quantiserMatrix, quantiserScaleCode) {
        this._clear();

        const component = BLOCK_COLOUR_COMPONENT[blockIndex];
        const isLuma = component === 0;

        // --- DC coefficient -------------------------------------------------------------
        const sizeTable = isLuma ? VLC_DCT_DC_SIZE_LUMINANCE : VLC_DCT_DC_SIZE_CHROMINANCE;
        const size = sizeTable.decodeOrThrow(reader, 'dct_dc_size');

        let differential = 0;
        if (size > 0) {
            const value = reader.read(size);
            const halfRange = 1 << (size - 1);
            // Values below half range represent negatives, offset rather than two's
            // complement, so this is not a plain sign extension.
            differential = value >= halfRange ? value : value - (1 << size) + 1;
        }

        const dc = this.dcPredictor[component] + differential;
        this.dcPredictor[component] = dc;

        // The intra DC is scaled only by the precision multiplier: no quantiser matrix and
        // no quantiser scale are involved.
        const intraDcMultiplier = 8 >> picture.intraDcPrecision;
        this._store(0, clampCoefficient(dc * intraDcMultiplier));

        // --- AC coefficients ------------------------------------------------------------
        // Table B.15 is used only for intra blocks with intra_vlc_format set; everything
        // else uses B.14.
        const table = picture.intraVlcFormat ? VLC_DCT_COEFF_TABLE1 : VLC_DCT_COEFF_TABLE0;
        const scale = quantiserScale(quantiserScaleCode, picture.qScaleType);

        this._decodeCoefficients(reader, table, picture, quantiserMatrix, scale, true, 1);
        this._applyMismatchControl();
        return this.coefficients;
    }

    /**
     * Decode one non-intra block.
     *
     * Non-intra blocks always use Table B.14, whatever intra_vlc_format says.
     */
    decodeNonIntra(reader, picture, quantiserMatrix, quantiserScaleCode) {
        this._clear();
        const scale = quantiserScale(quantiserScaleCode, picture.qScaleType);
        this._decodeCoefficients(
            reader,
            VLC_DCT_COEFF_TABLE0,
            picture,
            quantiserMatrix,
            scale,
            false,
            0
        );
        this._applyMismatchControl();
        return this.coefficients;
    }

    /**
     * Shared run/level loop.
     * @param {boolean} isIntra selects the dequantisation formula
     * @param {number} startIndex 1 for intra (DC handled separately), 0 for non-intra
     */
    _decodeCoefficients(reader, table, picture, quantiserMatrix, scale, isIntra, startIndex) {
        const scan = picture.alternateScan ? SCAN_ALTERNATE : SCAN_ZIGZAG;
        let index = startIndex;
        let first = !isIntra;

        for (;;) {
            // The first coefficient of a non-intra block uses a modified table where a
            // leading '1' means run 0 level 1 rather than end of block. Intra blocks never
            // hit this: their first coefficient is the DC, decoded above.
            const activeTable =
                first && table === VLC_DCT_COEFF_TABLE0 ? VLC_DCT_COEFF_TABLE0_FIRST : table;
            first = false;

            const symbol = activeTable.decode(reader);

            if (symbol === VLC_END_OF_BLOCK) return;
            if (symbol === VLC_INVALID) {
                throw new BitstreamError('invalid DCT coefficient code', reader.byteOffset);
            }

            let run;
            let signedLevel;

            if (symbol === VLC_ESCAPE) {
                // MPEG-2 escape coding: a 6-bit run then a 12-bit two's complement level.
                // MPEG-1's double-escape form does not exist here, and using it desyncs on
                // the first large coefficient, which means the first detailed picture.
                run = reader.read(6);
                signedLevel = reader.readSigned(12);
                if (signedLevel === COEFF_MIN) {
                    throw new BitstreamError(
                        'escape level -2048 is forbidden',
                        reader.byteOffset
                    );
                }
            } else {
                run = vlcRun(symbol);
                const level = vlcLevel(symbol);
                signedLevel = reader.read1() ? -level : level;
            }

            // run counts the zero coefficients skipped over, so advance past them first.
            index += run;
            if (index > 63) {
                throw new BitstreamError(
                    `DCT coefficient index ${index} out of range`,
                    reader.byteOffset
                );
            }

            const position = scan[index];
            const weight = quantiserMatrix[position];

            let value;
            if (isIntra) {
                // Truncation toward zero, NOT an arithmetic shift. `>> 5` rounds toward
                // negative infinity and is wrong for every negative coefficient; it biases
                // roughly half of all coefficients by one step, which reads as slight extra
                // noise on an intra picture and becomes visible drift across a GOP.
                value = ((signedLevel * weight * scale * 2) / 32) | 0;
            } else {
                // The non-intra formula carries a sign-dependent term that the intra one
                // does not.
                const sign = signedLevel > 0 ? 1 : -1;
                value = (((2 * signedLevel + sign) * weight * scale) / 32) | 0;
            }

            this._store(position, clampCoefficient(value));
            index++;
        }
    }

    /**
     * Mismatch control.
     *
     * MPEG-2 requires that the sum of the 64 dequantised coefficients be odd. If it is
     * even, the low bit of the coefficient at raster position (7,7) is toggled.
     *
     * Two things this is NOT:
     *
     *  - It is not MPEG-1's "oddification", where every coefficient is nudged toward zero
     *    if even. Applying that here corrupts roughly half of all coefficients.
     *  - It is not a subtraction. XOR and subtract differ for negative values in two's
     *    complement, and coefficients are frequently negative.
     *
     * Omitting this entirely is close to invisible on a single intra picture and severe
     * across a long predicted chain, which is exactly why the drift test exists.
     *
     * Position (7,7) is index 63 in raster order. It happens to be the last entry of both
     * scan orders, so "toggle the last coefficient" is accidentally correct, but stating it
     * in raster terms keeps it correct if the code is ever restructured.
     */
    _applyMismatchControl() {
        const coefficients = this.coefficients;
        // The parity of a sum is the XOR of the low bits, so only odd values contribute.
        let parity = 0;
        for (let i = 0; i < 64; i++) parity ^= coefficients[i] & 1;

        if (parity === 0) {
            const before = coefficients[63];
            const after = before ^ 1;
            coefficients[63] = after;

            // Keep the sparse-clear bookkeeping and the IDCT hints honest.
            if (before === 0 && after !== 0) {
                this._written[this._writtenCount++] = 63;
                this.nonZeroCount++;
                if (this.lastNonZero < 63) this.lastNonZero = 63;
            } else if (before !== 0 && after === 0) {
                this.nonZeroCount--;
                if (this.lastNonZero === 63) {
                    let last = -1;
                    for (let i = 62; i >= 0; i--) {
                        if (coefficients[i] !== 0) {
                            last = i;
                            break;
                        }
                    }
                    this.lastNonZero = last;
                }
            }
        }
    }
}

function clampCoefficient(value) {
    if (value < COEFF_MIN) return COEFF_MIN;
    if (value > COEFF_MAX) return COEFF_MAX;
    return value;
}



return { clampCoefficient, COEFF_MIN, COEFF_MAX, BLOCK_COLOUR_COMPONENT, BlockDecoder };
});

__def("motion.js", function (__req) {
// Motion vector decoding and prediction state.
//
// Vectors are coded differentially against predictors that persist across macroblocks and
// reset at well-defined points. Most of the subtle bugs in an MPEG-2 decoder live here, and
// they show up as small localised artefacts rather than obvious corruption.

const { BitstreamError } = __req('errors.js');
const { PICTURE_STRUCTURE_FRAME } = __req('constants.js');
const { VLC_DMVECTOR, VLC_MOTION_CODE } = __req('vlc.js');

/** mv_format values, from Tables 6-17 and 6-18. */
const MV_FORMAT_FRAME = 0;
const MV_FORMAT_FIELD = 1;

/** Prediction types. */
const PREDICTION_FIELD = 1;
const PREDICTION_FRAME = 2;
const PREDICTION_16X8 = 3;
const PREDICTION_DUAL_PRIME = 4;

class MotionState {
    constructor() {
        // PMV[r][s][t]: r selects first or second vector in the macroblock, s selects
        // forward or backward, t selects horizontal or vertical. Flattened to
        // r * 4 + s * 2 + t.
        //
        // The index order is easy to transpose, and in progressive content the values are
        // often equal, which hides the mistake completely until interlaced material shows
        // up and the vertical f_code differs from the horizontal one.
        this.pmv = new Int32Array(8);

        /** Reference field parity per vector, for field prediction. */
        this.fieldSelect = new Uint8Array(4);
    }

    /** Reset every predictor to zero. */
    reset() {
        this.pmv.fill(0);
        this.fieldSelect.fill(0);
    }

    get(r, s, t) {
        return this.pmv[r * 4 + s * 2 + t];
    }

    set(r, s, t, value) {
        this.pmv[r * 4 + s * 2 + t] = value;
    }

    /**
     * When a macroblock carries only one vector for a direction, the second predictor must
     * track the first, so that a later macroblock using two vectors starts from sensible
     * values.
     */
    duplicateToSecond(s) {
        this.pmv[4 + s * 2] = this.pmv[s * 2];
        this.pmv[4 + s * 2 + 1] = this.pmv[s * 2 + 1];
    }
}

/**
 * Decode one motion vector component.
 *
 * @param {BitReader} reader
 * @param {MotionState} state
 * @param {number} r first or second vector
 * @param {number} s 0 forward, 1 backward
 * @param {number} t 0 horizontal, 1 vertical
 * @param {number} fCode f_code[s][t]
 * @param {number} mvFormat MV_FORMAT_FRAME or MV_FORMAT_FIELD
 * @param {number} pictureStructure
 * @returns {number} the reconstructed component, in field units when mv_format is field
 */
function decodeMotionVectorComponent(
    reader,
    state,
    r,
    s,
    t,
    fCode,
    mvFormat,
    pictureStructure
) {
    if (fCode < 1 || fCode > 9) {
        // 15 means "no vectors in this direction" and must never reach here; anything else
        // outside 1..9 is reserved.
        throw new BitstreamError(`f_code ${fCode} is not usable for motion vectors`, reader.byteOffset);
    }

    const rSize = fCode - 1;
    const f = 1 << rSize;
    const high = 16 * f - 1;
    const low = -16 * f;
    const range = 32 * f;

    const motionCode = VLC_MOTION_CODE.decodeOrThrow(reader, 'motion_code');

    let delta;
    if (f === 1 || motionCode === 0) {
        delta = motionCode;
    } else {
        const residual = reader.read(rSize);
        delta = (Math.abs(motionCode) - 1) * f + residual + 1;
        if (motionCode < 0) delta = -delta;
    }

    // Predictors are always held in frame units. A field-format vector in a frame picture
    // is in field units, so the predictor is halved on the way in and doubled on the way
    // out.
    //
    // The spec's DIV truncates toward minus infinity, which is what >> does. Math.trunc
    // would round toward zero and is wrong for negative odd predictors, producing a
    // half-line vertical error that reads as smearing on interlaced content.
    const scaleForField =
        mvFormat === MV_FORMAT_FIELD && t === 1 && pictureStructure === PICTURE_STRUCTURE_FRAME;

    const prediction = scaleForField ? state.get(r, s, t) >> 1 : state.get(r, s, t);

    let vector = prediction + delta;

    // Mandatory wrap into the representable range. Without it, vectors near the boundary
    // decode to wildly wrong values, which looks like a single macroblock jumping across
    // the frame.
    if (vector < low) vector += range;
    else if (vector > high) vector -= range;

    state.set(r, s, t, scaleForField ? vector * 2 : vector);
    return vector;
}

/**
 * Read the dual-prime differential vector, which is interleaved between the two motion
 * vector components rather than appended after them.
 */
function decodeDmvector(reader) {
    return VLC_DMVECTOR.decodeOrThrow(reader, 'dmvector');
}

/**
 * e[parity_ref][parity_pred] from Table 7-12: the correction for the vertical offset between
 * the lines of the two fields.
 *
 * A bottom field line sits one frame line BELOW the top field line of the same index.
 * Vertical vectors here are in half field lines, and one half field line is one frame line,
 * so the correction is one unit. A positive vertical vector reads from lower down (7.6.4),
 * so predicting a bottom field from a top reference reads one unit lower, and predicting a
 * top field from a bottom reference reads one unit higher.
 *
 * Getting the sign backwards displaces the opposite-parity half of every dual prime
 * prediction by two frame lines. Averaged against a correct same-parity prediction that
 * yields a soft vertical smear rather than anything that looks broken.
 */
const E_TOP_FROM_BOTTOM = -1; // e[1][0]
const E_BOTTOM_FROM_TOP = 1; // e[0][1]

/**
 * The specification's // operator, for a divisor of 2: integer division rounding to the
 * nearest integer, with half-integer values rounded AWAY from zero.
 *
 * Distinct from both / (truncate toward zero) and DIV (truncate toward minus infinity). All
 * three appear in this standard and mean different things, and they agree on every positive
 * even value, so a mix-up survives most testing.
 */
function halfRoundAwayFromZero(value) {
    return value >= 0 ? (value + 1) >> 1 : -((1 - value) >> 1);
}

/**
 * Derive one component of a dual prime opposite-parity motion vector (7.6.3.6).
 *
 * The coded vector spans the distance to the same-parity reference field. The opposite
 * parity field sits at a different temporal distance, so the vector is scaled by m/2, then
 * corrected by e for the line offset between fields, then adjusted by the small differential
 * vector carried in the bitstream.
 *
 * @param {number} m field distance to the opposite parity reference, from Table 7-11
 * @param {number} e line offset correction, zero for the horizontal component
 * @param {number} dmv the decoded dmvector component, one of -1, 0, 1
 */
function dualPrimeComponent(component, m, e, dmv) {
    return halfRoundAwayFromZero(component * m) + e + dmv;
}

/**
 * Derive chroma motion vectors for 4:2:0.
 *
 * Both components are halved with truncation TOWARD ZERO, which is not the same as an
 * arithmetic shift: -3 / 2 is -1, while -3 >> 1 is -2. Using the shift flips the half-pel
 * phase for every negative odd component, roughly a quarter of all chroma predictions, and
 * shows up as slight colour fringing on motion rather than as anything obviously broken.
 *
 * Note the asymmetry with the half-pel split further down the pipeline, which does use
 * floor. They are different operations and both are correct as written.
 */
function chromaVector420(component) {
    return (component / 2) | 0;
}

return { MV_FORMAT_FRAME, MV_FORMAT_FIELD, PREDICTION_FIELD, PREDICTION_FRAME, PREDICTION_16X8, PREDICTION_DUAL_PRIME, MotionState, decodeMotionVectorComponent, decodeDmvector, E_TOP_FROM_BOTTOM, E_BOTTOM_FROM_TOP, halfRoundAwayFromZero, dualPrimeComponent, chromaVector420 };
});

__def("mc.js", function (__req) {
// Motion compensation: half-pel interpolation and prediction formation.
//
// Motion vectors are in half-sample units. The integer part uses floor (an arithmetic
// shift), and the fractional part is the low bit. Floor is correct here for both luma and
// chroma, which is worth stating because the chroma vector DERIVATION one step earlier
// truncates toward zero instead. Two different operations, both deliberate.
//
// Reference planes carry a replicated border, so vectors pointing a little outside the
// picture read valid samples without any per-access clamping. The border does NOT cover the
// largest vector Table 7-8 permits (f_code 9 reaches 2048 samples), and it does not need to:
// 13818-2 7.6.3.8 requires that a bitstream only demand predictions from slices actually
// encoded, which under the restricted slice structure used by MP@ML and MP@HL means
// reconstructed vectors never refer outside the coded picture at all. The clamp below exists
// for streams that break that rule, not for ones that keep it.

/**
 * Predict a rectangular block from a reference plane.
 *
 * @param {Uint8Array} dest destination plane
 * @param {number} destOffset offset of the block's top-left sample
 * @param {number} destStride
 * @param {Uint8Array} ref reference plane
 * @param {number} refOrigin offset of reference sample (0, 0)
 * @param {number} refStride distance between rows as this prediction reads them, so twice
 *        the plane stride when a field is being read out of a frame
 * @param {number} refWidth picture width of the reference plane, excluding the border
 * @param {number} refBorder border width of the reference plane in its own samples
 * @param {number} x block position in samples
 * @param {number} y block position in samples
 * @param {number} width
 * @param {number} height
 * @param {number} mvX horizontal vector in half-sample units
 * @param {number} mvY vertical vector in half-sample units
 */
function predictBlock(
    dest,
    destOffset,
    destStride,
    ref,
    refOrigin,
    refStride,
    refWidth,
    refBorder,
    x,
    y,
    width,
    height,
    mvX,
    mvY
) {
    // Arithmetic shift, so this floors for negative vectors as required.
    const intX = mvX >> 1;
    const intY = mvY >> 1;
    const halfX = mvX & 1;
    const halfY = mvY & 1;

    // Confine the read window to the padded plane.
    //
    // A conforming stream never trips this (see the note at the top of the file), so it does
    // not alter any correct decode. A corrupt or truncated one can produce any vector at all,
    // and unclamped those reads either wrap onto the neighbouring row or run off the end of
    // the plane, where a Uint8Array yields undefined and the arithmetic turns the whole block
    // to zero. Both look like decoder faults rather than like damaged input.
    //
    // Clamping the window is exact here, not an approximation of per-sample clamping. Every
    // border sample already holds the edge sample replicated outward, and the border is wide
    // enough that any window starting beyond it lies wholly outside the picture, so all of
    // its samples resolve to that same edge sample either way. That needs
    // border + 1 >= size + halfPel, which holds with nothing to spare in the field cases:
    // luma frame 33 >= 17, luma field 17 >= 17, chroma frame 17 >= 9, chroma field 9 >= 9.
    let srcX = x + intX;
    const minX = -refBorder;
    const maxX = refWidth + refBorder - width - halfX;
    if (srcX < minX) srcX = minX;
    else if (srcX > maxX) srcX = maxX;

    let src = refOrigin + (y + intY) * refStride + srcX;

    // Vertically, clamp against the plane's own extent rather than a row count. Moving by
    // whole rows of refStride keeps both the column and the field parity intact, which a
    // bounds check on the raw offset would not, and every border row holds the replicated
    // edge row whichever one we land on.
    const span = (height - 1 + halfY) * refStride + width - 1 + halfX;
    if (src < 0) {
        src += Math.ceil(-src / refStride) * refStride;
    } else if (src + span >= ref.length) {
        src -= Math.ceil((src + span - ref.length + 1) / refStride) * refStride;
    }

    if (halfX === 0 && halfY === 0) {
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) dest[destOffset + col] = ref[src + col];
            src += refStride;
            destOffset += destStride;
        }
        return;
    }

    // MPEG-2 has no rounding control flag; interpolation always rounds up. That flag
    // belongs to later standards and adding it here would bias every predicted sample.
    if (halfX === 1 && halfY === 0) {
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                dest[destOffset + col] = (ref[src + col] + ref[src + col + 1] + 1) >> 1;
            }
            src += refStride;
            destOffset += destStride;
        }
        return;
    }

    if (halfX === 0 && halfY === 1) {
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                dest[destOffset + col] = (ref[src + col] + ref[src + col + refStride] + 1) >> 1;
            }
            src += refStride;
            destOffset += destStride;
        }
        return;
    }

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            dest[destOffset + col] =
                (ref[src + col] +
                    ref[src + col + 1] +
                    ref[src + col + refStride] +
                    ref[src + col + refStride + 1] +
                    2) >>
                2;
        }
        src += refStride;
        destOffset += destStride;
    }
}

/**
 * Average two predictions that were each interpolated independently.
 *
 * The two directions must be interpolated separately and only then averaged. Averaging the
 * source samples before interpolation is a different and wrong computation, because each
 * prediction rounds on its own.
 */
function averageBlocks(dest, destOffset, destStride, other, otherOffset, otherStride, width, height) {
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            dest[destOffset + col] = (dest[destOffset + col] + other[otherOffset + col] + 1) >> 1;
        }
        destOffset += destStride;
        otherOffset += otherStride;
    }
}

/**
 * Add an inverse-transformed residual to a prediction already sitting in the destination.
 *
 * @param {Int16Array} residual 64 samples from the IDCT
 */
function addResidual(dest, destOffset, destStride, residual) {
    let s = 0;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const value = dest[destOffset + col] + residual[s + col];
            dest[destOffset + col] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
        s += 8;
        destOffset += destStride;
    }
}

/**
 * Add a residual whose rows advance by two, for field-organised luma blocks.
 */
function addResidualField(dest, destOffset, destStride, residual) {
    let s = 0;
    const step = destStride * 2;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const value = dest[destOffset + col] + residual[s + col];
            dest[destOffset + col] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
        s += 8;
        destOffset += step;
    }
}

return { predictBlock, averageBlocks, addResidual, addResidualField };
});

__def("slice.js", function (__req) {
// Slice and macroblock layer.
//
// A slice is an independently decodable run of macroblocks within one macroblock row.
// Predictors reset at every slice start, which is what makes error recovery possible.

const { BitstreamError } = __req('errors.js');
const { PICTURE_STRUCTURE_BOTTOM_FIELD, PICTURE_TYPE_B, PICTURE_TYPE_I, PICTURE_TYPE_P, SLICE_START_CODE_MAX } = __req('constants.js');
const { pictureMbHeight } = __req('picture.js');
const { MB_INTRA, MB_MOTION_BACKWARD, MB_MOTION_FORWARD, MB_PATTERN, MB_QUANT, VLC_CODED_BLOCK_PATTERN, VLC_MACROBLOCK_ADDRESS_INCREMENT, VLC_MACROBLOCK_ESCAPE, VLC_MACROBLOCK_TYPE_B, VLC_MACROBLOCK_TYPE_I, VLC_MACROBLOCK_TYPE_P } = __req('vlc.js');
const { idct } = __req('idct.js');
const { BlockDecoder } = __req('block.js');
const { E_BOTTOM_FROM_TOP, E_TOP_FROM_BOTTOM, MV_FORMAT_FIELD, MV_FORMAT_FRAME, MotionState, chromaVector420, decodeDmvector, decodeMotionVectorComponent, dualPrimeComponent } = __req('motion.js');
const { addResidual, addResidualField, averageBlocks, predictBlock } = __req('mc.js');
const { CHROMA_BORDER, LUMA_BORDER } = __req('frame.js');

/** Blocks per macroblock at 4:2:0. */
const BLOCK_COUNT = 6;

/** Position of each luma block within the 16x16 macroblock. */
const LUMA_BLOCK_X = [0, 8, 0, 8];
const LUMA_BLOCK_Y = [0, 0, 8, 8];

/** frame_motion_type codes (Table 6-17), used only in frame pictures. */
const FRAME_MOTION_FIELD = 1;
const FRAME_MOTION_FRAME = 2;

/** field_motion_type codes (Table 6-18), used only in field pictures. */
const FIELD_MOTION_FIELD = 1;
const FIELD_MOTION_16X8 = 2;

/**
 * Dual prime, which is code 3 in both Table 6-17 and Table 6-18. The shared value is
 * convenient rather than coincidental: the two tables are deliberately aligned there.
 */
const MOTION_DUAL_PRIME = 3;

function macroblockTypeTable(codingType) {
    switch (codingType) {
        case PICTURE_TYPE_I:
            return VLC_MACROBLOCK_TYPE_I;
        case PICTURE_TYPE_P:
            return VLC_MACROBLOCK_TYPE_P;
        case PICTURE_TYPE_B:
            return VLC_MACROBLOCK_TYPE_B;
        default:
            return null;
    }
}

/**
 * Where a picture's samples land in the frame buffer.
 *
 * A frame picture writes consecutive rows. A field picture writes every other row, starting
 * at the row matching its parity, so the stride doubles and the origin shifts down by one
 * row for a bottom field.
 *
 * Expressing that as an origin plus a stride is what keeps every write path in this file
 * identical for both kinds of picture: below this point nothing needs to know which it is
 * decoding, and all picture coordinates are simply coordinates within the picture.
 */
class Destination {
    constructor() {
        this.lumaOrigin = 0;
        this.lumaStride = 0;
        this.chromaOrigin = 0;
        this.chromaStride = 0;
    }

    set(frame, picture) {
        if (picture.isFramePicture) {
            this.lumaOrigin = frame.lumaOrigin;
            this.lumaStride = frame.lumaStride;
            this.chromaOrigin = frame.chromaOrigin;
            this.chromaStride = frame.chromaStride;
            return;
        }

        const parity = picture.pictureStructure === PICTURE_STRUCTURE_BOTTOM_FIELD ? 1 : 0;
        this.lumaOrigin = frame.lumaOrigin + parity * frame.lumaStride;
        this.lumaStride = frame.lumaStride * 2;
        this.chromaOrigin = frame.chromaOrigin + parity * frame.chromaStride;
        this.chromaStride = frame.chromaStride * 2;
    }

    luma(x, y) {
        return this.lumaOrigin + y * this.lumaStride + x;
    }

    chroma(x, y) {
        return this.chromaOrigin + y * this.chromaStride + x;
    }
}

/**
 * Resolve which decoded frame holds the reference field of the requested parity, for a
 * prediction in a field picture.
 *
 * The ordinary answer is the forward or backward reference frame, with the parity bit
 * choosing one of its two fields.
 *
 * The exception is the second field of a P frame. By then the most recently decoded
 * reference field of the opposite parity is the FIRST FIELD OF THE FRAME BEING DECODED
 * (7.6.2.1, Figures 7-7 and 7-8), which sits in neither reference slot because the frame is
 * still being built. Missing this reads a field one whole frame too old: the picture stays
 * recognisable and only alternate lines lag, so it reads as judder or combing rather than as
 * obvious corruption.
 *
 * B pictures never hit the exception. A B field is not a reference, so neither is its
 * partner field, and both directions always resolve to a completed reference frame.
 */
function referenceFieldSource(references, picture, direction, refParity) {
    if (direction === 1) return references.backward;
    if (
        picture.codingType !== PICTURE_TYPE_B &&
        references.isSecondField &&
        refParity !== references.currentParity
    ) {
        return references.current;
    }
    return references.forward;
}

class SliceDecoder {
    constructor() {
        this.blocks = new BlockDecoder();
        this.motion = new MotionState();
        /** IDCT output for one block. */
        this.samples = new Int16Array(64);
        /** Sample geometry of the picture being decoded. */
        this.dest = new Destination();

        // Scratch for the second direction of a bidirectional prediction. Preallocated so
        // the macroblock path allocates nothing.
        this.lumaTemp = new Uint8Array(16 * 16);
        this.chromaTemp = new Uint8Array(8 * 8 * 2);

        // Field picture motion, indexed r * 2 + s: up to two vectors per direction.
        this._fieldSelect = new Uint8Array(4);
        this._fieldMvX = new Int32Array(4);
        this._fieldMvY = new Int32Array(4);

        this.quantiserScaleCode = 1;
        this.macroblocksDecoded = 0;
        this.skippedMacroblocks = 0;

        // Coverage counters for the interlaced coding tools. These turn "does the corpus
        // actually exercise this path?" into something a test can assert, rather than
        // something inferred from a green board. Without them the likely outcome is a
        // passing suite over a dual prime branch nothing ever executed.
        this.fieldPictureMacroblocks = 0;
        this.sixteenByEightMacroblocks = 0;
        this.dualPrimeMacroblocks = 0;
        /** Dual prime inside a frame picture, which no fixture in the corpus contains. */
        this.dualPrimeFrameMacroblocks = 0;

        // Retained across macroblocks so a skipped B macroblock can repeat them.
        this._lastType = 0;
    }

    /**
     * @param {BitReader} reader positioned just past the slice start code
     * @param {number} sliceStartCode carries the macroblock row
     * @param {object} sequence SequenceState
     * @param {object} picture PictureState
     * @param {Frame} frame target
     * @param {{forward: Frame|null, backward: Frame|null, current: Frame|null,
     *          currentParity: number, isSecondField: boolean}} references
     */
    decodeSlice(reader, sliceStartCode, sequence, picture, frame, references) {
        if (sliceStartCode < 1 || sliceStartCode > SLICE_START_CODE_MAX) {
            throw new BitstreamError(`invalid slice start code ${sliceStartCode}`, reader.byteOffset);
        }

        // A field picture covers half the frame's macroblock rows. Bounding against the
        // frame height instead would accept a slice row that writes past the end of the
        // field, and would not catch a desynchronised picture at all.
        const mbHeight = pictureMbHeight(sequence, picture);

        // The row comes from the start code rather than a running counter. Trusting it lets
        // a decoder recover from a lost slice instead of shifting every later macroblock.
        const mbRow = sliceStartCode - 1;
        if (mbRow >= mbHeight) {
            throw new BitstreamError(
                `slice row ${mbRow} beyond picture height ${mbHeight}`,
                reader.byteOffset
            );
        }

        this.dest.set(frame, picture);
        this._readSliceHeader(reader, sequence);

        // Everything resets at a slice boundary.
        this.blocks.resetDcPredictors(picture.intraDcPrecision);
        this.motion.reset();
        this._lastType = 0;

        const mbWidth = sequence.mbWidth;
        let address = mbRow * mbWidth - 1;
        let first = true;

        const typeTable = macroblockTypeTable(picture.codingType);
        if (!typeTable) {
            throw new BitstreamError(
                `unsupported picture_coding_type ${picture.codingType}`,
                reader.byteOffset
            );
        }

        // A slice ends when the next 23 bits are zero, being the start of the following
        // start code prefix possibly preceded by stuffing. Testing atStartCode() instead
        // does not work: it peeks from the current bit position, and inside slice data the
        // reader is almost never byte aligned, so the test never fires and the loop devours
        // the following slices as macroblock data.
        const maxMacroblocks = mbWidth + 1;
        let decodedHere = 0;

        // The 23-zero test is the terminator; the bits-remaining test only stops a runaway
        // at end of data. It must NOT require 23 bits to be available: a stream that ends
        // without a sequence_end_code has only a few bits of byte-alignment padding after
        // its final macroblock, and demanding 23 silently drops the last macroblocks of the
        // last picture. Past the end the reader zero-pads, so peek(23) returns 0 and the
        // loop exits on its own.
        while (reader.bitsRemaining > 0 && reader.peek(23) !== 0) {
            if (++decodedHere > maxMacroblocks) {
                throw new BitstreamError(
                    `slice at row ${mbRow} produced more than ${mbWidth} macroblocks; lost sync`,
                    reader.byteOffset
                );
            }

            let increment = 0;
            for (;;) {
                const value = VLC_MACROBLOCK_ADDRESS_INCREMENT.decodeOrThrow(
                    reader,
                    'macroblock_address_increment'
                );
                if (value === VLC_MACROBLOCK_ESCAPE) {
                    increment += 33;
                    continue;
                }
                increment += value;
                break;
            }

            if (first) {
                // A gap on the first macroblock does NOT mean skipped macroblocks: the
                // slice simply starts partway into the row and anything before it is absent
                // rather than predicted.
                address += increment;
                first = false;
            } else {
                const skipped = increment - 1;
                if (skipped > 0) {
                    if (picture.codingType === PICTURE_TYPE_I) {
                        throw new BitstreamError(
                            'skipped macroblocks are not permitted in I pictures',
                            reader.byteOffset
                        );
                    }
                    this._skipMacroblocks(
                        address + 1,
                        skipped,
                        sequence,
                        picture,
                        frame,
                        references,
                        reader
                    );
                    this.skippedMacroblocks += skipped;
                }
                address += increment;
            }

            if (address >= mbWidth * mbHeight) {
                throw new BitstreamError(
                    `macroblock address ${address} out of range`,
                    reader.byteOffset
                );
            }

            this._decodeMacroblock(reader, typeTable, address, sequence, picture, frame, references);
            this.macroblocksDecoded++;
        }

        return address;
    }

    /**
     * Slice header.
     *
     * The final extra_bit_slice is read unconditionally, OUTSIDE the optional group above
     * it. Reading it inside, or skipping it, desynchronises every slice in the stream.
     */
    _readSliceHeader(reader, sequence) {
        // Present only for pictures taller than Main Level allows; parsed so the layout
        // stays correct if one ever appears.
        if (sequence.height > 2800) reader.read(3);

        this.quantiserScaleCode = reader.read(5);
        if (this.quantiserScaleCode === 0) {
            throw new BitstreamError('quantiser_scale_code 0 is not valid', reader.byteOffset);
        }

        if (reader.peek(1) === 1) {
            reader.read(1); // intra_slice_flag
            reader.read(1); // intra_slice
            reader.read(7); // reserved_bits
            let guard = 0;
            while (reader.peek(1) === 1) {
                reader.read(1); // extra_bit_slice
                reader.read(8); // extra_information_slice
                if (++guard > 4096) {
                    throw new BitstreamError(
                        'runaway extra_information_slice; lost sync',
                        reader.byteOffset
                    );
                }
            }
        }
        reader.read(1); // extra_bit_slice, always present
    }

    _decodeMacroblock(reader, typeTable, address, sequence, picture, frame, references) {
        const type = typeTable.decodeOrThrow(reader, 'macroblock_type');
        this._lastType = type;

        const isIntra = (type & MB_INTRA) !== 0;
        const hasPattern = (type & MB_PATTERN) !== 0;
        const hasForward = (type & MB_MOTION_FORWARD) !== 0;
        const hasBackward = (type & MB_MOTION_BACKWARD) !== 0;
        const isFieldPicture = !picture.isFramePicture;
        const hasMotion = hasForward || hasBackward;

        // The motion type field is present only when the macroblock actually has motion, and
        // in a frame picture only when frame_pred_frame_dct is clear. When it is absent the
        // default is whatever the picture's natural prediction is: frame-based in a frame
        // picture, field-based in a field picture (notes (a) to Tables 7-9 and 7-10).
        // Reading it unconditionally desynchronises the whole picture.
        let motionType = isFieldPicture ? FIELD_MOTION_FIELD : FRAME_MOTION_FRAME;
        if (isFieldPicture) {
            if (hasMotion) motionType = reader.read(2);
        } else if (!picture.framePredFrameDct && hasMotion) {
            motionType = reader.read(2);
        }
        if (motionType === 0) {
            throw new BitstreamError(
                `${isFieldPicture ? 'field' : 'frame'}_motion_type 0 is reserved`,
                reader.byteOffset
            );
        }

        // dct_type exists only in frame pictures. A field picture's blocks are already field
        // organised, so there is nothing to choose.
        let dctType = 0;
        if (picture.isFramePicture && !picture.framePredFrameDct && (isIntra || hasPattern)) {
            dctType = reader.read1();
        }

        if (type & MB_QUANT) {
            const code = reader.read(5);
            if (code === 0) {
                throw new BitstreamError('quantiser_scale_code 0 is not valid', reader.byteOffset);
            }
            // A new quantiser scale persists for the rest of the slice.
            this.quantiserScaleCode = code;
        }

        if (isIntra) {
            if (picture.concealmentMotionVectors) {
                // An intra macroblock carries a motion vector that a decoder may use to
                // conceal damage. We do not conceal, but the vector still has to be parsed
                // or the bitstream desynchronises, and the predictors still have to be
                // updated because later macroblocks code against them.
                //
                // No motion type field is present: the condition for reading one is
                // motion_forward or motion_backward, and both are zero for an intra
                // macroblock. The assumed default therefore decides the vector's format,
                // and in a FIELD picture that default is field-based, which means
                // motion_vectors() emits a motion_vertical_field_select bit ahead of the
                // vector. Skipping that single bit desynchronises every following
                // macroblock, and only on interlaced streams that also use concealment.
                if (isFieldPicture) reader.read1(); // motion_vertical_field_select[0][0]

                const format = isFieldPicture ? MV_FORMAT_FIELD : MV_FORMAT_FRAME;
                const structure = picture.pictureStructure;
                decodeMotionVectorComponent(
                    reader, this.motion, 0, 0, 0, picture.fCode[0][0], format, structure
                );
                decodeMotionVectorComponent(
                    reader, this.motion, 0, 0, 1, picture.fCode[0][1], format, structure
                );
                this.motion.duplicateToSecond(0);
                reader.readMarkerBit('concealment motion vector');
            } else {
                // Without concealment vectors an intra macroblock resets the predictors.
                this.motion.reset();
            }
            this._decodeIntraMacroblock(reader, address, sequence, picture, frame, dctType);
            return;
        }

        if (motionType === MOTION_DUAL_PRIME) {
            this._decodeDualPrimeMacroblock(
                reader, address, sequence, picture, frame, references, hasPattern, dctType
            );
            return;
        }

        if (isFieldPicture) {
            this._decodeFieldPictureMacroblock(
                reader, address, sequence, picture, frame, references,
                motionType, hasForward, hasBackward, hasPattern
            );
            return;
        }

        if (motionType === FRAME_MOTION_FIELD) {
            this._decodeFieldInFrameMacroblock(
                reader, address, sequence, picture, frame, references,
                hasForward, hasBackward, hasPattern, dctType
            );
            return;
        }

        this._decodePredictedMacroblock(
            reader,
            address,
            sequence,
            picture,
            frame,
            references,
            hasForward,
            hasBackward,
            hasPattern,
            dctType
        );
    }

    _decodePredictedMacroblock(
        reader,
        address,
        sequence,
        picture,
        frame,
        references,
        hasForward,
        hasBackward,
        hasPattern,
        dctType
    ) {
        const motion = this.motion;

        let forwardX = 0;
        let forwardY = 0;
        let backwardX = 0;
        let backwardY = 0;

        // In a P picture every non-intra macroblock predicts from the forward reference.
        // macroblock_motion_forward=0 does not mean "no prediction": it means the vector is
        // zero and the predictors reset. Treating it as no prediction leaves the recycled
        // frame's stale contents in place, which wrecks the picture from the first P frame
        // onward while intra pictures still look perfect.
        const isPPicture = picture.codingType === PICTURE_TYPE_P;
        const predictForward = hasForward || isPPicture;

        if (hasForward) {
            forwardX = decodeMotionVectorComponent(
                reader, motion, 0, 0, 0, picture.fCode[0][0], MV_FORMAT_FRAME, picture.pictureStructure
            );
            forwardY = decodeMotionVectorComponent(
                reader, motion, 0, 0, 1, picture.fCode[0][1], MV_FORMAT_FRAME, picture.pictureStructure
            );
            motion.duplicateToSecond(0);
        } else if (isPPicture) {
            motion.reset();
        }

        if (hasBackward) {
            backwardX = decodeMotionVectorComponent(
                reader, motion, 0, 1, 0, picture.fCode[1][0], MV_FORMAT_FRAME, picture.pictureStructure
            );
            backwardY = decodeMotionVectorComponent(
                reader, motion, 0, 1, 1, picture.fCode[1][1], MV_FORMAT_FRAME, picture.pictureStructure
            );
            motion.duplicateToSecond(1);
        }

        let cbp = 0;
        if (hasPattern) {
            cbp = VLC_CODED_BLOCK_PATTERN.decodeOrThrow(reader, 'coded_block_pattern');
        }

        this._formPrediction(
            address, sequence, frame, references,
            predictForward, hasBackward, forwardX, forwardY, backwardX, backwardY
        );

        // A non-intra macroblock resets the intra DC predictors.
        this.blocks.resetDcPredictors(picture.intraDcPrecision);

        if (!hasPattern) return;

        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;
        this._addResidualBlocks(reader, sequence, picture, frame, cbp, mbX, mbY, dctType);
    }

    /**
     * Field-based prediction inside a frame picture (frame_motion_type = 01).
     *
     * Two vectors: the first predicts the macroblock's top-field lines (frame rows 0, 2,
     * ... 14) and the second its bottom-field lines (rows 1, 3, ... 15). Each prediction is
     * 16 samples wide by 8 field lines tall.
     *
     * This is NOT the same thing as 16x8 motion compensation in a field picture, which
     * splits a macroblock into upper and lower halves. Conflating the two is a real design
     * hazard, so they are named differently and handled separately.
     *
     * motion_vertical_field_select chooses the parity of the REFERENCE field, independently
     * of which destination field the vector serves: a vector writing the top field may
     * legitimately read the bottom field of the reference.
     */
    _decodeFieldInFrameMacroblock(
        reader, address, sequence, picture, frame, references,
        hasForward, hasBackward, hasPattern, dctType
    ) {
        const motion = this.motion;
        const structure = picture.pictureStructure;

        // Two vectors per direction, each preceded by its reference field selector.
        const forwardSelect = [0, 0];
        const backwardSelect = [0, 0];
        const forwardX = [0, 0];
        const forwardY = [0, 0];
        const backwardX = [0, 0];
        const backwardY = [0, 0];

        if (hasForward) {
            for (let r = 0; r < 2; r++) {
                forwardSelect[r] = reader.read1();
                forwardX[r] = decodeMotionVectorComponent(
                    reader, motion, r, 0, 0, picture.fCode[0][0], MV_FORMAT_FIELD, structure
                );
                forwardY[r] = decodeMotionVectorComponent(
                    reader, motion, r, 0, 1, picture.fCode[0][1], MV_FORMAT_FIELD, structure
                );
            }
        }
        if (hasBackward) {
            for (let r = 0; r < 2; r++) {
                backwardSelect[r] = reader.read1();
                backwardX[r] = decodeMotionVectorComponent(
                    reader, motion, r, 1, 0, picture.fCode[1][0], MV_FORMAT_FIELD, structure
                );
                backwardY[r] = decodeMotionVectorComponent(
                    reader, motion, r, 1, 1, picture.fCode[1][1], MV_FORMAT_FIELD, structure
                );
            }
        }

        let cbp = 0;
        if (hasPattern) {
            cbp = VLC_CODED_BLOCK_PATTERN.decodeOrThrow(reader, 'coded_block_pattern');
        }

        const predictForward = hasForward || picture.codingType === PICTURE_TYPE_P;
        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;

        for (let field = 0; field < 2; field++) {
            const useBoth = predictForward && hasBackward;
            if (predictForward) {
                this._predictField(
                    frame, references.forward, mbX, mbY, field,
                    forwardSelect[field], forwardX[field], forwardY[field], false
                );
            }
            if (hasBackward) {
                this._predictField(
                    frame, references.backward, mbX, mbY, field,
                    backwardSelect[field], backwardX[field], backwardY[field], useBoth
                );
            }
            if (useBoth) {
                this._averageField(frame, mbX, mbY, field);
            }
        }

        this.blocks.resetDcPredictors(picture.intraDcPrecision);
        if (!hasPattern) return;

        this._addResidualBlocks(reader, sequence, picture, frame, cbp, mbX, mbY, dctType);
    }

    /**
     * Motion compensation in a field picture: field-based (one vector for the whole
     * macroblock) or 16x8 (one vector for the upper eight field lines, one for the lower).
     *
     * Everything here is in field coordinates. The macroblock is 16 samples by 16 FIELD
     * lines, so it spans 32 frame lines, and the vertical motion vectors are in field lines
     * too. The Destination set up in decodeSlice already carries the row interleave, so the
     * geometry below reads exactly like the frame-picture case.
     */
    _decodeFieldPictureMacroblock(
        reader, address, sequence, picture, frame, references,
        motionType, hasForward, hasBackward, hasPattern
    ) {
        const motion = this.motion;
        const structure = picture.pictureStructure;
        const isPPicture = picture.codingType === PICTURE_TYPE_P;

        const select = this._fieldSelect;
        const mvX = this._fieldMvX;
        const mvY = this._fieldMvY;

        // 16x8 codes two vectors per direction and field-based codes one (Table 6-18).
        const vectorCount = motionType === FIELD_MOTION_16X8 ? 2 : 1;

        this.fieldPictureMacroblocks++;
        if (vectorCount === 2) this.sixteenByEightMacroblocks++;

        if (hasForward) {
            for (let r = 0; r < vectorCount; r++) {
                select[r * 2] = reader.read1();
                mvX[r * 2] = decodeMotionVectorComponent(
                    reader, motion, r, 0, 0, picture.fCode[0][0], MV_FORMAT_FIELD, structure
                );
                mvY[r * 2] = decodeMotionVectorComponent(
                    reader, motion, r, 0, 1, picture.fCode[0][1], MV_FORMAT_FIELD, structure
                );
            }
            // One coded vector has to seed both predictors; two update their own (Table
            // 7-10, where 16x8 updates "None").
            if (vectorCount === 1) motion.duplicateToSecond(0);
        } else if (isPPicture) {
            // No vectors coded for a non-intra P macroblock. 7.6.3.5 makes this field-based
            // with a zero vector, predicting from the field of the SAME PARITY as the field
            // being decoded, with the predictors reset.
            motion.reset();
            select[0] = references.currentParity;
            mvX[0] = 0;
            mvY[0] = 0;
        }

        if (hasBackward) {
            for (let r = 0; r < vectorCount; r++) {
                select[r * 2 + 1] = reader.read1();
                mvX[r * 2 + 1] = decodeMotionVectorComponent(
                    reader, motion, r, 1, 0, picture.fCode[1][0], MV_FORMAT_FIELD, structure
                );
                mvY[r * 2 + 1] = decodeMotionVectorComponent(
                    reader, motion, r, 1, 1, picture.fCode[1][1], MV_FORMAT_FIELD, structure
                );
            }
            if (vectorCount === 1) motion.duplicateToSecond(1);
        }

        let cbp = 0;
        if (hasPattern) {
            cbp = VLC_CODED_BLOCK_PATTERN.decodeOrThrow(reader, 'coded_block_pattern');
        }

        const predictForward = hasForward || isPPicture;
        const useBoth = predictForward && hasBackward;
        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;

        // Field-based covers all 16 field lines in one region; 16x8 covers 8 lines each.
        const regionHeight = vectorCount === 2 ? 8 : 16;

        for (let r = 0; r < vectorCount; r++) {
            const regionY = r * 8;
            if (predictForward) {
                const parity = select[r * 2];
                this._predictFieldPicture(
                    frame, referenceFieldSource(references, picture, 0, parity), parity,
                    mbX, mbY, regionY, regionHeight, mvX[r * 2], mvY[r * 2], false
                );
            }
            if (hasBackward) {
                const parity = select[r * 2 + 1];
                this._predictFieldPicture(
                    frame, referenceFieldSource(references, picture, 1, parity), parity,
                    mbX, mbY, regionY, regionHeight, mvX[r * 2 + 1], mvY[r * 2 + 1], useBoth
                );
            }
            if (useBoth) {
                this._averageFieldPicture(frame, mbX, mbY, regionY, regionHeight);
            }
        }

        this.blocks.resetDcPredictors(picture.intraDcPrecision);
        if (!hasPattern) return;

        // dct_type is absent in a field picture, so the blocks are always written as eight
        // consecutive field lines.
        this._addResidualBlocks(reader, sequence, picture, frame, cbp, mbX, mbY, 0);
    }

    /**
     * Dual prime prediction (7.6.3.6, 7.6.5, 7.6.7.4).
     *
     * One field vector is coded. From it a second is derived for the opposite parity field,
     * scaled for the different temporal distance and nudged by a differential vector of at
     * most one half sample per component. Both predictions are formed and averaged.
     *
     * The point of it is cheap bidirectional-quality prediction in a stream with no B
     * pictures, which is why it turns up in low delay and broadcast contribution encodes.
     *
     * A frame picture does this twice, once per field, giving four predictions; a field
     * picture does it once. The scaling factor m differs between the two because a frame
     * picture's fields sit at different distances from the reference frame, while in a field
     * picture the same-parity reference is always two field periods away and the
     * opposite-parity one always a single field period away, so m is 1.
     */
    _decodeDualPrimeMacroblock(
        reader, address, sequence, picture, frame, references, hasPattern, dctType
    ) {
        if (picture.codingType !== PICTURE_TYPE_P) {
            // 7.6.1: dual prime is defined only where there are no B pictures between the
            // predicted and reference fields, which confines it to P pictures.
            throw new BitstreamError(
                'dual-prime prediction is only valid in P pictures',
                reader.byteOffset
            );
        }
        this.dualPrimeMacroblocks++;

        const motion = this.motion;
        const structure = picture.pictureStructure;

        // dmvector is INTERLEAVED between the two vector components, not appended after
        // them. Reading both components and then both differentials consumes the same number
        // of bits and desynchronises nothing immediately, so the mistake survives until the
        // vectors themselves are wrong.
        const mvX = decodeMotionVectorComponent(
            reader, motion, 0, 0, 0, picture.fCode[0][0], MV_FORMAT_FIELD, structure
        );
        const dmvX = decodeDmvector(reader);
        const mvY = decodeMotionVectorComponent(
            reader, motion, 0, 0, 1, picture.fCode[0][1], MV_FORMAT_FIELD, structure
        );
        const dmvY = decodeDmvector(reader);

        // One coded vector, so both predictors track it (Tables 7-9 and 7-10).
        motion.duplicateToSecond(0);

        let cbp = 0;
        if (hasPattern) {
            cbp = VLC_CODED_BLOCK_PATTERN.decodeOrThrow(reader, 'coded_block_pattern');
        }

        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;

        if (picture.isFramePicture) {
            this.dualPrimeFrameMacroblocks++;

            // Field distances from the reference frame depend on which field is displayed
            // first: with top_field_first the current top field is one field period from the
            // reference bottom field and the current bottom field is three from the
            // reference top field, and the roles swap when the bottom field leads.
            const mTopFromBottom = picture.topFieldFirst ? 1 : 3;
            const mBottomFromTop = picture.topFieldFirst ? 3 : 1;

            const oppositeX = [
                dualPrimeComponent(mvX, mTopFromBottom, 0, dmvX),
                dualPrimeComponent(mvX, mBottomFromTop, 0, dmvX),
            ];
            const oppositeY = [
                dualPrimeComponent(mvY, mTopFromBottom, E_TOP_FROM_BOTTOM, dmvY),
                dualPrimeComponent(mvY, mBottomFromTop, E_BOTTOM_FROM_TOP, dmvY),
            ];

            const forward = references.forward;
            for (let field = 0; field < 2; field++) {
                // Same parity uses the coded vector, opposite parity the derived one.
                this._predictField(frame, forward, mbX, mbY, field, field, mvX, mvY, false);
                this._predictField(
                    frame, forward, mbX, mbY, field, 1 - field,
                    oppositeX[field], oppositeY[field], true
                );
                this._averageField(frame, mbX, mbY, field);
            }
        } else {
            const parity = references.currentParity;
            const opposite = 1 - parity;
            const e = parity === 1 ? E_BOTTOM_FROM_TOP : E_TOP_FROM_BOTTOM;

            this._predictFieldPicture(
                frame, referenceFieldSource(references, picture, 0, parity), parity,
                mbX, mbY, 0, 16, mvX, mvY, false
            );
            this._predictFieldPicture(
                frame, referenceFieldSource(references, picture, 0, opposite), opposite,
                mbX, mbY, 0, 16,
                dualPrimeComponent(mvX, 1, 0, dmvX),
                dualPrimeComponent(mvY, 1, e, dmvY),
                true
            );
            this._averageFieldPicture(frame, mbX, mbY, 0, 16);
        }

        this.blocks.resetDcPredictors(picture.intraDcPrecision);
        if (!hasPattern) return;

        this._addResidualBlocks(
            reader, sequence, picture, frame, cbp, mbX, mbY,
            picture.isFramePicture ? dctType : 0
        );
    }

    /**
     * Predict one region of a field-picture macroblock from one field of a reference frame.
     *
     * @param {number} regionY field line offset within the macroblock: 0, or 8 for the
     *        lower half of a 16x8 prediction
     * @param {number} height field lines to predict, 16 or 8
     * @param {boolean} toTemp write into scratch instead of the frame, for averaging
     */
    _predictFieldPicture(frame, reference, refParity, mbX, mbY, regionY, height, mvX, mvY, toTemp) {
        if (!reference) {
            throw new BitstreamError('field prediction with no reference frame');
        }

        const dest = this.dest;

        // One field of the reference: every other row, starting at the parity's row.
        const refLumaOrigin = reference.lumaOrigin + refParity * reference.lumaStride;
        const refLumaStride = reference.lumaStride * 2;
        const refChromaOrigin = reference.chromaOrigin + refParity * reference.chromaStride;
        const refChromaStride = reference.chromaStride * 2;

        const y = mbY + regionY;
        const cx = mbX >> 1;
        const cy = y >> 1;
        const chromaHeight = height >> 1;

        const chromaMvX = chromaVector420(mvX);
        const chromaMvY = chromaVector420(mvY);

        // Scratch layout mirrors the region layout so the two halves of a 16x8 prediction
        // never overlap: luma rows regionY..regionY+height, chroma rows half of that.
        const lumaTempOffset = regionY * 16;
        const chromaTempOffset = (regionY >> 1) * 8;

        const lumaWidth = reference.codedWidth;
        const chromaWidth = reference.codedWidth >> 1;

        if (toTemp) {
            predictBlock(this.lumaTemp, lumaTempOffset, 16, reference.y, refLumaOrigin, refLumaStride, lumaWidth, LUMA_BORDER, mbX, y, 16, height, mvX, mvY);
            predictBlock(this.chromaTemp, chromaTempOffset, 8, reference.cb, refChromaOrigin, refChromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, chromaHeight, chromaMvX, chromaMvY);
            predictBlock(this.chromaTemp, 64 + chromaTempOffset, 8, reference.cr, refChromaOrigin, refChromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, chromaHeight, chromaMvX, chromaMvY);
            return;
        }

        predictBlock(frame.y, dest.luma(mbX, y), dest.lumaStride, reference.y, refLumaOrigin, refLumaStride, lumaWidth, LUMA_BORDER, mbX, y, 16, height, mvX, mvY);
        predictBlock(frame.cb, dest.chroma(cx, cy), dest.chromaStride, reference.cb, refChromaOrigin, refChromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, chromaHeight, chromaMvX, chromaMvY);
        predictBlock(frame.cr, dest.chroma(cx, cy), dest.chromaStride, reference.cr, refChromaOrigin, refChromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, chromaHeight, chromaMvX, chromaMvY);
    }

    _averageFieldPicture(frame, mbX, mbY, regionY, height) {
        const dest = this.dest;
        const y = mbY + regionY;
        const cx = mbX >> 1;
        const cy = y >> 1;
        const lumaTempOffset = regionY * 16;
        const chromaTempOffset = (regionY >> 1) * 8;

        averageBlocks(frame.y, dest.luma(mbX, y), dest.lumaStride, this.lumaTemp, lumaTempOffset, 16, 16, height);
        averageBlocks(frame.cb, dest.chroma(cx, cy), dest.chromaStride, this.chromaTemp, chromaTempOffset, 8, 8, height >> 1);
        averageBlocks(frame.cr, dest.chroma(cx, cy), dest.chromaStride, this.chromaTemp, 64 + chromaTempOffset, 8, 8, height >> 1);
    }

    /** Predict one field of a macroblock in a FRAME picture, from a reference field. */
    _predictField(frame, reference, mbX, mbY, destField, refParity, mvX, mvY, toTemp) {
        if (!reference) throw new BitstreamError('field prediction with no reference frame');

        const dest = this.dest;

        // Rows of one field are every other frame row, so the stride doubles and the origin
        // shifts by one row for the bottom field.
        const refLumaOrigin = reference.lumaOrigin + (refParity ? reference.lumaStride : 0);
        const refChromaOrigin = reference.chromaOrigin + (refParity ? reference.chromaStride : 0);

        const chromaMvX = chromaVector420(mvX);
        const chromaMvY = chromaVector420(mvY);

        // Field coordinates: half the frame row, since a field holds every other row.
        const fieldY = mbY >> 1;
        const chromaFieldY = mbY >> 2;
        const cx = mbX >> 1;

        const lumaWidth = reference.codedWidth;
        const chromaWidth = reference.codedWidth >> 1;

        if (toTemp) {
            predictBlock(this.lumaTemp, destField * 8 * 16, 16, reference.y, refLumaOrigin, reference.lumaStride * 2, lumaWidth, LUMA_BORDER, mbX, fieldY, 16, 8, mvX, mvY);
            predictBlock(this.chromaTemp, destField * 4 * 8, 8, reference.cb, refChromaOrigin, reference.chromaStride * 2, chromaWidth, CHROMA_BORDER, cx, chromaFieldY, 8, 4, chromaMvX, chromaMvY);
            predictBlock(this.chromaTemp, 64 + destField * 4 * 8, 8, reference.cr, refChromaOrigin, reference.chromaStride * 2, chromaWidth, CHROMA_BORDER, cx, chromaFieldY, 8, 4, chromaMvX, chromaMvY);
            return;
        }

        predictBlock(frame.y, dest.luma(mbX, mbY + destField), dest.lumaStride * 2, reference.y, refLumaOrigin, reference.lumaStride * 2, lumaWidth, LUMA_BORDER, mbX, fieldY, 16, 8, mvX, mvY);
        predictBlock(frame.cb, dest.chroma(cx, (mbY >> 1) + destField), dest.chromaStride * 2, reference.cb, refChromaOrigin, reference.chromaStride * 2, chromaWidth, CHROMA_BORDER, cx, chromaFieldY, 8, 4, chromaMvX, chromaMvY);
        predictBlock(frame.cr, dest.chroma(cx, (mbY >> 1) + destField), dest.chromaStride * 2, reference.cr, refChromaOrigin, reference.chromaStride * 2, chromaWidth, CHROMA_BORDER, cx, chromaFieldY, 8, 4, chromaMvX, chromaMvY);
    }

    _averageField(frame, mbX, mbY, destField) {
        const dest = this.dest;
        const cx = mbX >> 1;
        averageBlocks(frame.y, dest.luma(mbX, mbY + destField), dest.lumaStride * 2, this.lumaTemp, destField * 8 * 16, 16, 16, 8);
        averageBlocks(frame.cb, dest.chroma(cx, (mbY >> 1) + destField), dest.chromaStride * 2, this.chromaTemp, destField * 4 * 8, 8, 8, 4);
        averageBlocks(frame.cr, dest.chroma(cx, (mbY >> 1) + destField), dest.chromaStride * 2, this.chromaTemp, 64 + destField * 4 * 8, 8, 8, 4);
    }

    /** Decode the coded blocks of a predicted macroblock and add them to the prediction. */
    _addResidualBlocks(reader, sequence, picture, frame, cbp, mbX, mbY, dctType) {
        const dest = this.dest;

        for (let blockIndex = 0; blockIndex < BLOCK_COUNT; blockIndex++) {
            // cbp bit 5 selects block 0 and bit 0 selects block 5.
            if ((cbp & (1 << (5 - blockIndex))) === 0) continue;

            const isLuma = blockIndex < 4;
            const matrix = isLuma
                ? sequence.nonIntraQuantiserMatrix
                : sequence.chromaNonIntraQuantiserMatrix;

            const coefficients = this.blocks.decodeNonIntra(
                reader, picture, matrix, this.quantiserScaleCode
            );
            idct(coefficients, this.samples, this.blocks.nonZeroCount, this.blocks.lastNonZero);

            if (isLuma) {
                const x = mbX + LUMA_BLOCK_X[blockIndex];
                if (dctType === 0) {
                    const y = mbY + LUMA_BLOCK_Y[blockIndex];
                    addResidual(frame.y, dest.luma(x, y), dest.lumaStride, this.samples);
                } else {
                    const fieldOffset = blockIndex >= 2 ? 1 : 0;
                    addResidualField(
                        frame.y,
                        dest.luma(x, mbY + fieldOffset),
                        dest.lumaStride,
                        this.samples
                    );
                }
            } else {
                const plane = blockIndex === 4 ? frame.cb : frame.cr;
                addResidual(
                    plane,
                    dest.chroma(mbX >> 1, mbY >> 1),
                    dest.chromaStride,
                    this.samples
                );
            }
        }
    }

    /** Build the prediction for a whole macroblock into the target frame. */
    _formPrediction(
        address, sequence, frame, references,
        hasForward, hasBackward, forwardX, forwardY, backwardX, backwardY
    ) {
        const dest = this.dest;
        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;
        const cx = mbX >> 1;
        const cy = mbY >> 1;

        const forward = references.forward;
        const backward = references.backward;

        if (hasForward && !forward) {
            throw new BitstreamError('forward prediction with no reference frame');
        }
        if (hasBackward && !backward) {
            throw new BitstreamError('backward prediction with no reference frame');
        }

        const useBoth = hasForward && hasBackward;

        if (hasForward) {
            this._predictInto(frame, forward, mbX, mbY, cx, cy, forwardX, forwardY, false);
        }
        if (hasBackward) {
            this._predictInto(frame, backward, mbX, mbY, cx, cy, backwardX, backwardY, useBoth);
        }

        if (useBoth) {
            // Each direction is interpolated independently and only then averaged.
            averageBlocks(frame.y, dest.luma(mbX, mbY), dest.lumaStride, this.lumaTemp, 0, 16, 16, 16);
            averageBlocks(frame.cb, dest.chroma(cx, cy), dest.chromaStride, this.chromaTemp, 0, 8, 8, 8);
            averageBlocks(frame.cr, dest.chroma(cx, cy), dest.chromaStride, this.chromaTemp, 64, 8, 8, 8);
        }
    }

    /** @param {boolean} toTemp write into scratch instead of the frame, for averaging */
    _predictInto(frame, reference, mbX, mbY, cx, cy, mvX, mvY, toTemp) {
        const dest = this.dest;
        const chromaMvX = chromaVector420(mvX);
        const chromaMvY = chromaVector420(mvY);

        const lumaWidth = reference.codedWidth;
        const chromaWidth = reference.codedWidth >> 1;

        if (toTemp) {
            predictBlock(this.lumaTemp, 0, 16, reference.y, reference.lumaOrigin, reference.lumaStride, lumaWidth, LUMA_BORDER, mbX, mbY, 16, 16, mvX, mvY);
            predictBlock(this.chromaTemp, 0, 8, reference.cb, reference.chromaOrigin, reference.chromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, 8, chromaMvX, chromaMvY);
            predictBlock(this.chromaTemp, 64, 8, reference.cr, reference.chromaOrigin, reference.chromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, 8, chromaMvX, chromaMvY);
            return;
        }

        predictBlock(frame.y, dest.luma(mbX, mbY), dest.lumaStride, reference.y, reference.lumaOrigin, reference.lumaStride, lumaWidth, LUMA_BORDER, mbX, mbY, 16, 16, mvX, mvY);
        predictBlock(frame.cb, dest.chroma(cx, cy), dest.chromaStride, reference.cb, reference.chromaOrigin, reference.chromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, 8, chromaMvX, chromaMvY);
        predictBlock(frame.cr, dest.chroma(cx, cy), dest.chromaStride, reference.cr, reference.chromaOrigin, reference.chromaStride, chromaWidth, CHROMA_BORDER, cx, cy, 8, 8, chromaMvX, chromaMvY);
    }

    /**
     * Skipped macroblocks.
     *
     * The rules differ by picture type, and applying the P rule to a B picture is a common
     * bug that shows up as intermittent blockiness on low-motion B frames.
     *
     *  - P: zero motion vector, predict from the forward reference, reset the predictors.
     *  - B: repeat the previous macroblock's prediction mode and vectors, and do NOT reset
     *    the predictors.
     *
     * Either way the intra DC predictors reset.
     */
    _skipMacroblocks(startAddress, count, sequence, picture, frame, references, reader) {
        if (!picture.isFramePicture) {
            this._skipFieldPictureMacroblocks(
                startAddress, count, sequence, picture, frame, references, reader
            );
            return;
        }

        const isB = picture.codingType === PICTURE_TYPE_B;

        let hasForward;
        let hasBackward;
        const mvX = 0;
        const mvY = 0;

        if (isB) {
            if ((this._lastType & MB_INTRA) !== 0) {
                throw new BitstreamError(
                    'a skipped macroblock cannot follow an intra macroblock in a B picture',
                    reader ? reader.byteOffset : undefined
                );
            }
            hasForward = (this._lastType & MB_MOTION_FORWARD) !== 0;
            hasBackward = (this._lastType & MB_MOTION_BACKWARD) !== 0;
        } else {
            hasForward = true;
            hasBackward = false;
            this.motion.reset();
        }

        for (let i = 0; i < count; i++) {
            const address = startAddress + i;
            const forwardX = isB ? this.motion.get(0, 0, 0) : 0;
            const forwardY = isB ? this.motion.get(0, 0, 1) : 0;
            const backwardX = isB ? this.motion.get(0, 1, 0) : 0;
            const backwardY = isB ? this.motion.get(0, 1, 1) : 0;

            this._formPrediction(
                address, sequence, frame, references,
                hasForward, hasBackward,
                isB ? forwardX : mvX, isB ? forwardY : mvY,
                backwardX, backwardY
            );
        }

        this.blocks.resetDcPredictors(picture.intraDcPrecision);
    }

    /**
     * Skipped macroblocks in a field picture (7.6.6.1 and 7.6.6.3).
     *
     * Both picture types predict field-based from the field of the SAME PARITY as the field
     * being decoded. The field select bit is not inherited from the previous macroblock even
     * in a B picture, where everything else about the prediction is.
     *
     *  - P: zero vector, predictors reset.
     *  - B: direction copied from the previous macroblock, vectors taken from the
     *    predictors, predictors left alone.
     */
    _skipFieldPictureMacroblocks(startAddress, count, sequence, picture, frame, references, reader) {
        const isB = picture.codingType === PICTURE_TYPE_B;
        const parity = references.currentParity;

        let hasForward;
        let hasBackward;

        if (isB) {
            if ((this._lastType & MB_INTRA) !== 0) {
                throw new BitstreamError(
                    'a skipped macroblock cannot follow an intra macroblock in a B picture',
                    reader ? reader.byteOffset : undefined
                );
            }
            hasForward = (this._lastType & MB_MOTION_FORWARD) !== 0;
            hasBackward = (this._lastType & MB_MOTION_BACKWARD) !== 0;
        } else {
            hasForward = true;
            hasBackward = false;
            this.motion.reset();
        }

        const forwardX = isB ? this.motion.get(0, 0, 0) : 0;
        const forwardY = isB ? this.motion.get(0, 0, 1) : 0;
        const backwardX = isB ? this.motion.get(0, 1, 0) : 0;
        const backwardY = isB ? this.motion.get(0, 1, 1) : 0;
        const useBoth = hasForward && hasBackward;

        for (let i = 0; i < count; i++) {
            const address = startAddress + i;
            const mbX = (address % sequence.mbWidth) * 16;
            const mbY = Math.floor(address / sequence.mbWidth) * 16;

            if (hasForward) {
                this._predictFieldPicture(
                    frame, referenceFieldSource(references, picture, 0, parity), parity,
                    mbX, mbY, 0, 16, forwardX, forwardY, false
                );
            }
            if (hasBackward) {
                this._predictFieldPicture(
                    frame, referenceFieldSource(references, picture, 1, parity), parity,
                    mbX, mbY, 0, 16, backwardX, backwardY, useBoth
                );
            }
            if (useBoth) {
                this._averageFieldPicture(frame, mbX, mbY, 0, 16);
            }
        }

        this.blocks.resetDcPredictors(picture.intraDcPrecision);
    }

    _decodeIntraMacroblock(reader, address, sequence, picture, frame, dctType) {
        const mbX = (address % sequence.mbWidth) * 16;
        const mbY = Math.floor(address / sequence.mbWidth) * 16;

        for (let blockIndex = 0; blockIndex < BLOCK_COUNT; blockIndex++) {
            const isLuma = blockIndex < 4;
            const matrix = isLuma
                ? sequence.intraQuantiserMatrix
                : sequence.chromaIntraQuantiserMatrix;

            const coefficients = this.blocks.decodeIntra(
                reader, blockIndex, picture, matrix, this.quantiserScaleCode
            );
            idct(coefficients, this.samples, this.blocks.nonZeroCount, this.blocks.lastNonZero);

            if (isLuma) {
                this._writeIntraLuma(frame, mbX, mbY, blockIndex, dctType);
            } else {
                this._writeIntraChroma(frame, mbX >> 1, mbY >> 1, blockIndex);
            }
        }
    }

    _writeIntraLuma(frame, mbX, mbY, blockIndex, dctType) {
        const dest = this.dest;
        const plane = frame.y;
        const stride = dest.lumaStride;
        const samples = this.samples;
        const x = mbX + LUMA_BLOCK_X[blockIndex];

        // Field DCT reorganises luma only: blocks 0 and 1 hold the even lines and 2 and 3
        // the odd ones, so rows advance by two. Chroma is never reorganised at 4:2:0.
        // dct_type is always zero in a field picture, whose rows are already field lines.
        const step = dctType === 0 ? stride : stride * 2;
        const startY = dctType === 0 ? mbY + LUMA_BLOCK_Y[blockIndex] : mbY + (blockIndex >= 2 ? 1 : 0);

        let offset = dest.luma(x, startY);
        let s = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) plane[offset + col] = clampSample(samples[s + col]);
            s += 8;
            offset += step;
        }
    }

    _writeIntraChroma(frame, cx, cy, blockIndex) {
        const dest = this.dest;
        const plane = blockIndex === 4 ? frame.cb : frame.cr;
        const stride = dest.chromaStride;
        const samples = this.samples;

        let offset = dest.chroma(cx, cy);
        let s = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) plane[offset + col] = clampSample(samples[s + col]);
            s += 8;
            offset += stride;
        }
    }
}

function clampSample(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value;
}

return { SliceDecoder };
});

__def("decoder.js", function (__req) {
// Decoder orchestration: walks the elementary stream and drives the layers below.
//
// This owns sequence and picture state, the frame pool, the reference slots and the display
// reorder. The slice decoder is handed a target frame and the references it needs; it never
// chooses them. Keeping that split is what stops reference management from tangling with
// pixel code, where B-frame and field-pairing bugs become very hard to localise.

const { BitReader } = __req('bitreader.js');
const { BitstreamError, UnsupportedStreamError } = __req('errors.js');
const { EXTENSION_START_CODE, EXT_PICTURE_CODING, EXT_QUANT_MATRIX, EXT_SEQUENCE, EXT_SEQUENCE_DISPLAY, GROUP_START_CODE, PICTURE_START_CODE, PICTURE_STRUCTURE_BOTTOM_FIELD, PICTURE_TYPE_B, PICTURE_TYPE_I, PICTURE_TYPE_P, SEQUENCE_END_CODE, SEQUENCE_HEADER_CODE, SLICE_START_CODE_MAX, SLICE_START_CODE_MIN, USER_DATA_START_CODE } = __req('constants.js');
const { SequenceState, parseQuantMatrixExtension, parseSequenceDisplayExtension, parseSequenceExtension, parseSequenceHeader, validateSequence } = __req('sequence.js');
const { GopState, PictureState, parseGopHeader, parsePictureCodingExtension, parsePictureHeader } = __req('picture.js');
const { FramePool } = __req('frame.js');
const { SliceDecoder } = __req('slice.js');

class Mpeg2Decoder {
    constructor(options = {}) {
        this.onFrame = options.onFrame ?? null;
        this.onSequence = options.onSequence ?? null;
        this.onError = options.onError ?? null;
        /** When false, a failed picture is reported and skipped instead of aborting. */
        this.strict = options.strict ?? false;
        this.streaming = options.streaming ?? false;
        this._pictureOpen = false;

        this.sequence = new SequenceState();
        this.picture = new PictureState();
        this.gop = new GopState();
        this.slices = new SliceDecoder();

        this.pool = null;
        this.currentFrame = null;

        // Reference slots. `older` is the forward reference for B pictures, `newer` is the
        // most recently decoded reference and the source for P prediction.
        this.olderReference = null;
        this.newerReference = null;

        // Set when a GOP is entered without a usable past reference, so the leading B
        // pictures that would predict from nothing can be dropped instead of predicted.
        this._dropLeadingB = false;

        // Field pairing state. A frame built from two field pictures is only complete, and
        // only displayable, once the second field has been decoded into it.
        this._pendingFieldFrame = null;
        this._pendingFieldParity = -1;
        this.isSecondField = false;
        this.currentParity = 0;

        this.stats = {
            pictures: 0,
            framesEmitted: 0,
            slices: 0,
            skippedPictures: 0,
            errors: [],
        };
    }

    _ensurePool() {
        if (
            !this.pool ||
            this.pool.mbWidth !== this.sequence.mbWidth ||
            this.pool.mbHeight !== this.sequence.mbHeight
        ) {
            this._releaseReferences();
            this.pool = new FramePool(this.sequence.mbWidth, this.sequence.mbHeight);
        }
    }

    _releaseReferences() {
        if (this.pool) {
            if (this.olderReference) this.pool.release(this.olderReference);
            if (this.newerReference) this.pool.release(this.newerReference);
        }
        this.olderReference = null;
        this.newerReference = null;
    }

    /**
     * @param {Uint8Array} video elementary stream
     * @param {{limit?: number}} [options] stop after this many emitted frames
     */
    decode(video, options = {}) {
        const limit = options.limit ?? Infinity;
        const flush = options.flush ?? !this.streaming;
        const reader = new BitReader(video);

        let sequenceValidated = Boolean(this.sequence && this.sequence.hasHeader && this.sequence.width > 0);

        for (;;) {
            const code = reader.nextStartCode();
            if (code < 0) break;
            const offset = Math.max(0, reader.byteOffset - 4);

            try {
                if (code === SEQUENCE_HEADER_CODE) {
                    this._pictureOpen = this._finishPicture(this._pictureOpen);
                    parseSequenceHeader(reader, this.sequence, offset);
                } else if (code === EXTENSION_START_CODE) {
                    const id = reader.read(4);
                    if (id === EXT_SEQUENCE) {
                        parseSequenceExtension(reader, this.sequence, offset);
                        // Validate EVERY sequence extension, not only the first. A stream can
                        // start inside what this decoder handles and leave it part way
                        // through: resolutionchange.mpg switches frame size at picture 33, and
                        // nothing stops a stream switching chroma format or frame size the
                        // same way. Validating once would let a later header introduce a
                        // configuration that decodes into garbage, or a frame large enough to
                        // exhaust memory, both past the guard that exists to catch them.
                        validateSequence(this.sequence, offset);
                        const resized =
                            !this.pool ||
                            this.pool.mbWidth !== this.sequence.mbWidth ||
                            this.pool.mbHeight !== this.sequence.mbHeight;
                        sequenceValidated = true;
                        this._ensurePool();
                        if (resized && this.onSequence) this.onSequence(this.sequence);
                    } else if (id === EXT_SEQUENCE_DISPLAY) {
                        parseSequenceDisplayExtension(reader, this.sequence);
                    } else if (id === EXT_QUANT_MATRIX) {
                        parseQuantMatrixExtension(reader, this.sequence);
                    } else if (id === EXT_PICTURE_CODING) {
                        parsePictureCodingExtension(reader, this.picture, offset);
                        this._beginPicture(offset);
                        this._pictureOpen = true;
                    }
                } else if (code === GROUP_START_CODE) {
                    parseGopHeader(reader, this.gop);
                    // Entering a group with no reference in hand means this is where decoding
                    // began, so the group's leading B pictures belong to a group that was
                    // never decoded and must be dropped.
                    //
                    // closed_gop is deliberately NOT consulted. It says those B pictures do
                    // not predict across the group boundary, so they could be decoded from
                    // this group's I picture alone. It does not say they belong to this
                    // group: they still DISPLAY before its I picture. A caller who started
                    // decoding here asked for this group, and emitting two frames that
                    // belong before it shifts every frame that follows.
                    //
                    // Assigned, not merely set: a group entered with a reference already in
                    // hand must CLEAR a flag armed by an earlier random access entry.
                    this._dropLeadingB = this.gop.brokenLink || !this.newerReference;
                } else if (code === PICTURE_START_CODE) {
                    this._pictureOpen = this._finishPicture(this._pictureOpen);
                    if (!sequenceValidated) {
                        throw new BitstreamError('picture before sequence header', offset);
                    }
                    parsePictureHeader(reader, this.picture, offset);
                } else if (code >= SLICE_START_CODE_MIN && code <= SLICE_START_CODE_MAX) {
                    if (!this._pictureOpen) {
                        throw new BitstreamError('slice outside a picture', offset);
                    }
                    if (this.currentFrame) {
                        this.slices.decodeSlice(
                            reader,
                            code,
                            this.sequence,
                            this.picture,
                            this.currentFrame,
                            this._references
                        );
                        this.stats.slices++;
                    }
                } else if (code === SEQUENCE_END_CODE) {
                    this._pictureOpen = this._finishPicture(this._pictureOpen);
                }
                // User data and unrecognised extensions need nothing: the next start code
                // scan steps over their payload.
            } catch (error) {
                if (error instanceof UnsupportedStreamError) throw error;
                if (this.strict) throw error;

                this.stats.errors.push({ offset, message: error.message });
                this.stats.skippedPictures++;
                if (this.onError) this.onError(error);
                this._abandonPicture();
                this._pictureOpen = false;
                if (this.stats.errors.length > 256) break;
            }

            if (this.stats.framesEmitted >= limit) break;
        }

        if (flush) {
            this._pictureOpen = this._finishPicture(this._pictureOpen);
            this.flush();
        }
        return this.stats;
    }

    get _references() {
        // A P picture predicts forward from the most recent reference. A B picture predicts
        // forward from the older one and backward from the newer.
        const isB = this.picture.codingType === PICTURE_TYPE_B;
        return {
            forward: isB ? this.olderReference : this.newerReference,
            backward: isB ? this.newerReference : null,
            // Needed only by field pictures. The second field of a frame may predict from
            // the first field of that same frame, which is not in either reference slot
            // because the frame is still being built.
            current: this.currentFrame,
            currentParity: this.currentParity,
            isSecondField: this.isSecondField,
        };
    }

    _beginPicture(offset) {
        this._ensurePool();

        const type = this.picture.codingType;
        const isField = !this.picture.isFramePicture;
        const parity =
            this.picture.pictureStructure === PICTURE_STRUCTURE_BOTTOM_FIELD ? 1 : 0;

        // A field picture that completes the frame already in progress.
        const isSecondField =
            isField && this._pendingFieldFrame !== null && this._pendingFieldParity !== parity;

        if (type === PICTURE_TYPE_B) {
            // The leading B pictures of an open group predict forward from the picture
            // before that group, which was never decoded when the group is reached by
            // seeking. Drop them: they display ahead of this group's I picture, so a player
            // that seeked here does not want them, and predicting them from whatever the
            // recycled buffer held is worse than a missing frame.
            //
            // They come AFTER the I picture in coded order while displaying BEFORE it,
            // which is precisely why this flag cannot be cleared when the I picture
            // arrives. Clearing it there leaves every leading B picture in the stream
            // throwing on its missing reference, and each one takes its whole run of slices
            // down with it. Output order survives, because a thrown picture emits nothing
            // just as a dropped one does, so the damage is thousands of spurious errors and
            // wasted work rather than wrong pixels. That is exactly the kind of fault that
            // hides until someone watches the error callback.
            // Incomplete references identify the leading B pictures exactly: they are the
            // only B pictures reached before this group's second reference picture has been
            // decoded. Decoding forward from the start of a stream never produces one.
            if (!this.olderReference || !this.newerReference) {
                if (!this._dropLeadingB) {
                    throw new BitstreamError('B picture with incomplete references', offset);
                }
                this.currentFrame = null;
                this.stats.pictures++;
                this.stats.skippedPictures++;
                return;
            }
        }
        if (type === PICTURE_TYPE_P && !this.newerReference && !isSecondField) {
            throw new BitstreamError('P picture with no reference frame', offset);
        }

        // Field pairing. Two field pictures of complementary parity share one frame
        // buffer; only when both have been decoded is there a frame to display.
        //
        // The P-without-reference check above is deliberately relaxed for a second field.
        // The very first frame of a stream may be coded as an I field followed by a P
        // field, and 7.6.3.5 constrains that P field so it can only predict from its own
        // frame's I field. It is legal, and it is the ordinary way to open an interlaced
        // stream, so rejecting it would refuse the first frame of perfectly valid content.
        if (isField) {
            if (isSecondField) {
                // Second field of the frame already in progress.
                this.currentFrame = this._pendingFieldFrame;
                this.isSecondField = true;
            } else {
                // First field, or a lost partner. A mismatched or missing second field
                // means a field was dropped; start fresh rather than emitting a half
                // decoded frame.
                if (this._pendingFieldFrame) this.pool.release(this._pendingFieldFrame);
                this.currentFrame = this.pool.acquire();
                this.currentFrame.pictureCodingType = type;
                this.currentFrame.temporalReference = this.picture.temporalReference;
                this.isSecondField = false;
            }
            this._pendingFieldFrame = this.currentFrame;
            this._pendingFieldParity = parity;
            this.currentParity = parity;
            this.stats.pictures++;
            return;
        }

        // A frame picture arriving while a field is pending means its partner never came.
        this._discardPendingField();
        this.isSecondField = false;
        this.currentParity = 0;

        this.currentFrame = this.pool.acquire();
        this.currentFrame.pictureCodingType = type;
        this.currentFrame.temporalReference = this.picture.temporalReference;
        this.stats.pictures++;
    }

    /**
     * Complete the current picture and place it in the output order.
     *
     * Output order is derived structurally: a reference picture is held back until the next
     * reference arrives, and B pictures are emitted as soon as they are decoded. It is NOT
     * derived from temporal_reference, which is modulo 1024 and resets at every GOP header.
     *
     * @returns {boolean} always false, so callers can assign it to their open flag
     */
    _finishPicture(isOpen) {
        if (!isOpen || !this.currentFrame) {
            this.currentFrame = null;
            return false;
        }

        const frame = this.currentFrame;
        this.currentFrame = null;

        // Pad after every field, not just after a complete frame: the second field of a
        // frame may reference the first field of that same frame, so the first field's
        // borders have to be usable before the second is decoded.
        frame.padBorders();

        if (!this.picture.isFramePicture && !this.isSecondField) {
            // First field of a pair. Nothing to display yet.
            return false;
        }
        this._pendingFieldFrame = null;
        this._pendingFieldParity = -1;

        if (frame.pictureCodingType === PICTURE_TYPE_B) {
            this._emit(frame);
            return false;
        }

        // A new reference arriving means the previously most recent reference is now the
        // oldest picture not yet displayed, so it is emitted here.
        //
        // Emit `newerReference`, not `olderReference`. Coded I0 P3 B1 B2 P6 must display as
        // I0 B1 B2 P3 B4 B5 P6: when P3 is decoded, I0 is what becomes displayable, and I0
        // is sitting in `newerReference` at that moment. Emitting `olderReference` instead
        // lags by one reference and reorders the whole stream, yet produces an identical
        // sequence for I+P content where display order already equals coded order, so the
        // mistake hides completely until B pictures appear.
        //
        // Emitting does not release the frame: I0 stays in the slots because B1 and B2 have
        // not been decoded yet and still predict from it.
        if (this.newerReference) this._emit(this.newerReference);
        this.olderReference = this.newerReference;
        this.newerReference = frame;

        // Both slots are populated, so the group entered by seeking is now fully anchored
        // and any later B picture short of a reference is a real fault rather than a random
        // access artefact. This is what stops the drop flag from swallowing the ordinary B
        // pictures further into the same group.
        if (this.olderReference && this.newerReference) this._dropLeadingB = false;
        return false;
    }

    _abandonPicture() {
        if (this.currentFrame) {
            // A half-decoded first field must not stay pending: its partner would decode
            // into a frame whose other field is stale, which is worse than a dropped frame
            // because it looks decoded.
            if (this._pendingFieldFrame === this.currentFrame) {
                this._pendingFieldFrame = null;
                this._pendingFieldParity = -1;
            }
            this.pool.release(this.currentFrame);
            this.currentFrame = null;
        }
    }

    /** Drop a first field whose partner never arrived. */
    _discardPendingField() {
        if (this._pendingFieldFrame) {
            this.pool.release(this._pendingFieldFrame);
            this._pendingFieldFrame = null;
            this._pendingFieldParity = -1;
            this.stats.skippedPictures++;
        }
    }

    _emit(frame) {
        this.stats.framesEmitted++;
        if (this.onFrame) {
            this.onFrame(frame);
        } else {
            this.pool.release(frame);
        }
    }

    /**
     * Drain the reference slots at end of stream.
     *
     * Without this the last one or two frames are silently lost, which is the single most
     * common "the output is a frame short" defect.
     */
    flush() {
        // An unpaired first field at end of stream is half a frame. Emitting it would show
        // one field of new content interlaced with whatever the recycled buffer held.
        this._discardPendingField();

        // Only the most recent reference is still undisplayed: the older slot was emitted
        // when this one arrived.
        if (this.newerReference) {
            this._emit(this.newerReference);
        }
        this.olderReference = null;
        this.newerReference = null;
    }
}

/** Convenience for tests and tools: decode a stream and collect frames. */
function decodeToFrames(video, options = {}) {
    const frames = [];
    const decoder = new Mpeg2Decoder({
        ...options,
        onFrame: (frame) => {
            frames.push(frame);
        },
    });
    const stats = decoder.decode(video, options);
    return { frames, stats, sequence: decoder.sequence, decoder };
}

return { Mpeg2Decoder, decodeToFrames };
});

__def("render/convert.js", function (__req) {
// YUV 4:2:0 to RGBA conversion, in plain JavaScript.
//
// With no GPU in this pass, conversion sits on the critical path alongside the decoder, so
// it is written for speed:
//
//  - The five colour terms are precomputed into lookup tables indexed by the 8-bit sample,
//    so the inner loop does adds and table reads rather than multiplies.
//  - A clamp table replaces per-channel comparisons.
//  - Output is written through a Uint32Array view, so each pixel is one store instead of
//    four byte stores.
//  - Chroma is read once per 2x2 luma quad and reused across all four pixels, and two
//    output rows are produced per pass.
//
// Two colour details that are easy to miss and both look plausible when wrong:
//
//  1. MPEG-2 samples are studio range, luma 16..235 and chroma 16..240, and must be
//     expanded to full range. Skipping that gives a washed-out picture that looks fine
//     until compared side by side.
//  2. MPEG-2 4:2:0 chroma is co-sited horizontally with luma and interstitial vertically,
//     unlike MPEG-1 which is interstitial in both. This matters when upsampling; the
//     nearest-neighbour upsampling used here sidesteps it, and a future interpolating
//     renderer must account for the half-sample horizontal offset.

/** BT.601 coefficients, the correct choice for standard definition content. */
const Y_SCALE = 255 / 219; // studio luma range 16..235 expanded to 0..255
const R_CR = 1.596;
const G_CR = -0.813;
const G_CB = -0.391;
const B_CB = 2.018;

/** Clamp table covering the full range the terms can produce, with headroom. */
const CLAMP_OFFSET = 512;
const CLAMP = (() => {
    const table = new Uint8Array(CLAMP_OFFSET * 2 + 256);
    for (let i = 0; i < table.length; i++) {
        const value = i - CLAMP_OFFSET;
        table[i] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    return table;
})();

/** Per-sample lookup tables, built once. */
const Y_TABLE = new Int32Array(256);
const R_CR_TABLE = new Int32Array(256);
const G_CR_TABLE = new Int32Array(256);
const G_CB_TABLE = new Int32Array(256);
const B_CB_TABLE = new Int32Array(256);

for (let i = 0; i < 256; i++) {
    Y_TABLE[i] = Math.round((i - 16) * Y_SCALE);
    R_CR_TABLE[i] = Math.round((i - 128) * R_CR);
    G_CR_TABLE[i] = Math.round((i - 128) * G_CR);
    G_CB_TABLE[i] = Math.round((i - 128) * G_CB);
    B_CB_TABLE[i] = Math.round((i - 128) * B_CB);
}

/** True when the platform stores multi-byte integers little-endian. */
const LITTLE_ENDIAN = (() => {
    const probe = new Uint32Array(1);
    new Uint8Array(probe.buffer)[0] = 1;
    return probe[0] === 1;
})();

/**
 * Convert a decoded frame into an RGBA buffer.
 *
 * @param {Frame} frame
 * @param {Uint8ClampedArray|Uint8Array} rgba destination, width * height * 4 bytes
 * @param {number} width cropped display width
 * @param {number} height cropped display height
 */
function frameToRgba(frame, rgba, width, height) {
    const out = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);

    const y = frame.y;
    const cb = frame.cb;
    const cr = frame.cr;
    const lumaStride = frame.lumaStride;
    const chromaStride = frame.chromaStride;

    // Two luma rows share one chroma row at 4:2:0, so rows are produced in pairs.
    const pairs = height >> 1;

    for (let row = 0; row < pairs; row++) {
        let yTop = frame.lumaOrigin + row * 2 * lumaStride;
        let yBottom = yTop + lumaStride;
        let chroma = frame.chromaOrigin + row * chromaStride;

        let outTop = row * 2 * width;
        let outBottom = outTop + width;

        for (let col = 0; col < width; col += 2) {
            // One chroma sample serves all four luma samples in the quad.
            const cbValue = cb[chroma];
            const crValue = cr[chroma];
            chroma++;

            const rTerm = R_CR_TABLE[crValue];
            const gTerm = G_CR_TABLE[crValue] + G_CB_TABLE[cbValue];
            const bTerm = B_CB_TABLE[cbValue];

            out[outTop] = pack(Y_TABLE[y[yTop]], rTerm, gTerm, bTerm);
            out[outTop + 1] = pack(Y_TABLE[y[yTop + 1]], rTerm, gTerm, bTerm);
            out[outBottom] = pack(Y_TABLE[y[yBottom]], rTerm, gTerm, bTerm);
            out[outBottom + 1] = pack(Y_TABLE[y[yBottom + 1]], rTerm, gTerm, bTerm);

            yTop += 2;
            yBottom += 2;
            outTop += 2;
            outBottom += 2;
        }
    }

    // An odd final row has no partner; convert it on its own.
    if (height & 1) {
        const row = height - 1;
        let yOffset = frame.lumaOrigin + row * lumaStride;
        let chroma = frame.chromaOrigin + (row >> 1) * chromaStride;
        let outOffset = row * width;
        for (let col = 0; col < width; col++) {
            const cbValue = cb[chroma + (col >> 1)];
            const crValue = cr[chroma + (col >> 1)];
            out[outOffset + col] = pack(
                Y_TABLE[y[yOffset + col]],
                R_CR_TABLE[crValue],
                G_CR_TABLE[crValue] + G_CB_TABLE[cbValue],
                B_CB_TABLE[cbValue]
            );
        }
    }

    return rgba;
}

function pack(luma, rTerm, gTerm, bTerm) {
    const r = CLAMP[luma + rTerm + CLAMP_OFFSET];
    const g = CLAMP[luma + gTerm + CLAMP_OFFSET];
    const b = CLAMP[luma + bTerm + CLAMP_OFFSET];
    // Alpha is always opaque. Byte order in memory must be R, G, B, A.
    return LITTLE_ENDIAN
        ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
        : (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
}

/** Exposed for tests. */
const colourTables = {
    Y_TABLE,
    R_CR_TABLE,
    G_CR_TABLE,
    G_CB_TABLE,
    B_CB_TABLE,
    LITTLE_ENDIAN,
};

return { frameToRgba, colourTables };
});

__def("live-worker.js", function (__req) {
const { demuxTransportStream } = __req('demux/transport.js');
const { Mpeg2Decoder } = __req('decoder.js');
const { frameToRgba } = __req('render/convert.js');

let decoder = null;
let currentWidth = 0;
let currentHeight = 0;
let rgbaBuffer = null;
let frameSequence = 0;
let framePromiseChain = Promise.resolve();
let streamEpoch = 0;

function resetDecoder() {
    streamEpoch++;
    const thisEpoch = streamEpoch;
    frameSequence = 0;
    framePromiseChain = Promise.resolve();
    currentWidth = 0;
    currentHeight = 0;
    rgbaBuffer = null;

    decoder = new Mpeg2Decoder({
        onFrame: (frame) => {
            const w = decoder.sequence ? decoder.sequence.width : frame.codedWidth;
            const h = decoder.sequence ? decoder.sequence.height : frame.codedHeight;
            if (!w || !h) return;

            if (w !== currentWidth || h !== currentHeight || !rgbaBuffer) {
                currentWidth = w;
                currentHeight = h;
                rgbaBuffer = new Uint8ClampedArray(w * h * 4);
            }

            frameToRgba(frame, rgbaBuffer, w, h);

            const dar = decoder.sequence && decoder.sequence.aspectRatio ? decoder.sequence.aspectRatio.name : null;
            const fps = (decoder.sequence && typeof decoder.sequence.frameRate === 'number' && decoder.sequence.frameRate > 0)
                ? decoder.sequence.frameRate
                : 29.97;
            const seq = frameSequence++;

            // Clone frame bytes immediately so synchronous decode loop does not mutate
            // this frame buffer while asynchronous createImageBitmap or postMessage is in flight.
            const frameBytes = rgbaBuffer.slice(0, w * h * 4);

            if (typeof createImageBitmap === 'function' && typeof ImageData !== 'undefined') {
                let imgData;
                let bitmapPromise = null;
                try {
                    imgData = new ImageData(frameBytes, w, h);
                    bitmapPromise = createImageBitmap(imgData);
                } catch {
                    bitmapPromise = null;
                }

                if (bitmapPromise) {
                    framePromiseChain = framePromiseChain.then(async () => {
                        if (thisEpoch !== streamEpoch) {
                            try {
                                const b = await bitmapPromise;
                                if (b && typeof b.close === 'function') b.close();
                            } catch {}
                            return;
                        }
                        try {
                            const bitmap = await bitmapPromise;
                            self.postMessage(
                                { type: 'frame', seq, bitmap, width: w, height: h, pts: frame.pts, dar, fps },
                                [bitmap]
                            );
                        } catch {
                            self.postMessage(
                                { type: 'frame-buffer', seq, buffer: frameBytes.buffer, width: w, height: h, pts: frame.pts, dar, fps },
                                [frameBytes.buffer]
                            );
                        }
                    }).catch(() => {});
                    return;
                }
            }

            // Fallback for environments without createImageBitmap or on construction error
            framePromiseChain = framePromiseChain.then(() => {
                if (thisEpoch !== streamEpoch) return;
                self.postMessage(
                    { type: 'frame-buffer', seq, buffer: frameBytes.buffer, width: w, height: h, pts: frame.pts, dar, fps },
                    [frameBytes.buffer]
                );
            }).catch(() => {});
        },
    });
}

resetDecoder();

self.onmessage = function (e) {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'decode-ts') {
        try {
            const hasSequence = Boolean(decoder && decoder.sequence && decoder.sequence.hasHeader && decoder.sequence.width > 0);
            const tsData = new Uint8Array(msg.buffer);
            const demuxResult = demuxTransportStream(tsData, { requireSequenceHeader: !hasSequence });
            if (demuxResult && demuxResult.video && demuxResult.video.length > 0) {
                if (!decoder) resetDecoder();
                decoder.decode(demuxResult.video);
            }
        } catch (err) {
            // Ignore boundary chunk errors
        }
    } else if (msg.type === 'reset') {
        resetDecoder();
    }
};

return {  };
});

__req('live-worker.js');
