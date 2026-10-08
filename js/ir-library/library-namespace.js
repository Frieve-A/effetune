export function requireLibraryNamespace(namespace = 'ir-library') {
  if (namespace !== 'ir-library' && namespace !== 'sfz-library') {
    throw new TypeError('Invalid audio library namespace.');
  }
  return namespace;
}
