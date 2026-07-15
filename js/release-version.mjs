const SEMVER_PATTERN = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function stripReleaseLabel(value) {
    return String(value ?? '')
        .trim()
        .replace(/^version\s+/i, '')
        .replace(/^v(?=\d)/i, '');
}

export function parseSemVer(value) {
    const normalizedInput = stripReleaseLabel(value);
    const match = SEMVER_PATTERN.exec(normalizedInput);
    if (!match) return null;

    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3] ?? 0);
    if (![major, minor, patch].every(Number.isSafeInteger)) return null;

    const prerelease = match[4] ? match[4].split('.') : [];
    return Object.freeze({
        major,
        minor,
        patch,
        prerelease: Object.freeze(prerelease),
        version: `${major}.${minor}.${patch}${prerelease.length ? `-${prerelease.join('.')}` : ''}`
    });
}

export function normalizeSemVer(value) {
    return parseSemVer(value)?.version ?? null;
}

function comparePrerelease(left, right) {
    if (left.length === 0 || right.length === 0) {
        if (left.length === right.length) return 0;
        return left.length === 0 ? 1 : -1;
    }

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index];
        const rightPart = right[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);
        if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return leftPart < rightPart ? -1 : 1;
    }
    return 0;
}

export function compareSemVer(leftValue, rightValue) {
    const left = parseSemVer(leftValue);
    const right = parseSemVer(rightValue);
    if (!left || !right) throw new TypeError('Both values must be valid semantic versions');

    for (const field of ['major', 'minor', 'patch']) {
        if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
    }
    return comparePrerelease(left.prerelease, right.prerelease);
}

export function normalizeReleaseVersion(release) {
    return normalizeSemVer(release?.tag_name) || normalizeSemVer(release?.name);
}

export function isNewerVersion(targetVersion, currentVersion) {
    try {
        return compareSemVer(targetVersion, currentVersion) > 0;
    } catch (_) {
        return false;
    }
}
