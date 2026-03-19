function stringToUtf8Base64(text) {
    if (typeof TextEncoder === 'undefined') {
        return btoa(unescape(encodeURIComponent(text)));
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binary = '';

    for (let i = 0; i < bytes.length; i += 0x8000) {
        const chunk = bytes.subarray(i, i + 0x8000);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function utf8Base64ToString(base64Text) {
    const binary = atob(base64Text);

    if (typeof TextDecoder === 'undefined') {
        return decodeURIComponent(escape(binary));
    }

    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoder = new TextDecoder('utf-8', { fatal: true });

    return decoder.decode(bytes);
}

export function encodePipelineState(state) {
    return stringToUtf8Base64(JSON.stringify(state));
}

export function decodePipelineState(encodedState) {
    return JSON.parse(utf8Base64ToString(encodedState));
}
