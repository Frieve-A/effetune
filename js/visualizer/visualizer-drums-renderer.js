// A fixed, procedurally modeled acoustic kit. Geometry is uploaded once; only the
// camera, material colors and five detection envelopes change between frames.
const TAU = Math.PI * 2;
const normalize = v => {
    const length = Math.hypot(...v) || 1;
    return v.map(value => value / length);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const add = (a, b, scale = 1) => a.map((value, index) => value + b[index] * scale);
const rgb = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '')
    ? [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255) : fallback;

// Materials: lacquer, bronze, chrome, coated head, rubber, contact shadow.
function buildKit() {
    const vertices = [];
    const vertex = (p, n, uv, material, lane) => vertices.push(...p, ...n, ...uv, material, lane);
    const triangle = (a, b, c, material, lane) => {
        for (const v of [a, b, c]) vertex(v.p, v.n, v.uv, material, lane);
    };
    // A lathe also gives rims, tension rods and cymbals their real curved profiles.
    function lathe(center, axis, profile, material, lane = -1, segments = 64, smooth = false) {
        const up = normalize(axis), right = normalize(cross(Math.abs(up[1]) > .9 ? [0, 0, 1] : [0, 1, 0], up));
        const forward = cross(up, right);
        const point = (ringIndex, segment, dr, dy) => {
            const ring = profile[ringIndex];
            if (smooth) {
                const before = profile[Math.max(0, ringIndex - 1)], after = profile[Math.min(profile.length - 1, ringIndex + 1)];
                dr = after[0] - before[0]; dy = after[1] - before[1];
            }
            const angle = segment / segments * TAU;
            const radial = add(right.map(v => v * Math.cos(angle)), forward, Math.sin(angle));
            return { p: add(add(center, up, ring[1]), radial, ring[0]),
                n: normalize(add(radial.map(v => v * dy), up, -dr)), uv: [segment / segments, ring[1]] };
        };
        for (let ring = 0; ring < profile.length - 1; ring++) {
            const a = profile[ring], b = profile[ring + 1], dr = b[0] - a[0], dy = b[1] - a[1];
            for (let segment = 0; segment < segments; segment++) {
                const p = point(ring, segment, dr, dy), q = point(ring, segment + 1, dr, dy);
                const r = point(ring + 1, segment, dr, dy), s = point(ring + 1, segment + 1, dr, dy);
                triangle(p, q, r, material, lane); triangle(q, s, r, material, lane);
            }
        }
    }
    function rod(a, b, radius = .018, material = 2) {
        const axis = b.map((v, i) => v - a[i]), length = Math.hypot(...axis);
        lathe(a, axis, [[0, 0], [radius * .8, 0], [radius, .008], [radius, length - .008], [radius * .8, length], [0, length]], material, -1, 12);
    }
    function ring(center, axis, radius, thickness, width, material = 2, lane = -1) {
        lathe(center, axis, [[radius - thickness, -width / 2], [radius, -width / 2],
            [radius + .008, -width / 2 + .008], [radius + .008, width / 2 - .008],
            [radius, width / 2], [radius - thickness, width / 2]], material, lane, radius > .2 ? 96 : 24);
    }
    function box(center, size, material, lane = -1) {
        for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
            const u = (axis + 1) % 3, v = (axis + 2) % 3, n = [0, 0, 0]; n[axis] = sign;
            const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
                const p = center.slice(); p[axis] += sign * size[axis] / 2;
                p[u] += x * size[u] / 2; p[v] += y * size[v] / 2;
                return { p, n, uv: [(x + 1) / 2, (y + 1) / 2] };
            });
            triangle(points[0], points[1], points[2], material, lane);
            triangle(points[0], points[2], points[3], material, lane);
        }
    }
    function foot(p) {
        lathe(p, [0, 1, 0], [[0, 0], [.058, 0], [.068, .025], [.047, .09], [.024, .12], [0, .12]], 4, -1, 16);
    }
    function stand(x, z, height, spread = .42, hiHat = false) {
        // Leave the hi-hat's pull-rod coupling and chain exposed below the tube.
        rod([x, hiHat ? .34 : .15, z], [x, height, z], .021);
        rod([x, hiHat ? .38 : .22, z], [x, height * .55, z], .029);
        for (const y of [hiHat ? .4 : .25, height * .55]) {
            ring([x, y, z], [0, 1, 0], .041, .014, .07, 2);
            rod([x - .075, y, z], [x + .07, y, z], .012);
            box([x + .075, y, z], [.05, .02, .045], 4);
        }
        for (let i = 0; i < 3; i++) {
            const angle = i * TAU / 3 + .3, end = [x + Math.cos(angle) * spread, .04, z + Math.sin(angle) * spread];
            const top = [x, .44, z];
            const braceJoint = top.map((value, axis) => value + (end[axis] - value) * .8);
            rod(top, end, .02);
            rod([x, hiHat ? .34 : .18, z], braceJoint, .011);
            foot([end[0], 0, end[2]]);
        }
    }
    function drum(center, axis, radius, depth, lane, lugs = 8) {
        const up = normalize(axis), side = normalize(cross(Math.abs(up[1]) > .9 ? [0, 0, 1] : [0, 1, 0], up));
        const front = cross(up, side);
        const local = (radial, y, angle) => add(add(add(center, up, y), side, Math.cos(angle) * radial), front, Math.sin(angle) * radial);
        lathe(center, up, [[radius - .018, -depth / 2], [radius, -depth / 2 + .025],
            [radius, depth / 2 - .025], [radius - .018, depth / 2]], 0, lane, 96);
        for (const sign of [-1, 1]) {
            const end = add(center, up, sign * depth / 2);
            ring(end, up, radius + .018, .025, .05, 2, lane);
            // Slightly recessed heads retain a distinct bearing edge under grazing light.
            lathe(add(end, up, -sign * .013), up.map(v => v * sign), [[radius - .016, 0], [0, .002]], 3, lane, 96);
            ring(add(end, up, -sign * .035), up, radius + .004, .018, .016, 2);
        }
        for (let i = 0; i < lugs; i++) {
            const angle = i * TAU / lugs;
            for (const sign of [-1, 1]) {
                const p = local(radius + .025, sign * depth * .25, angle);
                lathe(p, up, [[0, -.055], [.028, -.055], [.034, -.035], [.034, .035], [.028, .055], [0, .055]], 2, -1, 12);
                rod(local(radius + .04, sign * depth * .26, angle), local(radius + .04, sign * (depth / 2 + .04), angle), .009);
                lathe(local(radius + .04, sign * (depth / 2 + .036), angle), up, [[.018, -.008], [.018, .009]], 2, -1, 6);
            }
        }
        // A small brass badge breaks up the uninterrupted lacquer surface.
        lathe(local(radius + .003, 0, 0), side, [[.032, 0], [.032, .008], [0, .008]], 1, -1, 24);
    }
    function cymbal(center, axis, radius, lane, inverted = false) {
        const profile = [[0, .075], [.035, .075], [.07, .07], [.115, .052], [.16, .021],
            [.22, .009], [radius * .65, -.009], [radius * .88, -.025], [radius, -.036],
            [radius, -.043], [radius * .88, -.033], [radius * .65, -.017], [.22, .001],
            [.16, .013], [.115, .044], [.07, .062], [.035, .067], [0, .067]];
        lathe(center, axis, inverted ? profile.map(([r, y]) => [r, -y]) : profile, 1, lane, 128, true);
        lathe(add(center, normalize(axis), .075), axis, [[0, 0], [.043, 0], [.043, .027], [0, .027]], 4, -1, 24);
        rod(add(center, axis, .09), add(center, axis, .17), .009);
        rod(add(add(center, axis, .125), [.035, 0, 0]), add(add(center, axis, .125), [-.035, 0, 0]), .008);
    }
    function pedal(x, z, yaw, kick = false) {
        // Build in the pedal's frame: +Z points from the drive toward the heel.
        // Rotate the complete mechanism together so its joints remain connected.
        const first = vertices.length;
        box([0, .027, .27], [.21, .045, .65], 4);
        box([0, .056, .565], [.19, .018, .09], 2);
        rod([-.095, .07, .56], [.095, .07, .56], .012);
        const boardStart = vertices.length, pitch = Math.atan2(.12, .5), c = Math.cos(pitch), s = Math.sin(pitch);
        box([0, .13, .31], [.165, .018, .515], 2);
        box([0, .144, .31], [.141, .01, .47], 4);
        for (let i = 0; i < 6; i++) box([0, .153, .12 + i * .045], [.14, .008, .012], 2);
        // The heel hinge stays low while the chain holds the toe of the board up.
        for (let i = boardStart; i < vertices.length; i += 10) {
            const y = vertices[i + 1] - .13, z = vertices[i + 2] - .31;
            vertices[i + 1] = .13 + y * c - z * s; vertices[i + 2] = .31 + y * s + z * c;
            const ny = vertices[i + 4], nz = vertices[i + 5];
            vertices[i + 4] = ny * c - nz * s; vertices[i + 5] = ny * s + nz * c;
        }
        box([0, .19, .065], [.06, .02, .035], 2);
        const chain = [[0, .19, .065]];
        if (kick) {
            for (const side of [-1, 1]) rod([side * .11, .04, 0], [side * .11, .32, 0], .018);
            rod([-.12, .32, 0], [.12, .32, 0], .018);
            lathe([0, .32, 0], [1, 0, 0], [[0, -.022], [.06, -.022], [.06, .022], [0, .022]], 4, -1, 32);
            ring([0, .32, 0], [1, 0, 0], .026, .01, .05, 2);
            // The drum-side tangent gives a downward footboard pull the rotation
            // that moves the beater toward the head (-Z), not toward the player.
            for (let i = 1; i <= 6; i++) chain.push([0, .19 + .078 * i / 6, .065 - .104 * i / 6]);
            const tangentAngle = Math.PI + Math.atan2(.8, .6);
            for (let i = 1; i <= 8; i++) {
                const angle = tangentAngle + (Math.PI / 2 - tangentAngle) * i / 8;
                chain.push([0, .32 + .065 * Math.sin(angle), .065 * Math.cos(angle)]);
            }
            const rest = 25 * Math.PI / 180, holder = [.055, .32, 0];
            const head = [.055, .32 + .39 * Math.cos(rest), .39 * Math.sin(rest)];
            lathe(holder, [1, 0, 0], [[0, -.021], [.033, -.021], [.033, .021], [0, .021]], 2, -1, 20);
            rod(holder, head, .009);
            // The beater remains in its spring-return position, away from the head.
            lathe(head, [0, Math.sin(rest), -Math.cos(rest)], [[0, -.025], [.052, -.025], [.052, .027], [0, .027]], 4, -1, 32);
            box([0, .052, -.09], [.12, .022, .18], 2);
            box([0, .072, -.17], [.1, .02, .045], 4);
        } else {
            // Hi-hat drive pulls the stand's central rod, without a kick-style cam.
            for (let i = 1; i <= 6; i++) chain.push([0, .19 + .13 * i / 6, .065 * (1 - i / 6)]);
            rod([0, .32, 0], [0, .43, 0], .012);
            ring([0, .32, 0], [0, 1, 0], .024, .009, .026, 2);
        }
        for (let i = 0; i < chain.length; i++) {
            const p = chain[i];
            rod(add(p, [-.02, 0, 0]), add(p, [.02, 0, 0]), .005);
            if (i) for (const side of [-1, 1]) {
                rod(add(chain[i - 1], [side * .015, 0, 0]), add(p, [side * .015, 0, 0]), .005, 4);
            }
        }
        const angle = yaw * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
        for (let i = first; i < vertices.length; i += 10) {
            const px = vertices[i], pz = vertices[i + 2], nx = vertices[i + 3], nz = vertices[i + 5];
            vertices[i] = x + px * cosine + pz * sine; vertices[i + 2] = z - px * sine + pz * cosine;
            vertices[i + 3] = nx * cosine + nz * sine; vertices[i + 5] = -nx * sine + nz * cosine;
        }
    }
    const floor = [[-2.3, 0, -1.5], [2.3, 0, -1.5], [2.3, 0, 1.7], [-2.3, 0, 1.7]]
        .map(p => ({ p, n: [0, 1, 0], uv: [0, 0] }));
    triangle(floor[0], floor[1], floor[2], 5, -1); triangle(floor[0], floor[2], floor[3], 5, -1);
    // The player's side faces +Z. Tom follows the four primary detection lanes.
    drum([.18, .65, -.1], [0, 0, 1], .62, .68, 0, 10);
    drum([-.65, 1.02, .62], [0, 1, .06], .43, .25, 1, 10);
    drum([-.36, 1.61, -.23], [0, .98, .2], .36, .4, 4, 8);
    stand(-.65, .62, .83, .36);
    for (const sign of [-1, 1]) {
        rod([.18 + sign * .5, .5, -.22], [.18 + sign * .71, .06, .01], .025);
        foot([.18 + sign * .71, 0, .01]);
    }
    rod([.18, 1.18, -.18], [.18, 1.52, -.18], .028);
    rod([.18, 1.52, -.18], [-.35, 1.52, -.23], .023);
    pedal(.18, .41, -8, true);
    stand(-1.33, .44, 1.58, .39, true);
    cymbal([-1.33, 1.51, .44], [0, 1, 0], .48, 2, true);
    cymbal([-1.33, 1.58, .44], [0, 1, 0], .48, 2);
    rod([-1.33, 1.68, .44], [-1.33, 1.9, .44], .008);
    pedal(-1.33, .44, 12);
    stand(1.25, -.13, 1.78, .47);
    rod([1.25, 1.78, -.13], [.98, 2.0, -.18], .019);
    cymbal([.98, 2.0, -.18], [-.12, .98, .11], .68, 3);
    return new Float32Array(vertices);
}

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in float aMaterial;
layout(location=4) in float aLane;
uniform mat4 uMatrix;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUV;
flat out int vMaterial;
flat out int vLane;
void main() {
    vPosition=aPosition; vNormal=aNormal; vUV=aUV;
    vMaterial=int(aMaterial+.5); vLane=int(aLane);
    gl_Position=uMatrix*vec4(aPosition,1.);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUV;
flat in int vMaterial;
flat in int vLane;
uniform vec3 uEye;
uniform vec3 uColors[4];
uniform vec3 uGlow;
uniform float uLevels[5];
uniform bool uEmission;
uniform sampler2D uShadow;
uniform mat4 uShadowMatrix;
out vec4 outColor;
float visibility() {
    vec3 p=(uShadowMatrix*vec4(vPosition,1.)).xyz*.5+.5;
    if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.)))) return 1.;
    float light=0.;
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
        float depth=texture(uShadow,p.xy+vec2(float(x),float(y))*2./1024.).r;
        light+=p.z-.0012<=depth? 1./9.:0.;
    }
    return light;
}
float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p) {
    vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
// Broad studio softboxes reflected in metal and lacquer, without image assets.
vec3 environment(vec3 r, float roughness) {
    float key=pow(max(0.,dot(r,normalize(vec3(-.7,1.1,1.5)))),mix(120.,5.,roughness));
    float rim=pow(max(0.,dot(r,normalize(vec3(1.3,.8,-.8)))),mix(160.,8.,roughness));
    float strip=pow(max(0.,1.-abs(r.x*.8+r.z*.6)),mix(180.,15.,roughness))*smoothstep(-.2,.5,r.y);
    float box=exp(-pow(abs((r.x+.32)/(roughness*.5+.21)),4.))*smoothstep(-.8,-.1,r.z);
    float edge=exp(-pow(abs((r.x-.75)/(roughness*.4+.1)),4.));
    return vec3(.018,.024,.035)+vec3(.23,.27,.34)*max(0.,r.y)+vec3(3.8,3.65,3.35)*key+
        vec3(2.6,2.9,3.3)*rim+vec3(2.15)*strip+vec3(2.8,2.8,2.7)*box+vec3(1.8,2.,2.3)*edge;
}
void main() {
    if(vMaterial==5) {
        vec2 p=vPosition.xz;
        float shadow=.25*exp(-dot((p-vec2(.18,-.1))*vec2(1.7,2.),(p-vec2(.18,-.1))*vec2(1.7,2.)));
        shadow+=.15*exp(-dot((p-vec2(-.65,.62))*2.8,(p-vec2(-.65,.62))*2.8));
        shadow+=.15*exp(-dot((p-vec2(-1.33,.44))*3.,(p-vec2(-1.33,.44))*3.));
        shadow+=.12*exp(-dot((p-vec2(1.25,-.13))*2.8,(p-vec2(1.25,-.13))*2.8));
        outColor=uEmission?vec4(0.):vec4(0.,0.,0.,shadow); return;
    }
    float level=vLane<0?0.:uLevels[vLane];
    float surface=vMaterial==3?1.:vMaterial==1?.9:vMaterial==0?.28:.1;
    if(uEmission) { outColor=vec4(uGlow*level*surface,level*surface); return; }
    vec3 n=normalize(vNormal), v=normalize(uEye-vPosition);
    if(dot(n,v)<0.) n=-n;
    vec3 base=vMaterial<4?pow(uColors[vMaterial],vec3(2.2)):vec3(.015);
    float roughness=.23,metal=0.,coat=.12;
    if(vMaterial==0) {
        float grain=noise(vec3(vUV.x*16.,vUV.y*48.,2.));
        float ribbon=sin(vUV.y*220.+grain*8.+sin(vUV.x*31.)*2.);
        base*=.53+.5*grain+.12*ribbon;
        roughness=.2; coat=.55;
    } else if(vMaterial==1) {
        float radius=length(dFdx(vPosition));
        float rings=sin(length(vPosition.xz-vec2(vPosition.x<-.7?-1.33:.98,vPosition.x<-.7?.44:-.18))*950.);
        float hammer=noise(vPosition*90.);
        base*=.86+.14*hammer+.045*rings/(1.+radius*80.);
        roughness=.25+.08*hammer; metal=.9; coat=.2;
    } else if(vMaterial==2) { metal=1.; roughness=.105; coat=.3; }
    else if(vMaterial==3) {
        base*=.86+.08*noise(vPosition*210.)+.08*noise(vPosition*32.); roughness=.72; coat=.025;
    } else { roughness=.8; coat=.01; }
    vec3 key=normalize(vec3(-3.,6.,4.)), fill=normalize(vec3(4.,3.,-2.));
    float visible=visibility();
    float diffuse=.27+.82*max(0.,dot(n,key))*visible+.3*max(0.,dot(n,fill));
    vec3 reflected=environment(reflect(-v,n),roughness);
    vec3 f0=mix(vec3(.04),base,metal), fresnel=f0+(1.-f0)*pow(1.-max(0.,dot(n,v)),5.);
    vec3 lit=base*diffuse*(1.-metal*.85)+reflected*(fresnel+coat*.08);
    float spec=pow(max(0.,dot(n,normalize(key+v))),mix(180.,12.,roughness));
    lit+=spec*mix(vec3(.5),base,metal)*(1.-roughness)*visible;
    // A little grounding occlusion belongs to the kit, never to the surrounding layout.
    lit*=.7+.3*smoothstep(0.,.38,vPosition.y);
    vec3 color=pow(lit/(lit+vec3(.75)),vec3(1./2.2));
    color=mix(color,uGlow*.72+vec3(.28),min(.85,level*surface*.8));
    outColor=vec4(color,1.);
}`;
const SCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
    vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
    vUV=p; gl_Position=vec4(p*2.-1.,0.,1.);
}`;
const SCREEN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uGlow;
uniform vec2 uDirection;
uniform bool uComposite;
out vec4 outColor;
void main() {
    if(uComposite) {
        vec4 scene=texture(uImage,vUV), glow=texture(uGlow,vUV);
        float alpha=scene.a+(1.-scene.a)*glow.a*.7;
        // The drawing buffer is premultiplied when Canvas2D composites it.
        outColor=vec4(scene.rgb+glow.rgb*.55,alpha);
    } else {
        vec4 color=texture(uImage,vUV)*.227027;
        color+=(texture(uImage,vUV+uDirection*1.384615)+texture(uImage,vUV-uDirection*1.384615))*.316216;
        color+=(texture(uImage,vUV+uDirection*3.230769)+texture(uImage,vUV-uDirection*3.230769))*.070270;
        outColor=color;
    }
}`;

function program(gl, vertex, fragment) {
    const result = gl.createProgram(), shaders = [];
    try {
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(type); shaders.push(shader);
            gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(result, shader);
        }
        gl.linkProgram(result);
        if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
        return result;
    } catch (error) { gl.deleteProgram(result); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
}

function camera(yaw, elevation, aspect) {
    const angle = yaw * Math.PI / 180, pitch = elevation * Math.PI / 180;
    const direction = [Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), Math.cos(angle) * Math.cos(pitch)];
    const eye = add([-.05, 1.04, .12], direction, 7.5);
    const right = normalize(cross([0, 1, 0], direction)), up = cross(direction, right);
    // Fit the kit's bounds after orbiting so changing the angle cannot crop a
    // cymbal or pedal. The floor shadow is intentionally outside these bounds.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [-1.84, 1.73]) for (const y of [0, 2.22]) for (const z of [-.9, 1.23]) {
        const p = [x, y, z], horizontal = dot(right, p), vertical = dot(up, p);
        minX = Math.min(minX, horizontal); maxX = Math.max(maxX, horizontal);
        minY = Math.min(minY, vertical); maxY = Math.max(maxY, vertical);
    }
    const halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.06;
    const halfWidth = halfHeight * aspect;
    const matrix = new Float32Array(16);
    for (let i = 0; i < 3; i++) {
        matrix[i * 4] = right[i] / halfWidth; matrix[i * 4 + 1] = up[i] / halfHeight;
        matrix[i * 4 + 2] = -direction[i] / 10;
    }
    matrix[12] = -(minX + maxX) / (2 * halfWidth); matrix[13] = -(minY + maxY) / (2 * halfHeight);
    matrix[14] = dot(direction, eye) / 10 - 1; matrix[15] = 1;
    return { eye, matrix };
}

export class DrumsRenderer {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
        this.failed = !this.gl;
        this.targets = [];
        this.onLost = event => { event.preventDefault(); this.lost = true; };
        this.onRestored = () => { this.lost = false; this.failed = false; this.targets = []; this.initialize(); };
        this.canvas.addEventListener('webglcontextlost', this.onLost);
        this.canvas.addEventListener('webglcontextrestored', this.onRestored);
        if (this.gl) this.initialize();
    }

    initialize() {
        const gl = this.gl;
        try {
            this.sceneProgram = program(gl, VERTEX, FRAGMENT);
            this.screenProgram = program(gl, SCREEN_VERTEX, SCREEN_FRAGMENT);
            const locations = (p, names) => Object.fromEntries(names.map(name => [name, gl.getUniformLocation(p, name)]));
            this.sceneUniforms = locations(this.sceneProgram, ['uMatrix', 'uEye', 'uColors', 'uGlow', 'uLevels', 'uEmission', 'uShadow', 'uShadowMatrix']);
            this.screenUniforms = locations(this.screenProgram, ['uImage', 'uGlow', 'uDirection', 'uComposite']);
            const mesh = buildKit(); this.vertexCount = mesh.length / 10;
            this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
            this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
            let offset = 0;
            [3, 3, 2, 1, 1].forEach((size, location) => {
                gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4); offset += size;
            });
            gl.bindVertexArray(null);
            this.createShadow();
        } catch (error) {
            console.warn('Drums 3D renderer could not initialize:', error);
            this.failed = true; this.releaseResources();
        }
    }

    createShadow() {
        const gl = this.gl;
        this.shadowTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1024, 1024, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
        for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
        const framebuffer = gl.createFramebuffer(), shadowProgram = program(gl, VERTEX,
            '#version 300 es\nprecision highp float; void main() {}');
        try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
            gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
            gl.viewport(0, 0, 1024, 1024); gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
            this.shadowMatrix = camera(-36.87, 50.194, 1).matrix;
            gl.useProgram(shadowProgram); gl.uniformMatrix4fv(gl.getUniformLocation(shadowProgram, 'uMatrix'), false, this.shadowMatrix);
            gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount); gl.bindVertexArray(null);
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(framebuffer); gl.deleteProgram(shadowProgram);
        }
    }

    resize(width, height) {
        const gl = this.gl;
        if (this.canvas.width === width && this.canvas.height === height && this.targets.length) return;
        this.canvas.width = width; this.canvas.height = height;
        this.releaseTargets();
        const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
        this.multisample = { framebuffer: gl.createFramebuffer(), color: gl.createRenderbuffer(), depth: gl.createRenderbuffer() };
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.multisample.framebuffer);
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.multisample.color);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.multisample.color);
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.multisample.depth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT16, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.multisample.depth);
        // Small bloom buffers keep the animated frame cheap, even in a large clean feed.
        for (let index = 0; index < 3; index++) {
            const w = index ? Math.max(1, width >> 1) : width, h = index ? Math.max(1, height >> 1) : height;
            const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            const depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
            this.targets.push({ framebuffer, texture, depth, width: w, height: h });
        }
    }

    render(width, height, params = {}, levels = [0, 0, 0, 0, 0], glowColor = [90, 190, 255]) {
        if (this.failed || this.lost) return null;
        const gl = this.gl;
        // Cap rasterization cost; Canvas2D still places the result at the requested size.
        const scale = Math.min(1, 1600 / Math.max(width, height));
        this.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        const view = camera(params.yaw ?? 0, params.elevation ?? 25, this.canvas.width / this.canvas.height);
        gl.useProgram(this.sceneProgram); gl.bindVertexArray(this.vao);
        const u = this.sceneUniforms;
        gl.uniformMatrix4fv(u.uMatrix, false, view.matrix); gl.uniform3fv(u.uEye, view.eye);
        gl.uniformMatrix4fv(u.uShadowMatrix, false, this.shadowMatrix); gl.uniform1i(u.uShadow, 2);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.uniform3fv(u.uColors, [...rgb(params.shellColor, [.45, .18, .065]), ...rgb(params.cymbalColor, [.78, .55, .24]), // theme-allow: rgb parses saved scene colors into numeric shader channels, not CSS colors.
            ...rgb(params.hardwareColor, [.72, .77, .82]), ...rgb(params.headColor, [.9, .87, .8])]); // theme-allow: numeric scene material colors are independent of the application theme.
        gl.uniform3fv(u.uGlow, glowColor.map(value => Math.max(0, Math.min(1, value / 255))));
        gl.uniform1fv(u.uLevels, [0, 1, 2, 3, 4].map(index => Math.max(0, Math.min(1, levels[index] || 0))));
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        for (let index = 0; index < 2; index++) {
            const target = this.targets[index];
            gl.bindFramebuffer(gl.FRAMEBUFFER, index ? target.framebuffer : this.multisample.framebuffer);
            gl.viewport(0, 0, target.width, target.height);
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.uniform1i(u.uEmission, index); gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
            if (!index) {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.multisample.framebuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
                gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            }
        }
        gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST); gl.useProgram(this.screenProgram);
        const s = this.screenUniforms;
        gl.uniform1i(s.uImage, 0); gl.uniform1i(s.uGlow, 1); gl.uniform1i(s.uComposite, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        for (const [source, destination, x, y] of [[1, 2, 1, 0], [2, 1, 0, 1]]) {
            const target = this.targets[destination];
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.width, target.height);
            gl.bindTexture(gl.TEXTURE_2D, this.targets[source].texture);
            gl.uniform2f(s.uDirection, x * 3 / target.width, y * 3 / target.height);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.targets[1].texture);
        gl.uniform1i(s.uComposite, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return this.canvas;
    }

    releaseTargets() {
        if (this.multisample) {
            this.gl.deleteFramebuffer(this.multisample.framebuffer);
            this.gl.deleteRenderbuffer(this.multisample.color); this.gl.deleteRenderbuffer(this.multisample.depth);
            this.multisample = null;
        }
        for (const target of this.targets) {
            this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer); this.gl.deleteRenderbuffer(target.depth);
        }
        this.targets = [];
    }

    releaseResources() {
        if (!this.gl) return;
        this.releaseTargets();
        this.gl.deleteBuffer(this.buffer); this.gl.deleteVertexArray(this.vao);
        this.gl.deleteTexture(this.shadowTexture);
        this.gl.deleteProgram(this.sceneProgram); this.gl.deleteProgram(this.screenProgram);
    }

    dispose() {
        this.releaseResources();
        this.canvas.removeEventListener('webglcontextlost', this.onLost);
        this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
        this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
        this.failed = true;
    }
}
