export function parseCommentedJSON(source) {
    return JSON.parse(source.replace(
        /("(?:[^"\\]|\\.)*")|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
        (_match, string) => string || ''
    ));
}
