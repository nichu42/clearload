import net from 'net';

const FQDN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
const LOCALHOST_REGEX = /^localhost$/;
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

const IPV4_PRIVATE_RANGES = [
  { base: '0.0.0.0',         prefix: 8  },
  { base: '10.0.0.0',        prefix: 8  },
  { base: '100.64.0.0',      prefix: 10 },
  { base: '127.0.0.0',       prefix: 8  },
  { base: '169.254.0.0',     prefix: 16 },
  { base: '172.16.0.0',      prefix: 12 },
  { base: '192.0.0.0',       prefix: 24 },
  { base: '192.0.2.0',       prefix: 24 },
  { base: '192.168.0.0',     prefix: 16 },
  { base: '198.18.0.0',      prefix: 15 },
  { base: '198.51.100.0',    prefix: 24 },
  { base: '203.0.113.0',     prefix: 24 },
  { base: '224.0.0.0',       prefix: 4  },
  { base: '240.0.0.0',       prefix: 4  },
  { base: '255.255.255.255', prefix: 32 }
];

const IPV6_PRIVATE_RANGES = [
  { base: '::',     prefix: 128 },
  { base: '::1',    prefix: 128 },
  { base: 'fc00::', prefix: 7   },
  { base: 'fe80::', prefix: 10  },
  { base: 'ff00::', prefix: 8   }
];

const IPV4_MAPPED_IPV6_PREFIX = 96;

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv4InRange(ip, base, prefix) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

function expandIPv6(ip) {
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    const filler = new Array(missing).fill('0');
    const full = [...leftParts, ...filler, ...rightParts];
    if (full.length !== 8) return null;
    return full.map(p => p.padStart(4, '0')).join(':');
  }
  const parts = ip.split(':');
  if (parts.length !== 8) return null;
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
  }
  return parts.map(p => p.padStart(4, '0')).join(':');
}

