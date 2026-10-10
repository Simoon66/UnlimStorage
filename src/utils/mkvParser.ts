export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface MkvAudioTrackInfo {
  index: number;
  trackNumber: number;
  name: string;
  language: string;
  codecId: string;
  channels?: number;
  sampleRate?: number;
  entryStartOffset?: number;
  entryEndOffset?: number;
  trackTypeByteOffset?: number;
  flagDefaultByteOffset?: number;
  flagEnabledByteOffset?: number;
}

export interface MkvSubtitleTrackInfo {
  index: number;
  trackNumber: number;
  name: string;
  language: string;
  codecId: string;
  vttBlobUrl?: string;
  cuesCount?: number;
  cues: SubtitleCue[];
}

export interface ParsedMediaTracks {
  isMatroska: boolean;
  containerFormat: string;
  tracksElementStart?: number;
  tracksElementEnd?: number;
  audioTracks: MkvAudioTrackInfo[];
  subtitleTracks: MkvSubtitleTrackInfo[];
}

const LANGUAGE_LABELS: Record<string, string> = {
  eng: 'English',
  en: 'English',
  jpn: 'Japanese',
  ja: 'Japanese',
  hin: 'Hindi',
  hi: 'Hindi',
  ben: 'Bangla (Bengali)',
  bn: 'Bangla (Bengali)',
  kor: 'Korean',
  ko: 'Korean',
  spa: 'Spanish',
  es: 'Spanish',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  rus: 'Russian',
  ru: 'Russian',
  chi: 'Chinese',
  zho: 'Chinese',
  ara: 'Arabic',
  ita: 'Italian',
  por: 'Portuguese',
  tur: 'Turkish',
  urd: 'Urdu',
  tam: 'Tamil',
  tel: 'Telugu',
  ind: 'Indonesian',
  und: 'Original / Default',
};

export function formatLanguageCode(code?: string): string {
  if (!code) return 'Default';
  const clean = code.toLowerCase().trim();
  return LANGUAGE_LABELS[clean] || clean.toUpperCase();
}

export function formatCodecLabel(codecId?: string): string {
  if (!codecId) return 'Stream';
  const upper = codecId.toUpperCase();
  if (upper.includes('A_AAC')) return 'AAC';
  if (upper.includes('A_EAC3')) return 'Dolby E-AC3';
  if (upper.includes('A_AC3')) return 'Dolby AC3';
  if (upper.includes('A_OPUS')) return 'Opus';
  if (upper.includes('A_VORBIS')) return 'Vorbis';
  if (upper.includes('A_FLAC')) return 'FLAC';
  if (upper.includes('A_MPEG/L3')) return 'MP3';
  if (upper.includes('A_DTS')) return 'DTS';
  if (upper.includes('A_TRUEHD')) return 'TrueHD';
  if (upper.includes('A_PCM')) return 'PCM';
  if (upper.includes('S_TEXT/UTF8')) return 'SRT / UTF-8';
  if (upper.includes('S_TEXT/ASS') || upper.includes('S_TEXT/SSA')) return 'ASS / Styled Sub';
  if (upper.includes('S_TEXT/WEBVTT')) return 'WebVTT';
  if (upper.includes('S_VOBSUB')) return 'VobSub';
  if (upper.includes('S_HDMV/PGS')) return 'PGS Blu-ray Sub';
  return codecId.replace(/^[AVS]_/, '');
}

/**
 * Reads an EBML variable-length integer (VINT) ID or Size from a Uint8Array.
 */
function readEbmlVint(
  buf: Uint8Array,
  offset: number,
  stripMarker: boolean
): { value: number; length: number; isUnknownSize?: boolean } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || offset + length > buf.length) return null;

  let value = stripMarker ? first & (mask - 1) : first;
  let allOnes = stripMarker && value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[offset + i];
    if (b !== 0xff) allOnes = false;
    value = value * 256 + b;
  }
  return { value, length, isUnknownSize: allOnes };
}

function readEbmlUint(buf: Uint8Array, offset: number, size: number): number {
  let val = 0;
  const end = Math.min(buf.length, offset + size);
  for (let i = offset; i < end; i++) {
    val = val * 256 + buf[i];
  }
  return val;
}

