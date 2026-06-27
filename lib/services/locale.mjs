export function getLocaleCandidates(rawLocale) {
  const locale = String(rawLocale || '').trim().replace(/_/g, '-');
  if (!locale) {
    return ['us'];
  }

  const parts = locale.split('-').filter(Boolean);
  const candidates = [];
  const push = (value) => {
    const code = String(value || '').trim().toLowerCase();
    if (code && !candidates.includes(code)) {
      candidates.push(code);
    }
  };

  push(parts.join('-'));

  if (parts.length >= 2) {
    push(`${parts[1]}-${parts[0]}`);
  }

  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) {
      push(part);
      break;
    }
  }

  push(parts[0]);
  push('us');
  return candidates;
}

export function getLocaleCode(rawLocale) {
  return getLocaleCandidates(rawLocale)[0] || 'us';
}

export function filePrefixMatches(fileName, prefix) {
  const file = String(fileName || '').toLowerCase();
  const stem = String(prefix || '').toLowerCase();
  const fileStem = file.replace(/\.[^.]+$/, '');
  return fileStem === stem || fileStem.startsWith(`${stem}-`) || fileStem.startsWith(`${stem}+`);
}

export function selectLocaleFiles(fileNames, prefix, rawLocale, extension) {
  const files = Array.isArray(fileNames) ? fileNames.slice() : [];
  const normalizedExtension = String(extension || '').trim().toLowerCase();
  const candidates = getLocaleCandidates(rawLocale);
  const matchingFiles = (candidate) => {
    const lowerCandidate = String(candidate || '').trim().toLowerCase();
    const exactName = normalizedExtension ? `${prefix}-${lowerCandidate}${normalizedExtension}` : `${prefix}-${lowerCandidate}`;
    const exact = [];
    const variants = [];

    for (const file of files) {
      const lower = String(file || '').toLowerCase();
      if (normalizedExtension && !lower.endsWith(normalizedExtension)) continue;
      if (!filePrefixMatches(lower, `${prefix}-${lowerCandidate}`)) continue;
      if (lower === exactName) {
        exact.push(file);
      } else {
        variants.push(file);
      }
    }

    exact.sort((a, b) => a.localeCompare(b));
    variants.sort((a, b) => a.localeCompare(b));
    return exact.concat(variants);
  };

  for (const candidate of candidates) {
    const matches = matchingFiles(candidate);
    if (matches.length) {
      return matches;
    }
  }

  return [];
}
