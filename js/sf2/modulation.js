import { sf2Error } from './parser.js';

export const SF2_MODULATION_SECTION_VERSION = 2;
// Must match the route limit in dsp/plugins/others/sfz/bank.h.
export const SF2_MAX_ROUTES = 4194304;
const HEADER_WORDS = 10, DIRECTORY_WORDS = 4, ROUTE_WORDS = 10, GENERATOR_WORDS = 61;

export function packSf2Modulation(compiled) {
  const regionCount = compiled.regions.length;
  const routeCount = compiled.regions.reduce((count, region) => count + region.modulators.length, 0);
  if (routeCount > SF2_MAX_ROUTES) throw sf2Error('Too many SoundFont modulation routes');
  const directoryOffset = HEADER_WORDS, routeOffset = directoryOffset + regionCount * DIRECTORY_WORDS;
  const generatorOffset = routeOffset + routeCount * ROUTE_WORDS;
  const buffer = new ArrayBuffer((generatorOffset + regionCount * GENERATOR_WORDS) * 4);
  const integers = new Uint32Array(buffer), values = new Float32Array(buffer);
  integers.set([0x31525453, SF2_MODULATION_SECTION_VERSION, regionCount, routeCount, 0,
    directoryOffset, routeOffset, generatorOffset, generatorOffset, regionCount * GENERATOR_WORDS]);
  let first = 0;
  for (const [regionIndex, region] of compiled.regions.entries()) {
    const routes = region.modulators, incoming = new Uint32Array(routes.length);
    if (routes.length > 65536) throw sf2Error('Too many modulation routes in a SoundFont zone');
    for (const route of routes) if (route.link >= 0) {
      if (route.link >= routes.length) throw sf2Error('Invalid modulation link');
      incoming[route.link]++;
    }
    const order = [];
    for (let index = 0; index < routes.length; index++) if (!incoming[index]) order.push(index);
    for (let at = 0; at < order.length; at++) {
      const target = routes[order[at]].link;
      if (target >= 0 && --incoming[target] === 0) order.push(target);
    }
    if (order.length !== routes.length) throw sf2Error('Circular compiled modulation');
    const indices = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    integers.set([first, routes.length, regionIndex * GENERATOR_WORDS, GENERATOR_WORDS], directoryOffset + regionIndex * DIRECTORY_WORDS);
    if (region.generators.length !== GENERATOR_WORDS || region.generators.some(value => !Number.isFinite(Math.fround(value)))) {
      throw sf2Error('Invalid compiled generator vector');
    }
    values.set(region.generators, generatorOffset + regionIndex * GENERATOR_WORDS);
    for (const index of order) {
      const route = routes[index], offset = routeOffset + first * ROUTE_WORDS;
      integers[offset] = route.link < 0 ? 0x10000 | route.destination : 0x20000 | indices.get(route.link);
      integers[offset + 1] = (route.source & 255) === 127 ? 0x20000 | indices.get(index) : route.source;
      integers[offset + 2] = route.amountSource;
      values[offset + 3] = route.amount;
      integers[offset + 8] = (route.source & 255) === 127 ? route.source : 0;
      integers[offset + 9] = route.transform;
      first++;
    }
  }
  return new Uint8Array(buffer);
}