function readEbmlFloat(buf: Uint8Array, offset: number, size: number): number {
  if (offset + size > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset + offset, size);
  if (size === 4) return view.getFloat32(0, false);
  if (size === 8) return view.getFloat64(0, false);
  return 0;
}

function readEbmlString(buf: Uint8Array, offset: number, size: number): string {
  const slice = buf.subarray(offset, Math.min(buf.length, offset + size));
  let endIdx = slice.length;
  while (endIdx > 0 && slice[endIdx - 1] === 0) {
    endIdx--;
  }
  try {
    return new TextDecoder('utf-8').decode(slice.subarray(0, endIdx)).trim();
  } catch {
    return '';
  }
}

interface RawMkvTrackEntry {
  trackNumber: number;
  trackType: number; // 1 = video, 2 = audio, 17 (0x11) = subtitle
  name: string;
  language: string;
  codecId: string;
  channels?: number;
  sampleRate?: number;
  entryStartOffset: number;
  entryEndOffset: number;
  trackTypeByteOffset?: number;
  flagDefaultByteOffset?: number;
  flagEnabledByteOffset?: number;
}

function parseTrackEntry(
  buf: Uint8Array,
  entryHeaderStart: number,
  payloadStart: number,
  end: number
): RawMkvTrackEntry | null {
  let pos = payloadStart;
  let trackNumber = 0;
  let trackType = 0;
  let name = '';
  let language = 'und';
  let codecId = '';
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let trackTypeByteOffset: number | undefined;
  let flagDefaultByteOffset: number | undefined;
  let flagEnabledByteOffset: number | undefined;

  while (pos < end - 1) {
    const idObj = readEbmlVint(buf, pos, false);
    if (!idObj) break;
    pos += idObj.length;

    const sizeObj = readEbmlVint(buf, pos, true);
    if (!sizeObj) break;
    pos += sizeObj.length;

    const elEnd = Math.min(end, pos + sizeObj.value);
    const id = idObj.value;

    if (id === 0xd7) {
      // TrackNumber
      trackNumber = readEbmlUint(buf, pos, sizeObj.value);
    } else if (id === 0x83) {
      // TrackType (1=video, 2=audio, 0x11=subtitle)
      trackType = readEbmlUint(buf, pos, sizeObj.value);
      if (sizeObj.value === 1) {
        trackTypeByteOffset = pos;
      }
    } else if (id === 0x88) {
      // FlagDefault
      if (sizeObj.value === 1) {
        flagDefaultByteOffset = pos;
      }
    } else if (id === 0xb9) {
      // FlagEnabled
      if (sizeObj.value === 1) {
        flagEnabledByteOffset = pos;
      }
    } else if (id === 0x536e) {
      // Name
      name = readEbmlString(buf, pos, sizeObj.value);
    } else if (id === 0x22b59c || id === 0x22b59d) {
      // Language or LanguageIETF
      const lang = readEbmlString(buf, pos, sizeObj.value);
      if (lang) language = lang;
    } else if (id === 0x86) {
      // CodecID
      codecId = readEbmlString(buf, pos, sizeObj.value);
    } else if (id === 0xe1) {
      // Audio master element -> scan inside for Channels (0x9F) and SamplingFrequency (0xB5)
      let audioPos = pos;
      while (audioPos < elEnd - 1) {
        const aId = readEbmlVint(buf, audioPos, false);
        if (!aId) break;
        audioPos += aId.length;
        const aSize = readEbmlVint(buf, audioPos, true);
        if (!aSize) break;
        audioPos += aSize.length;
        if (aId.value === 0x9f) {
          channels = readEbmlUint(buf, audioPos, aSize.value);
        } else if (aId.value === 0xb5) {
          sampleRate = Math.round(readEbmlFloat(buf, audioPos, aSize.value));
        }
        audioPos += aSize.value;
      }
    }

    pos = elEnd;
  }

  if (!trackType) return null;
  return {
    trackNumber: trackNumber || 1,
    trackType,
    name,
    language,
    codecId,
    channels,
    sampleRate,
    entryStartOffset: entryHeaderStart,
    entryEndOffset: end,
    trackTypeByteOffset,
    flagDefaultByteOffset,
    flagEnabledByteOffset,
  };
}

