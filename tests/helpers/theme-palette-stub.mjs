export function installThemePaletteStub(windowLike) {
  const palette = { get: name => `stub:${name}`, refresh() {} };
  windowLike.ThemePalette = palette;
  return palette;
}
