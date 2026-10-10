export interface MkvAudioTrackInfo {
  index: number;
  trackNumber: number;
  name: string;
  language: string;
  codecId: string;
  channels?: number;
}

export interface MkvSubtitleTrackInfo {
  index: number;
  trackNumber: number;
  name: string;
  language: string;
  codecId: string;
  vttBlobUrl?: string;
  cuesCount?: number;
}

export interface ParsedMediaTracks {
  isMatroska: boolean;
  containerFormat: string;
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
  if (upper.includes('S_TEXT/UTF8')) return 'SRT / UTF-8';
  if (upper.includes('S_TEXT/ASS') || upper.includes('S_TEXT/SSA')) return 'ASS / Styled Sub';
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
): { value: number; length: number } | null {
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
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[offset + i];
  }
  return { value, length };
}

function readEbmlUint(buf: Uint8Array, offset: number, size: number): number {
  let val = 0;
  const end = Math.min(buf.length, offset + size);
  for (let i = offset; i < end; i++) {
    val = val * 256 + buf[i];
  }
  return val;
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
}

function parseTrackEntry(buf: Uint8Array, start: number, end: number): RawMkvTrackEntry | null {
  let pos = start;
  let trackNumber = 0;
  let trackType = 0;
  let name = '';
  let language = 'und';
  let codecId = '';
  let channels: number | undefined;

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
      // Audio master element -> scan inside for Channels (0x9F)
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
  };
}