function normalizeIPv6(ip) {
  const m = ip.match(/^(.*?):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (!m) return ip;
  const v4Parts = m[2].split('.').map(Number);
  if (v4Parts.length !== 4 || v4Parts.some(n => isNaN(n) || n < 0 || n > 255)) return ip;
  const high = ((v4Parts[0] << 8) | v4Parts[1]).toString(16).padStart(4, '0');
  const low = ((v4Parts[2] << 8) | v4Parts[3]).toString(16).padStart(4, '0');
  return m[1] + ':' + high + ':' + low;
}

function isIPv6InRange(ip, base, prefix) {
  const fullIp = expandIPv6(normalizeIPv6(ip));
  const fullBase = expandIPv6(normalizeIPv6(base));
  if (!fullIp || !fullBase) return false;
  const ipParts = fullIp.split(':').map(p => parseInt(p, 16));
  const baseParts = fullBase.split(':').map(p => parseInt(p, 16));
  const bits = prefix;
  for (let i = 0; i < 8; i++) {
    const remaining = bits - i * 16;
    if (remaining <= 0) return true;
    if (remaining >= 16) {
      if (ipParts[i] !== baseParts[i]) return false;
    } else {
      const mask = (0xffff << (16 - remaining)) & 0xffff;
      if ((ipParts[i] & mask) !== (baseParts[i] & mask)) return false;
      return true;
    }
  }
  return true;
}

function isMappedIPv4(ip) {
  let v4Part = null;
  let v6Part;

  const m1 = ip.match(/^(.*?):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m1) {
    const v4Parts = m1[2].split('.').map(Number);
    if (v4Parts.length === 4 && v4Parts.every(n => n >= 0 && n <= 255)) {
      v4Part = m1[2];
      v6Part = m1[1];
    } else {
      return null;
    }
  } else {
    const m2 = ip.match(/^(.*?):([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/);
    if (!m2) return null;
    const high = parseInt(m2[2], 16);
    const low = parseInt(m2[3], 16);
    v4Part = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    v6Part = m2[1];
  }

  let v6Groups;
  if (v6Part.includes('::')) {
    const [left, right] = v6Part.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = 6 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    v6Groups = [...leftParts, ...new Array(missing).fill('0'), ...rightParts];
  } else {
    v6Groups = v6Part.split(':');
  }

  if (v6Groups.length !== 6) return null;
  for (const g of v6Groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
  }

  const nums = v6Groups.map(g => parseInt(g, 16));
  for (let i = 0; i < 5; i++) {
    if (nums[i] !== 0) return null;
  }
  if (nums[5] !== 0xffff) return null;

  return v4Part;
}

export function isPrivateIP(ip) {
  if (!ip || typeof ip !== 'string') return false;

  const bare = ip.replace(/^\[|\]$/g, '');

  const type = net.isIP(bare);
  if (type === 4) {
    for (const r of IPV4_PRIVATE_RANGES) {
      if (isIPv4InRange(bare, r.base, r.prefix)) return true;
    }
    return false;
  }
  if (type === 6) {
    if (isIPv6InRange(bare, '::ffff:0:0', IPV4_MAPPED_IPV6_PREFIX)) {
      const mapped = isMappedIPv4(bare);
      if (mapped) {
        for (const r of IPV4_PRIVATE_RANGES) {
          if (isIPv4InRange(mapped, r.base, r.prefix)) return true;
        }
      }
    }
    for (const r of IPV6_PRIVATE_RANGES) {
      if (isIPv6InRange(bare, r.base, r.prefix)) return true;
    }
    return false;
  }
  return false;
}

export function validateAndNormalizeUrl(input) {
  if (input === null || input === undefined) {
    return { ok: false, category: 'empty', error: 'Please enter a URL to audit (e.g., yourwebsite.com or yourwebsite.com/blog).' };
  }

  const raw = String(input).trim();
  if (raw === '') {
    return { ok: false, category: 'empty', error: 'Please enter a URL to audit (e.g., yourwebsite.com or yourwebsite.com/blog).' };
  }

  if (/[\x00-\x1f\x7f]/.test(raw)) {
    return { ok: false, category: 'control_chars', error: 'The URL contains invalid control characters. Please remove any newlines, tabs, or non-printable characters.' };
  }

  let parsed;
  try {
    let candidate = raw;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        candidate = raw;
      } else {
        candidate = 'https://' + raw;
      }
    }
    const portMatch = raw.match(/:\/\/[^/?#]+:(\d+)/);
    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (port < 1 || port > 65535) {
        return { ok: false, category: 'bad_port', error: 'The URL contains an invalid port number. Ports must be between 1 and 65535.' };
      }
    }
    parsed = new URL(candidate);
  } catch (e) {
    return { ok: false, category: 'invalid_url', error: 'The URL could not be parsed. Please verify the format (e.g., yourwebsite.com/path).' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, category: 'bad_protocol', error: 'Only HTTP and HTTPS URLs are supported. Schemes like file://, javascript:, and data: are not permitted for security reasons.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, category: 'userinfo', error: 'URLs with embedded credentials (https://user:pass@…) are not allowed. Use the Basic Auth fields in the Advanced panel below instead.' };
  }

  if (parsed.port !== '' && (parsed.port < 1 || parsed.port > 65535)) {
    return { ok: false, category: 'bad_port', error: 'The URL contains an invalid port number. Ports must be between 1 and 65535.' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { ok: false, category: 'bad_hostname', error: 'The URL is missing a hostname. Use a public domain name (e.g., yourwebsite.com).' };
  }

  const isLocalhost = LOCALHOST_REGEX.test(hostname);
  const isIPv4 = IPV4_REGEX.test(hostname) && net.isIP(hostname) === 4;
  const isIPv6 = net.isIP(hostname) === 6;
  const isFqdn = FQDN_REGEX.test(hostname);

  if (!isFqdn && !isLocalhost && !isIPv4 && !isIPv6) {
    return { ok: false, category: 'bad_hostname', error: 'The URL\'s hostname is not valid. Use a public domain name (e.g., yourwebsite.com), a localhost address, or a numeric IP.' };
  }

  const canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;

  return {
    ok: true,
    url: canonical,
    host: parsed.host,
    hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    origin: `${parsed.protocol}//${parsed.host}`,
    protocol: parsed.protocol.replace(':', '')
  };
}