export function formatVttTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    '.' +
    String(millis).padStart(3, '0')
  );
}

function parseTimestampToMs(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const [sStr, msStr = '0'] = parts[2].split('.');
    const s = parseInt(sStr, 10) || 0;
    const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10) || 0;
    return h * 3600000 + m * 60000 + s * 1000 + ms;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const [sStr, msStr = '0'] = parts[1].split('.');
    const s = parseInt(sStr, 10) || 0;
    const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10) || 0;
    return m * 60000 + s * 1000 + ms;
  }
  return 0;
}

/**
 * Cleans a raw MKV subtitle block payload (handles both S_TEXT/ASS 8-comma prefix and S_TEXT/UTF8).
 */
export function cleanMkvSubtitleBlockText(rawSub: string, codecId = ''): string {
  let text = rawSub.trim();
  if (!text) return '';

  const isAss =
    codecId.toUpperCase().includes('ASS') ||
    codecId.toUpperCase().includes('SSA') ||
    /^\d+,\d+,/.test(text);

  if (isAss) {
    // Matroska ASS block format: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const parts = text.split(',');
    if (parts.length >= 9) {
      text = parts.slice(8).join(',');
    }
  }

  return text
    .replace(/\{[^}]*\}/g, '') // Strip ASS override tags like {\pos(192,220)\an8}
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]+>/g, '') // Strip HTML tags if desired or keep clean text
    .trim();
}

export function buildVttBlobUrlFromCues(cues: SubtitleCue[]): string {
  const lines: string[] = ['WEBVTT', ''];
  for (const c of cues) {
    lines.push(`${formatVttTimestamp(c.startMs)} --> ${formatVttTimestamp(c.endMs)}`);
    lines.push(c.text);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Converts SRT, ASS/SSA, or WebVTT subtitle text into both a parsed SubtitleCue[] array
 * and a valid WebVTT Blob URL for live playback.
 */
export function parseExternalSubtitleText(
  rawText: string,
  fileName = ''
): { cues: SubtitleCue[]; vttBlobUrl: string } {
  const lower = fileName.toLowerCase();
  const cues: SubtitleCue[] = [];

  if (lower.endsWith('.ass') || lower.endsWith('.ssa') || rawText.includes('[Events]')) {
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('Dialogue:')) {
        const parts = line.slice('Dialogue:'.length).split(',');
        if (parts.length >= 10) {
          const startMs = parseTimestampToMs(parts[1]);
          const endMs = Math.max(startMs + 500, parseTimestampToMs(parts[2]));
          const textRaw = parts
            .slice(9)
            .join(',')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim();
          if (textRaw) {
            cues.push({ startMs, endMs, text: textRaw });
          }
        }
      }
    }
  } else {
    // Parse SRT or WebVTT blocks
    const blocks = rawText.replace(/\r\n/g, '\n').split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const arrowIdx = lines.findIndex((l) => l.includes('-->'));
      if (arrowIdx !== -1) {
        const timeLine = lines[arrowIdx];
        const [startRaw, endRawWithSettings] = timeLine.split('-->');
        const endRaw = (endRawWithSettings || '').trim().split(/\s+/)[0];
        const startMs = parseTimestampToMs(startRaw);
        const endMs = Math.max(startMs + 500, parseTimestampToMs(endRaw));
        const text = lines
          .slice(arrowIdx + 1)
          .join('\n')
          .replace(/\{[^}]*\}/g, '')
          .trim();
        if (text) {
          cues.push({ startMs, endMs, text });
        }
      }
    }
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  const vttBlobUrl = buildVttBlobUrlFromCues(cues);
  return { cues, vttBlobUrl };
}

export function convertSubtitleTextToVttBlobUrl(rawText: string, fileName = ''): string {
  return parseExternalSubtitleText(rawText, fileName).vttBlobUrl;
}

/**
 * Extracts subtitle cues from Matroska Clusters (0x1F43B675) inside a binary buffer slice.
 * Supports both SimpleBlock (0xA3) and BlockGroup (0xA0 -> Block 0xA1 + BlockDuration 0x9B).
 */