function formatVttTimestamp(ms: number): string {
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

/**
 * Converts SRT or ASS/SSA subtitle text into a valid WebVTT Blob URL for <track> playback.
 */
export function convertSubtitleTextToVttBlobUrl(rawText: string, fileName = ''): string {
  const lower = fileName.toLowerCase();
  let vttLines: string[] = ['WEBVTT', ''];

  if (lower.endsWith('.ass') || lower.endsWith('.ssa') || rawText.includes('[Events]')) {
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('Dialogue:')) {
        const parts = line.slice('Dialogue:'.length).split(',');
        if (parts.length >= 10) {
          const startRaw = parts[1].trim();
          const endRaw = parts[2].trim();
          const textRaw = parts
            .slice(9)
            .join(',')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim();
          const normalizeAssTime = (t: string) => {
            const p = t.split(':');
            if (p.length === 3) {
              const h = p[0].padStart(2, '0');
              const m = p[1].padStart(2, '0');
              const [s, cs = '00'] = p[2].split('.');
              return `${h}:${m}:${s.padStart(2, '0')}.${cs.padEnd(3, '0').slice(0, 3)}`;
            }
            return '00:00:00.000';
          };
          if (textRaw) {
            vttLines.push(`${normalizeAssTime(startRaw)} --> ${normalizeAssTime(endRaw)}`);
            vttLines.push(textRaw);
            vttLines.push('');
          }
        }
      }
    }
  } else if (rawText.trim().startsWith('WEBVTT')) {
    vttLines = [rawText];
  } else {
    // Standard SRT -> WebVTT conversion (replace comma milliseconds with dot)
    const srtConverted = rawText
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    vttLines.push(srtConverted);
  }

  const blob = new Blob([vttLines.join('\n')], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Parses Matroska (.mkv / .webm) EBML header bytes to discover all embedded
 * Audio Tracks and Subtitle Tracks inside the container.
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

  const rawTracks: RawMkvTrackEntry[] = [];
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
        const elId = readEbmlVint(buf, pos, false);
        if (!elId) break;
        pos += elId.length;
        const elSize = readEbmlVint(buf, pos, true);
        if (!elSize) break;
        pos += elSize.length;

        const entryEnd = Math.min(tracksEnd, pos + elSize.value);
        if (elId.value === 0xae) {
          // TrackEntry
          const parsed = parseTrackEntry(buf, pos, entryEnd);
          if (parsed) {
            rawTracks.push(parsed);
          }
        }
        pos = entryEnd;
      }
      if (rawTracks.length > 0) break;
    }
  }

  const audioTracks: MkvAudioTrackInfo[] = [];
  const subtitleTracks: MkvSubtitleTrackInfo[] = [];
  const subtitleTrackMap = new Map<number, string[]>();

  rawTracks.forEach((t) => {
    if (t.trackType === 2) {
      const idx = audioTracks.length;
      const langLabel = formatLanguageCode(t.language);
      const codecLabel = formatCodecLabel(t.codecId);
      const chLabel = t.channels === 6 ? '5.1ch' : t.channels === 2 ? 'Stereo' : t.channels ? `${t.channels}ch` : '';
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
      });
      subtitleTrackMap.set(t.trackNumber, ['WEBVTT', '']);
    }
  });

  // Also scan Clusters (0x1F43B675) in the buffer for embedded UTF-8/ASS subtitle SimpleBlocks (0xA3) or Blocks (0xA1)
  if (subtitleTrackMap.size > 0) {
    let currentClusterTimecode = 0;
    for (let i = 0; i < buf.length - 6; i++) {
      // Cluster ID: 0x1F43B675
      if (
        buf[i] === 0x1f &&
        buf[i + 1] === 0x43 &&
        buf[i + 2] === 0xb6 &&
        buf[i + 3] === 0x75
      ) {
        const cSize = readEbmlVint(buf, i + 4, true);
        if (!cSize) continue;
        let cPos = i + 4 + cSize.length;
        const cEnd = Math.min(buf.length, cPos + cSize.value);

        while (cPos < cEnd - 2) {
          const elId = readEbmlVint(buf, cPos, false);
          if (!elId) break;
          cPos += elId.length;
          const elSize = readEbmlVint(buf, cPos, true);
          if (!elSize) break;
          cPos += elSize.length;
          const elEnd = Math.min(cEnd, cPos + elSize.value);

          if (elId.value === 0xe7) {
            // Cluster Timestamp
            currentClusterTimecode = readEbmlUint(buf, cPos, elSize.value);
          } else if (elId.value === 0xa3 && elSize.value > 4) {
            // SimpleBlock
            const trackNumVint = readEbmlVint(buf, cPos, true);
            if (trackNumVint && subtitleTrackMap.has(trackNumVint.value)) {
              const relTimeOffset = cPos + trackNumVint.length;
              if (relTimeOffset + 3 < elEnd) {
                const relTime = (buf[relTimeOffset] << 8) | buf[relTimeOffset + 1];
                const payloadStart = relTimeOffset + 3;
                const rawSub = readEbmlString(buf, payloadStart, elEnd - payloadStart);
                const cleanSub = rawSub
                  .replace(/\{[^}]*\}/g, '')
                  .replace(/\\N/g, '\n')
                  .trim();
                if (cleanSub && cleanSub.length >= 1) {
                  const startMs = Math.max(0, currentClusterTimecode + relTime);
                  const endMs = startMs + 3800;
                  const cueLines = subtitleTrackMap.get(trackNumVint.value)!;
                  cueLines.push(
                    `${formatVttTimestamp(startMs)} --> ${formatVttTimestamp(endMs)}`
                  );
                  cueLines.push(cleanSub);
                  cueLines.push('');
                }
              }
            }
          }
          cPos = elEnd;
        }
        i = cEnd - 1;
      }
    }

    for (const sub of subtitleTracks) {
      const cueLines = subtitleTrackMap.get(sub.trackNumber);
      if (cueLines && cueLines.length > 2) {
        const vttBlob = new Blob([cueLines.join('\n')], { type: 'text/vtt' });
        sub.vttBlobUrl = URL.createObjectURL(vttBlob);
        sub.cuesCount = Math.floor((cueLines.length - 2) / 3);
      }
    }
  }

  return {
    isMatroska: true,
    containerFormat: 'Matroska (.MKV) Multi-Track Container',
    audioTracks,
    subtitleTracks,
  };
}
