/**
 * Stateless robots.txt Parser and Matcher conforming to RFC 9309 (Robots Exclusion Protocol).
 */
export class RobotsTxt {
  constructor(text) {
    this.rules = []; // Array of { agents: [], allows: [], disallows: [] }
    this.parse(text || '');
  }

  parse(text) {
    const lines = text.split(/\r?\n/);
    let currentGroup = null;

    for (const line of lines) {
      // Remove comments and trim whitespace
      const hashIndex = line.indexOf('#');
      const cleanLine = (hashIndex !== -1 ? line.slice(0, hashIndex) : line).trim();
      
      if (!cleanLine) {
        continue;
      }

      const colonIndex = cleanLine.indexOf(':');
      if (colonIndex === -1) continue;

      const key = cleanLine.slice(0, colonIndex).trim().toLowerCase();
      const value = cleanLine.slice(colonIndex + 1).trim();

      if (key === 'user-agent') {
        const agent = value.toLowerCase();
        // Start a new group if we already have directives in the current group
        if (!currentGroup || currentGroup.allows.length > 0 || currentGroup.disallows.length > 0) {
          currentGroup = { agents: [], allows: [], disallows: [] };
          this.rules.push(currentGroup);
        }
        currentGroup.agents.push(agent);
      } else if (key === 'disallow' || key === 'allow') {
        if (!currentGroup) {
          // Directives without User-agent must be ignored per RFC 9309
          continue;
        }
        if (value) {
          currentGroup[key === 'allow' ? 'allows' : 'disallows'].push(value);
        }
      }
    }
  }

  /**
   * Checks if a path (pathname + query) is allowed for a user agent.
   * @param {string} path - URL path + query string (e.g., '/index.html?ref=logo')
   * @param {string} userAgent - The crawler's user agent name (e.g., 'clearload')
   * @returns {boolean}
   */
  isAllowed(path, userAgent = 'clearload') {
    const targetAgent = userAgent.toLowerCase();
    
    // Find matching group. RFC 9309: specific user-agent match has priority over '*'.
    let matchedGroup = null;
    let specificMatch = false;

    for (const group of this.rules) {
      if (group.agents.includes(targetAgent) || group.agents.includes('clearloadbot')) {
        matchedGroup = group;
        specificMatch = true;
        break;
      }
    }

    if (!specificMatch) {
      for (const group of this.rules) {
        if (group.agents.includes('*')) {
          matchedGroup = group;
          break;
        }
      }
    }

    if (!matchedGroup) {
      return true; // Allowed by default if no matching group exists
    }

    // Decode URL path for matching (standard URL matching is case-sensitive)
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch (e) {
      // Fallback to raw path
    }

    let longestMatchLength = -1;
    let allowed = true;

    const testRule = (rulePattern, isAllow) => {
      // Escape regex chars except '*'
      let escaped = rulePattern.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
      // Replace '*' with '.*' wildcard
      escaped = escaped.replace(/\*/g, '.*');
      
      const isAnchorEnd = escaped.endsWith('\\$');
      if (isAnchorEnd) {
        escaped = escaped.slice(0, -2) + '$';
      }

      const regex = new RegExp('^' + escaped);
      
      // Match against both decoded path and raw path
      const matchRaw = regex.test(path);
      const matchDecoded = regex.test(decodedPath);

      if (matchRaw || matchDecoded) {
        const patternLength = rulePattern.length;
        if (patternLength > longestMatchLength) {
          longestMatchLength = patternLength;
          allowed = isAllow;
        } else if (patternLength === longestMatchLength && isAllow) {
          // RFC 9309: Allow wins on equal length tie
          allowed = true;
        }
      }
    };

    for (const rule of matchedGroup.allows) {
      testRule(rule, true);
    }
    for (const rule of matchedGroup.disallows) {
      testRule(rule, false);
    }

    return allowed;
  }
}