export function extractMatroskaSubtitleCuesFromBuffer(
  buf: Uint8Array,
  subtitleTracks: MkvSubtitleTrackInfo[],
  timecodeScaleNs = 1000000
): void {
  if (subtitleTracks.length === 0) return;

  const subByTrackNum = new Map<number, MkvSubtitleTrackInfo>();
  for (const s of subtitleTracks) {
    subByTrackNum.set(s.trackNumber, s);
  }

  const scaleToMs = timecodeScaleNs / 1000000;

  for (let i = 0; i < buf.length - 8; i++) {
    // Look for Cluster ID: 0x1F43B675
    if (
      buf[i] === 0x1f &&
      buf[i + 1] === 0x43 &&
      buf[i + 2] === 0xb6 &&
      buf[i + 3] === 0x75
    ) {
      const cSize = readEbmlVint(buf, i + 4, true);
      if (!cSize) continue;
      let cPos = i + 4 + cSize.length;
      const cEnd = cSize.isUnknownSize
        ? buf.length
        : Math.min(buf.length, cPos + cSize.value);

      let clusterTimecode = 0;

      while (cPos < cEnd - 2) {
        // If unknown cluster size and we hit another Cluster or Segment top-level ID, break
        if (
          cPos + 4 <= buf.length &&
          buf[cPos] === 0x1f &&
          buf[cPos + 1] === 0x43 &&
          buf[cPos + 2] === 0xb6 &&
          buf[cPos + 3] === 0x75
        ) {
          break;
        }

        const elId = readEbmlVint(buf, cPos, false);
        if (!elId) break;
        const idLen = elId.length;
        const elSize = readEbmlVint(buf, cPos + idLen, true);
        if (!elSize) break;
        const payloadStart = cPos + idLen + elSize.length;
        const elEnd = Math.min(cEnd, payloadStart + elSize.value);

        if (elId.value === 0xe7) {
          // Cluster Timestamp (0xE7)
          clusterTimecode = readEbmlUint(buf, payloadStart, elSize.value);
        } else if (elId.value === 0xa3 && elSize.value > 4) {
          // SimpleBlock (0xA3)
          const trackNumVint = readEbmlVint(buf, payloadStart, true);
          if (trackNumVint && subByTrackNum.has(trackNumVint.value)) {
            const subTrack = subByTrackNum.get(trackNumVint.value)!;
            const relTimeOffset = payloadStart + trackNumVint.length;
            if (relTimeOffset + 3 <= elEnd) {
              let relTime = (buf[relTimeOffset] << 8) | buf[relTimeOffset + 1];
              if (relTime & 0x8000) relTime -= 0x10000; // signed 16-bit
              const textOffset = relTimeOffset + 3;
              const rawSub = readEbmlString(buf, textOffset, elEnd - textOffset);
              const cleanSub = cleanMkvSubtitleBlockText(rawSub, subTrack.codecId);
              if (cleanSub) {
                const startMs = Math.max(0, Math.round((clusterTimecode + relTime) * scaleToMs));
                const endMs = startMs + 3800;
                subTrack.cues.push({ startMs, endMs, text: cleanSub });
              }
            }
          }
        } else if (elId.value === 0xa0 && elSize.value > 4) {
          // BlockGroup (0xA0) -> standard Matroska container for Subtitle Blocks (0xA1) + BlockDuration (0x9B)
          let bgPos = payloadStart;
          let matchedSubTrack: MkvSubtitleTrackInfo | null = null;
          let blockRelTime = 0;
          let blockDurationRaw = 0;
          let extractedText = '';

          while (bgPos < elEnd - 2) {
            const bgId = readEbmlVint(buf, bgPos, false);
            if (!bgId) break;
            bgPos += bgId.length;
            const bgSize = readEbmlVint(buf, bgPos, true);
            if (!bgSize) break;
            bgPos += bgSize.length;
            const bgElEnd = Math.min(elEnd, bgPos + bgSize.value);

            if (bgId.value === 0xa1 && bgSize.value > 4) {
              // Block (0xA1)
              const trackNumVint = readEbmlVint(buf, bgPos, true);
              if (trackNumVint && subByTrackNum.has(trackNumVint.value)) {
                matchedSubTrack = subByTrackNum.get(trackNumVint.value)!;
                const relTimeOffset = bgPos + trackNumVint.length;
                if (relTimeOffset + 3 <= bgElEnd) {
                  blockRelTime = (buf[relTimeOffset] << 8) | buf[relTimeOffset + 1];
                  if (blockRelTime & 0x8000) blockRelTime -= 0x10000;
                  const textOffset = relTimeOffset + 3;
                  const rawSub = readEbmlString(buf, textOffset, bgElEnd - textOffset);
                  extractedText = cleanMkvSubtitleBlockText(rawSub, matchedSubTrack.codecId);
                }
              }
            } else if (bgId.value === 0x9b) {
              // BlockDuration (0x9B)
              blockDurationRaw = readEbmlUint(buf, bgPos, bgSize.value);
            }

            bgPos = bgElEnd;
          }

          if (matchedSubTrack && extractedText) {
            const startMs = Math.max(
              0,
              Math.round((clusterTimecode + blockRelTime) * scaleToMs)
            );
            const durationMs =
              blockDurationRaw > 0
                ? Math.max(400, Math.round(blockDurationRaw * scaleToMs))
                : 3500;
            matchedSubTrack.cues.push({
              startMs,
              endMs: startMs + durationMs,
              text: extractedText,
            });
          }
        }

        if (elEnd <= cPos) break;
        cPos = elEnd;
      }

      if (cEnd > i + 4) {
        i = cEnd - 1;
      }
    }
  }
}

/**
 * Parses Matroska (.mkv / .webm) EBML header bytes to discover all embedded
 * Audio Tracks and Subtitle Tracks inside the container, plus initial subtitle cues.
 */
export function parseMatroskaTracksFromBuffer(buf: Uint8Array): ParsedMediaTracks {
  const isEbml =
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3;

  if (!isEbml) {
    return {
      isMatroska: false,
      containerFormat: 'Standard Video Stream',
      audioTracks: [],
      subtitleTracks: [],
    };
  }

  // Check for TimecodeScale (0x2AD7B1) in Segment Info, default 1,000,000 ns (1 ms)
  let timecodeScaleNs = 1000000;
  const headerScanLimit = Math.min(buf.length - 8, 512 * 1024);
  for (let i = 0; i < headerScanLimit; i++) {
    if (buf[i] === 0x2a && buf[i + 1] === 0xd7 && buf[i + 2] === 0xb1) {
      const sz = readEbmlVint(buf, i + 3, true);
      if (sz && sz.value >= 1 && sz.value <= 8) {
        const val = readEbmlUint(buf, i + 3 + sz.length, sz.value);
        if (val > 0) timecodeScaleNs = val;
        break;
      }
    }
  }

  const rawTracks: RawMkvTrackEntry[] = [];
  let tracksElementStart: number | undefined;
  let tracksElementEnd: number | undefined;

  // Scan buffer for the Matroska Tracks master element (ID: 0x1654AE6B)
  for (let i = 0; i < buf.length - 8; i++) {
    if (
      buf[i] === 0x16 &&
      buf[i + 1] === 0x54 &&
      buf[i + 2] === 0xae &&
      buf[i + 3] === 0x6b
    ) {
      const sizeObj = readEbmlVint(buf, i + 4, true);
      if (!sizeObj) continue;
      const tracksStart = i + 4 + sizeObj.length;
      const tracksEnd = Math.min(buf.length, tracksStart + sizeObj.value);

      let pos = tracksStart;
      while (pos < tracksEnd - 2) {
        const entryStart = pos;
        const elId = readEbmlVint(buf, pos, false);
        if (!elId) break;
        pos += elId.length;
        const elSize = readEbmlVint(buf, pos, true);
        if (!elSize) break;
        pos += elSize.length;

        const entryEnd = Math.min(tracksEnd, pos + elSize.value);
        if (elId.value === 0xae) {
          // TrackEntry
          const parsed = parseTrackEntry(buf, entryStart, pos, entryEnd);
          if (parsed) {
            rawTracks.push(parsed);
          }
        }
        pos = entryEnd;
      }
      if (rawTracks.length > 0) {
        tracksElementStart = tracksStart;
        tracksElementEnd = tracksEnd;
        break;
      }
    }
  }

  const audioTracks: MkvAudioTrackInfo[] = [];
  const subtitleTracks: MkvSubtitleTrackInfo[] = [];

  rawTracks.forEach((t) => {
    if (t.trackType === 2) {
      const idx = audioTracks.length;
      const langLabel = formatLanguageCode(t.language);
      const codecLabel = formatCodecLabel(t.codecId);
      const chLabel =
        t.channels === 6
          ? '5.1ch'
          : t.channels === 8
          ? '7.1ch'
          : t.channels === 2
          ? 'Stereo'
          : t.channels === 1
          ? 'Mono'
          : t.channels
          ? `${t.channels}ch`
          : '';
      const displayName =
        t.name ||
        `${langLabel} Audio ${chLabel ? `(${codecLabel} ${chLabel})` : `(${codecLabel})`}`;
      audioTracks.push({
        index: idx,
        trackNumber: t.trackNumber,
        name: displayName,
        language: t.language || 'und',
        codecId: t.codecId || 'A_AAC',
        channels: t.channels,
        sampleRate: t.sampleRate,
        entryStartOffset: t.entryStartOffset,
        entryEndOffset: t.entryEndOffset,
        trackTypeByteOffset: t.trackTypeByteOffset,
        flagDefaultByteOffset: t.flagDefaultByteOffset,
        flagEnabledByteOffset: t.flagEnabledByteOffset,
      });
    } else if (t.trackType === 0x11) {
      const idx = subtitleTracks.length;
      const langLabel = formatLanguageCode(t.language);
      const codecLabel = formatCodecLabel(t.codecId);
      const displayName = t.name || `${langLabel} Subtitles (${codecLabel})`;
      subtitleTracks.push({
        index: idx,
        trackNumber: t.trackNumber,
        name: displayName,
        language: t.language || 'und',
        codecId: t.codecId || 'S_TEXT/UTF8',
        cues: [],
      });
    }
  });

  // Extract subtitle cues from any Clusters present in the initial buffer
  if (subtitleTracks.length > 0) {
    extractMatroskaSubtitleCuesFromBuffer(buf, subtitleTracks, timecodeScaleNs);
    for (const sub of subtitleTracks) {
      if (sub.cues.length > 0) {
        sub.cues.sort((a, b) => a.startMs - b.startMs);
        sub.cuesCount = sub.cues.length;
        sub.vttBlobUrl = buildVttBlobUrlFromCues(sub.cues);
      }
    }
  }

  return {
    isMatroska: true,
    containerFormat: 'Matroska (.MKV) Multi-Track Container',
    tracksElementStart,
    tracksElementEnd,
    audioTracks,
    subtitleTracks,
  };
}

/**
 * Progressive background scanner that reads through a local MKV Blob in slices
 * to extract all embedded subtitle cues across the entire movie without blocking playback.
 */
export async function scanFullBlobForMatroskaSubtitles(params: {
  blob: Blob;
  initialSubtitles: MkvSubtitleTrackInfo[];
  alreadyScannedBytes: number;
  signal?: AbortSignal;
  onCuesUpdated: (updatedTracks: MkvSubtitleTrackInfo[]) => void;
}): Promise<void> {
  const { blob, initialSubtitles, alreadyScannedBytes, signal, onCuesUpdated } = params;
  if (initialSubtitles.length === 0 || blob.size <= alreadyScannedBytes) return;

  // Clone subtitle tracks with a deduplicated cue map keyed by `${startMs}_${text}`
  const workingTracks: MkvSubtitleTrackInfo[] = initialSubtitles.map((t) => ({
    ...t,
    cues: [...t.cues],
  }));
  const seenKeysPerTrack = new Map<number, Set<string>>();
  for (const wt of workingTracks) {
    const set = new Set<string>();
    wt.cues.forEach((c) => set.add(`${c.startMs}_${c.text}`));
    seenKeysPerTrack.set(wt.trackNumber, set);
  }

  const SLICE_SIZE = 12 * 1024 * 1024; // 12 MB windows
  const OVERLAP = 64 * 1024; // 64 KB overlap to catch Clusters across slice boundaries
  let offset = Math.max(0, alreadyScannedBytes - OVERLAP);

  // Scan up to 350 MB of MKV clusters in background slices
  const maxBytesToScan = Math.min(blob.size, 350 * 1024 * 1024);

  while (offset < maxBytesToScan) {
    if (signal?.aborted) return;

    const end = Math.min(blob.size, offset + SLICE_SIZE);
    const sliceBuf = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    if (signal?.aborted) return;

    const tempTracks: MkvSubtitleTrackInfo[] = workingTracks.map((t) => ({
      ...t,
      cues: [],
    }));

    extractMatroskaSubtitleCuesFromBuffer(sliceBuf, tempTracks);

    let addedAny = false;
    for (let i = 0; i < workingTracks.length; i++) {
      const target = workingTracks[i];
      const extracted = tempTracks[i].cues;
      const seen = seenKeysPerTrack.get(target.trackNumber)!;
      for (const cue of extracted) {
        const key = `${cue.startMs}_${cue.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          target.cues.push(cue);
          addedAny = true;
        }
      }
    }

    if (addedAny) {
      const snapshot = workingTracks.map((t) => {
        t.cues.sort((a, b) => a.startMs - b.startMs);
        return {
          ...t,
          cues: [...t.cues],
          cuesCount: t.cues.length,
          vttBlobUrl: buildVttBlobUrlFromCues(t.cues),
        };
      });
      onCuesUpdated(snapshot);
    }

    if (end >= maxBytesToScan) break;
    offset = end - OVERLAP;
    // Yield to UI thread between slices
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Zero-Copy Matroska Binary Header Track Remuxer:
 * Creates a lightweight Blob view of the MKV file where only the user-selected
 * Audio Track (`selectedAudioIndex`) has TrackType = 0x02 (Audio) and FlagDefault = 1,
 * while other audio TrackEntries have their TrackType byte patched to 0xFE (inactive)
 * in the first 256 KB header slice.
 *
 * This forces Chromium/Firefox/Edge's native Matroska demuxer to decode and play
 * the exact selected audio stream from the MKV Clusters without re-encoding or copying the file!
 */
export async function createRemuxedMkvBlobForAudioTrack(
  rawBlob: Blob,
  audioTracks: MkvAudioTrackInfo[],
  selectedAudioIndex: number,
  containerMime: string = 'video/webm'
): Promise<Blob> {
  if (audioTracks.length <= 1 || selectedAudioIndex < 0 || selectedAudioIndex >= audioTracks.length) {
    return new Blob([rawBlob], { type: containerMime });
  }

  // Determine how many header bytes we need to patch (all TrackEntry headers live in the first 256 KB)
  let maxPatchOffset = 64 * 1024;
  for (const t of audioTracks) {
    if (t.entryEndOffset && t.entryEndOffset + 1024 > maxPatchOffset) {
      maxPatchOffset = t.entryEndOffset + 1024;
    }
  }
  const patchSliceLen = Math.min(rawBlob.size, Math.max(maxPatchOffset, 128 * 1024));
  const headerBuf = new Uint8Array(await rawBlob.slice(0, patchSliceLen).arrayBuffer());

  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    const isSelected = i === selectedAudioIndex;

    if (
      typeof track.trackTypeByteOffset === 'number' &&
      track.trackTypeByteOffset < headerBuf.length
    ) {
      // 0x02 = Matroska Audio Track; 0xFE = Ignored/Inactive Track so demuxer binds only the selected Audio Track
      headerBuf[track.trackTypeByteOffset] = isSelected ? 0x02 : 0xfe;
    }

    if (
      typeof track.flagDefaultByteOffset === 'number' &&
      track.flagDefaultByteOffset < headerBuf.length
    ) {
      headerBuf[track.flagDefaultByteOffset] = isSelected ? 0x01 : 0x00;
    }

    if (
      typeof track.flagEnabledByteOffset === 'number' &&
      track.flagEnabledByteOffset < headerBuf.length
    ) {
      headerBuf[track.flagEnabledByteOffset] = isSelected ? 0x01 : 0x00;
    }
  }

  // Combine patched 128 KB header with zero-copy slice of the rest of the 285 MB+ MKV file
  if (patchSliceLen < rawBlob.size) {
    return new Blob([headerBuf, rawBlob.slice(patchSliceLen)], { type: containerMime });
  }
  return new Blob([headerBuf], { type: containerMime });
}
