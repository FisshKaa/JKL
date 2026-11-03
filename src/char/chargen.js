'use strict';
// Геометрия персонажа из полей расстояний. Всё в модельном пространстве A-позы.
// Видимое тело (шея, кисти) и голова — высокое разрешение; одежда — оболочки вокруг тела.
const CharGen = (() => {
  const { smin, smax, sphere, ell, ellF, rcone, capsule, segT, segD, noise, smooth01 } = SDF;
  const _K0 = [0, 0, 1];
  const _K1 = [1, 0, 0];
  const _K2 = [0, 0.975, 0.005];
  const _K3 = [0, 1.13, 0];
  const _K4 = [0, 1.31, 0.008];
  const _K5 = [0, 1.405, 0.015];
  const _K6 = [0.066, 1.305, -0.068];
  const _K7 = [0.058, 0.058, 0.05];
  const _K8 = [0.07, 1.33, -0.064];
  const _K9 = [0.064, 0.925, 0.055];
  const _K10 = [0, 1.4, 0.012];
  const _K11 = [0, 1.62, 0.015];
  const _K12 = [0.02, 1.47, 0.022];
  const _K13 = [1, 1.06, 0.95];
  const _K14 = [1, 1.04, 0.97];
  const _K15 = [1, 1.15, 0.9];
  const _K16 = [0, 0.105, 0.014];
  const _K17 = [0, 0.05, -0.034];
  const _K18 = [0.012, -0.013, -0.066];
  const _K19 = [0.046, 0.072, -0.057];
  const _K20 = [0.026, 0.018, 0.026];
  const _K21 = [0.03, 0.116, -0.076];
  const _K22 = [0.032, 0.095, -0.086];
  const _K23 = [0.02, 0.014, 0.016];
  const _K24 = [0, 0.108, -0.087];
  const _K25 = [0.012, 0.06, -0.096];
  const _K26 = [0.01, 0.0075, 0.009];
  const _K27 = [0, 0.037, -0.085];
  const _K28 = [0.03, 0.026, 0.02];
  const _K29 = [0, 0.042, -0.098];
  const _K30 = [0, 0.029, -0.096];
  const _K31 = [0, 0.0355, -0.104];
  const _K32 = [0.023, 0.0015, 0.012];
  const _K33 = [0.075, 0.09, 0.008];
  const _K34 = [0.011, 0.029, 0.019];
  const _K35 = [0.083, 0.09, 0.006];
  const _K36 = [0.005, 0.017, 0.01];
  const _K37 = [0, -0.1, 0.0];
  const _K38 = [0, 0.02, 0.012];
  const _K39 = [0.62, 0.27, 0.26];
  const _K40 = [0.024, 0.009, 0.012];
  const _K41 = [0.022, 0.0095, 0.012];
  const _K42 = [0.75, 0.42, 0.38];
  const _K43 = [0.25, 0.18, 0.18];
  const _K44 = [0.8, 0.45, 0.4];
  const _K45 = [0, 0.085, 0.107];
  const _K46 = [0, 0.11, 0.045];
  const _K47 = [0, -0.13, 0.075];
  const _K48 = [0.07, 0.12, -0.012];
  const _K49 = [0.072, -0.04, 0.0];
  const _K50 = [0, 0.035, -0.104];
  const _K51 = [0.022, 0.009, 0.03];
  const _K52 = [-0.64, 1.0, -0.18];
  const _K53 = [0.64, 1.55, 0.18];
  const _K54 = [-0.64, 0.84, -0.19];
  const _K55 = [0.64, 1.52, 0.2];
  const _K56 = [0.102, 1.465, -0.062];
  const _K57 = [-0.26, 0.93, -0.2];
  const _K58 = [0.26, 1.13, 0.2];
  const _K59 = [-0.26, 0.95, -0.21];
  const _K60 = [0.26, 1.06, 0.21];
  const _K61 = [0.028, 0.024, 0.01];
  const _K62 = [0.13, -0.06];
  const _K63 = [0.155, 0.03];
  const _K64 = [0.07, 0.115];
  const _K65 = [0, 1, 0];
  const _K66 = [0.02, 0.035, 0.032];
  const _K67 = [-0.26, 0.24, -0.19];
  const _K68 = [0.26, 1.05, 0.2];
  const _K69 = [-0.24, -0.03, -0.2];
  const _K70 = [0.24, 0.4, 0.16];
  const _K71 = [-0.64, 0.08, -0.2];
  const _K72 = [0.64, 1.3, 0.2];
  const _K73 = [0.055, 0.06, 0.03];
  const _K74 = [-0.7, 0.9, -0.21];
  const _K75 = [0.7, 1.58, 0.24];
  const _K76 = [-0.2, 1.36, -0.02];
  const _K77 = [0.2, 1.62, 0.26];
  const _K78 = [0, 1.47, 0.115];
  const _K79 = [0.135, 0.085, 0.075];
  const _K80 = [0, 1.52, 0.07];
  const _K81 = [0.12, 0.05, 0.06];
  const _K82 = [0, 1.5, 0.1];
  const _K83 = [0.09, 0.04, 0.045];
  const _K84 = [-0.3, 1.25, -0.17];
  const _K85 = [0.3, 1.58, 0.2];
  const _K86 = [-0.1, 1.38, -0.09];
  const _K87 = [0.1, 1.64, 0.1];
  const _K88 = [-0.1, -0.1, -0.125];
  const _K89 = [0.1, 0.215, 0.12];
  const _K90 = [-0.09, -0.06, -0.125];
  const _K91 = [0.09, 0.08, 0.04];

  function frame(d) {
    const up = Math.abs(d[2]) < 0.9 ? _K0 : _K1;
    const s = norm3([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
    const f = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
    return [d, s, f];
  }
  const add = (a, d, s) => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];

  // ---------- Тело ----------
  // Симметрично: считаем по |x| только правую сторону.
  function bodySDF(J, look) {
    const f = look.sex === 'f' ? 1 : 0, m = 0.9 + 0.2 * look.build;
    const sh = J.shR, el = J.elR, wr = J.wrR, hip = [J.hipR[0], J.hipR[1] + 0.02, J.hipR[2]], kn = J.knR, an = J.anR, toe = J.toeR;
    const [ad, as, af] = frame(J.armDirR);
    const fist = add(wr, ad, 0.048);
    const thumbA = add(add(wr, ad, 0.015), af, -0.022), thumbB = add(add(wr, ad, 0.055), af, -0.03);
    const forearmBulgeA = add(el, ad, 0.03), forearmBulgeB = add(el, ad, 0.12);
    const quad = [lerp(hip[0], kn[0], 0.4), lerp(hip[1], kn[1], 0.4), -0.022];
    const calf = [lerp(kn[0], an[0], 0.3), lerp(kn[1], an[1], 0.3), 0.025];
    const _TA = [0, 0.86, 0.01], _TB = [0, 1.62, 0.01];
    const _B0 = [(0.152 + 0.03 * f) * m, 0.11, 0.108 * m];
    const _B1 = [(0.128 - 0.016 * f) * m, 0.13, 0.093 * m];
    const _B2 = [(0.152 + 0.012 * (1 - f) - 0.01 * f) * m, 0.15, 0.104 * m];
    const _B3 = [0.148 - 0.016 * f, 1.41, 0.015];
    const _B4 = [0.07 * m, 0.05, 0.034 * m];
    const _B5 = [0.083 * m, 0.098, 0.074 * m];
    const _B6 = [0.16 - 0.016 * f, 1.42, 0.015];
    const _B7 = [0.05, 0.026, 0.043 * (1 - 0.08 * f)];
    const _B8 = [0.068 * m, 0.15, 0.062 * m];
    const _B9 = [0.047 * m, 0.11, 0.046 * m];
    const legA = [hip[0], hip[1] + 0.06, hip[2]], legB = [toe[0], 0.04, toe[2]];
    const armB = add(wr, ad, 0.09);
    const delt = [sh[0], sh[1] - 0.012, sh[2] + 0.004], kneeC = [kn[0], kn[1], kn[2] - 0.008], heel = [an[0], an[1] - 0.035, an[2] + 0.025];
    return (x, y, z) => {
      const X = Math.abs(x);
      // Грубые оценки снизу для групп: далёкие группы не считаем
      const bT = capsule(X, y, z, _TA, _TB, 0.235);
      const bA = capsule(X, y, z, sh, armB, 0.07);
      const bL = capsule(X, y, z, legA, legB, 0.115);
      let d = 1e9, g;
      if (bT < 0.12) {
        g = 1e9;
        g = ell(X, y, z, _K2, _B0);
        g = smin(g, ell(X, y, z, _K3, _B1), 0.07);
        g = smin(g, ell(X, y, z, _K4, _B2), 0.07);
        g = smin(g, capsule(X, y, z, _K5, _B3, 0.068 * m), 0.05);
        if (f) g = smin(g, ell(X, y, z, _K6, _K7), 0.03);
        else g = smin(g, ell(X, y, z, _K8, _B4), 0.035);
        g = smin(g, ell(X, y, z, _K9, _B5), 0.04);
        g = smin(g, rcone(X, y, z, _K10, _K11, 0.064 * m * (1 - 0.1 * f), 0.05 * (1 - 0.08 * f)), 0.04);
        g = smin(g, rcone(X, y, z, _K12, _B6, (0.05 - 0.008 * f) * m, 0.044 * m), 0.04);
        d = g;
      } else d = bT;
      if (bA < d + 0.08) {
        g = 1e9;
        g = smin(g, sphere(X, y, z, delt, 0.054 * m * (1 - 0.1 * f)), 0.04);
        g = smin(g, rcone(X, y, z, sh, el, 0.046 * m * (1 - 0.1 * f), 0.036 * m), 0.035);
        g = smin(g, rcone(X, y, z, forearmBulgeA, forearmBulgeB, 0.042 * m * (1 - 0.1 * f), 0.035 * m), 0.025);
        g = smin(g, rcone(X, y, z, el, wr, 0.038 * m, 0.026 * (1 - 0.06 * f)), 0.02);
        g = smin(g, ellF(X, y, z, fist, ad, as, af, _B7), 0.014);
        g = smin(g, rcone(X, y, z, thumbA, thumbB, 0.013, 0.01), 0.008);
        d = smin(d, g, 0.04);
      }
      if (bL < d + 0.08) {
        g = 1e9;
        g = smin(g, rcone(X, y, z, hip, kn, (0.086 + 0.01 * f) * m, 0.052 * m), 0.06);
        g = smin(g, ell(X, y, z, quad, _B8), 0.035);
        g = smin(g, sphere(X, y, z, kneeC, 0.05 * m), 0.025);
        g = smin(g, rcone(X, y, z, kn, an, 0.05 * m, 0.031 * m), 0.02);
        g = smin(g, ell(X, y, z, calf, _B9), 0.03);
        g = smin(g, rcone(X, y, z, heel, toe, 0.042, 0.03), 0.025);
        d = smin(d, g, 0.06);
      }
      d = smax(d, -y + 0.004, 0.008);
      return d;
    };
  }

  // Параметр вдоль руки: 0 у плеча, 1 у запястья; и расстояние до оси
  function armParam(J, x, y, z) {
    const s = x >= 0 ? 'R' : 'L';
    const a = J['sh' + s], b = J['wr' + s];
    return { u: segT(x, y, z, a, b), d: segD(x, y, z, a, b) };
  }

  // ---------- Голова (локальные координаты головы) ----------
  function faceParams(look) {
    const f = look.sex === 'f' ? 1 : 0, v = look.face | 0;
    return { f, jw: _K13[v] * (1 - 0.06 * f), ns: _K14[v], chin: _K15[v] };
  }
  function headSDF(look) {
    const { f, jw, ns, chin } = faceParams(look);
    const cs = 1 - 0.04 * f;
    const _H0 = [0.074 * cs, 0.09 * cs, 0.097 * cs];
    const _H1 = [0.063 * jw, 0.074, 0.068];
    const _H2 = [0.044 * jw, 0.03, -0.012];
    const _H3 = [0.031, 0.011 * (1 + 0.45 * (1 - f)), 0.016];
    const _H4 = [0, 0.065, -0.108 * ns];
    const _H5 = [0, 0.063, -0.105 * ns];
    const _H6 = [0.021, 0.0062 * (1 + 0.3 * f), 0.0095];
    const _H7 = [0.019, 0.0074 * (1 + 0.3 * f), 0.0095];
    return (x, y, z) => {
      const X = Math.abs(x);
      let d = ell(X, y, z, _K16, _H0);
      d = smin(d, ell(X, y, z, _K17, _H1), 0.03);
      d = smin(d, rcone(X, y, z, _H2, _K18, 0.021, (0.015 + 0.004 * (1 - f)) * chin), 0.026);
      d = smin(d, ell(X, y, z, _K19, _K20), 0.02);
      d = smin(d, ell(X, y, z, _K21, _H3), 0.015);
      d = smax(d, -ell(X, y, z, _K22, _K23), 0.008);
      d = smin(d, rcone(X, y, z, _K24, _H4, 0.008, 0.0115), 0.012);
      d = smin(d, sphere(X, y, z, _H5, 0.0115), 0.008);
      d = smin(d, ell(X, y, z, _K25, _K26), 0.008);
      d = smin(d, ell(X, y, z, _K27, _K28), 0.015);
      d = smin(d, ell(X, y, z, _K29, _H6), 0.004);
      d = smin(d, ell(X, y, z, _K30, _H7), 0.004);
      d = smax(d, -ell(X, y, z, _K31, _K32), 0.002);
      d = smin(d, ell(X, y, z, _K33, _K34), 0.006);
      d = smax(d, -ell(X, y, z, _K35, _K36), 0.003);
      d = smin(d, rcone(X, y, z, _K37, _K38, 0.046 * (1 - 0.08 * f), 0.054 * (1 - 0.08 * f)), 0.03);
      return d;
    };
  }

  function hex(c) { const n = parseInt(c.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function headColor(look) {
    const skin = hex(look.skin), hair = hex(look.hairColor), lip = mix(skin, _K39, 0.42);
    const f = look.sex === 'f';
    return (x, y, z, nx, ny, nz, out) => {
      const X = Math.abs(x);
      let c = skin;
      const lipD = Math.min(ell(X, y, z, _K29, _K40), ell(X, y, z, _K30, _K41));
      if (lipD < 0.002) c = mix(c, lip, smooth01(0.002, -0.001, lipD));
      // Брови
      if (nz < -0.2) {
        const bw = Math.abs(X - 0.031) < 0.021 && y > 0.106 - (X - 0.031) * 0.12 && y < 0.1175 - Math.max(0, X - 0.04) * 0.25;
        if (bw && z < -0.07) c = mix(c, hair, f ? 0.7 : 0.85);
      }
      // Румянец, тени у глаз, щетина
      c = mix(c, _K42, 0.12 * Math.exp(-Math.pow((X - 0.045) / 0.02, 2) - Math.pow((y - 0.06) / 0.02, 2)) * (z < -0.04));
      c = mix(c, _K43, 0.25 * Math.exp(-Math.pow((X - 0.032) / 0.018, 2) - Math.pow((y - 0.098) / 0.01, 2)) * (z < -0.06));
      if (look.beard === 'stubble' && !f) {
        const jaw = y < 0.065 && y > -0.02 && z < 0.02 && lipD > 0.002 && !(y > 0.055 && X > 0.03);
        if (jaw) c = mix(c, hair, 0.32 + 0.1 * noise(x * 600, y * 600, z * 600));
      }
      if (X > 0.07 && Math.abs(y - 0.09) < 0.03) c = mix(c, _K44, 0.12);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    };
  }

  // Линия роста волос
  function hairline(X, y, z) {
    const t = smooth01(-0.075, 0.07, z);
    let hl = lerp(0.132, 0.03, t);
    hl += 0.07 * Math.exp(-Math.pow((z - 0.0) / 0.03, 2)) * smooth01(0.05, 0.072, X);
    hl -= 0.012 * smooth01(0.03, 0.06, X) * (1 - t);
    return y - hl;
  }

  function hairSDF(look) {
    const style = look.hair, cs = look.sex === 'f' ? 0.96 : 1;
    if (style === 'bald') return null;
    const capR = [0.074 * cs, 0.09 * cs, 0.097 * cs];
    const cap = (X, y, z) => ell(X, y, z, _K16, capR);
    return (x, y, z) => {
      const X = Math.abs(x);
      const n = noise(x * 90, y * 160, z * 90) * 0.004 + noise(x * 300, y * 40, z * 300) * 0.0015;
      let t = style === 'short' ? 0.011 : style === 'slick' ? 0.012 : 0.01;
      if (style === 'slick') t += 0.006 * smooth01(0.0, 0.08, z) * smooth01(0.12, 0.18, y);
      let d = cap(X, y, z) - t - n;
      d = smax(d, -hairline(X, y, z), 0.006);
      if (style === 'pony') d = smin(d, sphere(X, y, z, _K45, 0.026), 0.012);
      if (style === 'long') {
        let back = capsule(X, y, z, _K46, _K47, 0.078) - n * 2;
        back = smax(back, -(z + 0.012), 0.02);
        back = smax(back, X - 0.098, 0.01);
        d = smin(d, back, 0.02);
        d = smin(d, capsule(X, y, z, _K48, _K49, 0.016) - n, 0.015);
      }
      return d;
    };
  }

  function beardSDF(look, head) {
    if (look.beard !== 'full' || look.sex === 'f') return null;
    return (x, y, z) => {
      const X = Math.abs(x);
      let d = head(x, y, z) - 0.009 - noise(x * 220, y * 220, z * 220) * 0.003;
      const region = Math.max(y - (0.066 - Math.max(0, X - 0.035) * 0.6), z - 0.03, -(y + 0.05));
      d = Math.max(d, region);
      d = smax(d, -ell(X, y, z, _K50, _K51), 0.004);
      return d;
    };
  }

  // ---------- Одежда ----------
  function garments(J, look, B) {
    const out = [];
    const t0 = look.top, robe = look.outer === 'robe', cape = look.outer === 'cape';
    const wn = (x, y, z, s, a) => noise(x * s, y * s, z * s) * a;

    // Нижняя рубаха (видна в вырезе; у безрукавки — рукава)
    out.push({
      key: 'under', mat: 'under', h: 0.009,
      min: _K52, max: _K53,
      sdf: (x, y, z) => {
        const a = armParam(J, x, y, z), arm = a.d < 0.08 && a.u > 0.06 && Math.abs(x) > 0.13;
        let d = B(x, y, z) - 0.005 - wn(x, y, z, 50, 0.0015);
        // Под туникой рубаха нужна только в вырезе: иначе при вытянутых руках она проступает клочьями
        const vReg = Math.max(1.12 - y, y - 1.505, z - 0.0, Math.abs(x) - ((y - 1.16) * 0.3 + 0.035));
        const reg = arm ? (t0 === 'vest' ? a.u - 0.93 : 1) : (t0 === 'vest' ? Math.max(1.0 - y, y - 1.505) : vReg);
        return Math.max(d, reg);
      },
    });

    // Туника или безрукавка с запахом
    const vy = 1.16, edgeA = [0.028, vy + 0.02, -0.112];
    out.push({
      key: 'top', mat: 'tunic', h: 0.0098,
      min: _K54, max: _K55,
      sdf: (x, y, z) => {
        const X = Math.abs(x);
        const a = armParam(J, x, y, z), arm = a.d < 0.085 && a.u > 0.05 && X > 0.13;
        let t = 0.017 + wn(x, y, z, 38, 0.0035) + (arm ? 0.008 * smooth01(0.6, 0.93, a.u) + 0.004 * smooth01(0.35, 0.5, a.u) * smooth01(0.65, 0.5, a.u) : 0);
        let d = B(x, y, z) - t;
        // Отворот запаха вдоль выреза
        d = smin(d, capsule(X, y, z, edgeA, _K56, 0.012), 0.01);
        let reg;
        if (arm) reg = t0 === 'vest' ? 1 : a.u - 0.93;
        else reg = Math.max(0.875 - y, y - (1.47 + 0.035 * smooth01(-0.02, 0.08, z)));
        if (t0 === 'vest' && arm) reg = Math.max(reg, a.u - 0.08);
        const vcut = (z < -0.02 && y > vy) ? X - (y - vy) * 0.3 : 1;
        reg = Math.max(reg, -vcut);
        return Math.max(d, reg);
      },
    });

    // Кушак
    if (look.sash) out.push({
      key: 'sash', mat: 'sash', h: 0.01,
      min: _K57, max: _K58,
      sdf: (x, y, z) => Math.max(B(x, y, z) - 0.024 - wn(x, y * 0.3, z, 60, 0.003), Math.abs(y - 1.03) - 0.072 + Math.abs(Math.sin(Math.atan2(x, z) * 3)) * 0.004),
    });

    // Ремень с пряжкой и подсумками (жёстко на тазу)
    const beltFront = -(0.118 + (look.sash ? 0.035 : 0.025)), buckleC = [0, 1.0, beltFront - 0.003];
    const pouches = [[0.13, -0.06], [0.155, 0.03], [0.07, 0.115]].map(([px, pz]) => {
      const c = [px, 0.975, pz * (1 + (look.sash ? 0.15 : 0))];
      const len = Math.sqrt(c[0] * c[0] + c[2] * c[2]), nx = c[0] / len, nz = c[2] / len;
      return { c: [c[0] + nx * 0.02, c[1], c[2] + nz * 0.02], a: [nx, 0, nz], b: [-nz, 0, nx] };
    });
    out.push({
      key: 'belt', mat: 'belt', h: 0.0085, rigid: 'hips',
      min: [-0.26, 0.95, -0.21], max: [0.26, 1.06, 0.21],
      sdf: (x, y, z) => {
        const X = Math.abs(x);
        let d = Math.max(B(x, y, z) - (look.sash ? 0.033 : 0.024), Math.abs(y - 1.0) - 0.022);
        d = smin(d, ell(X, y, z, buckleC, _K61), 0.004);
        for (const P of pouches) d = smin(d, ellF(X, y, z, P.c, P.a, _K65, P.b, _K66), 0.004);
        return d;
      },
    });

    // Штаны
    out.push({
      key: 'trousers', mat: 'trousers', h: 0.012,
      min: _K67, max: _K68,
      sdf: (x, y, z) => {
        const kneeK = Math.exp(-Math.pow((y - 0.5) / 0.08, 2));
        const d = B(x, y, z) - 0.011 - wn(x, y, z, 30, 0.004) - 0.006 * kneeK;
        return Math.max(d, Math.max(0.27 - y, y - 0.92));
      },
    });

    // Сапоги
    out.push({
      key: 'boots', mat: 'boots', h: 0.009,
      min: _K69, max: _K70,
      sdf: (x, y, z) => {
        let d = B(x, y, z) - 0.016 - wn(x, y, z, 45, 0.002);
        const top = 0.36 - 0.03 * smooth01(0.0, 0.06, z);
        d = Math.max(d, y - top);
        d = smax(d, -(y + 0.002), 0.004);
        return d;
      },
    });

    // Обмотки на предплечьях и голенях
    if (look.wraps) {
      out.push({
        key: 'wraps', mat: 'sash', h: 0.0085,
        min: _K71, max: _K72,
        sdf: (x, y, z) => {
          const a = armParam(J, x, y, z), X = Math.abs(x);
          if (a.d < 0.07 && a.u > 0.55 && X > 0.13) {
            const band = Math.abs(((a.u * 9 + 0.3) % 1) - 0.5) - 0.32;
            return Math.max(B(x, y, z) - 0.03, Math.max(band * 0.05, Math.max(0.58 - a.u, a.u - 0.9)));
          }
          if (y < 0.36 && y > 0.1) {
            const band = Math.abs((((y + x * 0.4) * 22) % 1) - 0.5) - 0.33;
            return Math.max(B(x, y, z) - 0.027, band * 0.05);
          }
          return 1;
        },
      });
    }

    // Лёгкая броня: наплечники, наручи, поножи (жёсткие пластины)
    if (look.armor === 'light') {
      for (const S of ['R', 'L']) {
        const s = S === 'R' ? 1 : -1, sh = J['sh' + S];
        out.push({
          key: 'pauldron' + S, mat: 'armor', h: 0.008, rigid: 'upperArm' + S,
          min: [s > 0 ? 0.08 : -0.32, 1.28, -0.12], max: [s > 0 ? 0.32 : -0.08, 1.52, 0.13],
          sdf: (x, y, z) => {
            if (x * s < 0) return 1;
            let d = B(x, y, z) - 0.034;
            { const a = x - sh[0], b = (y - sh[1]) * 1.2, c = z - sh[2]; d = Math.max(d, Math.sqrt(a * a + b * b + c * c) - 0.1); }
            d = Math.max(d, -(y - (sh[1] - 0.075)));
            d = Math.max(d, -(x * s - 0.12));
            return d;
          },
        });
        out.push({
          key: 'bracer' + S, mat: 'armor', h: 0.008, rigid: 'foreArm' + S,
          min: [s > 0 ? 0.25 : -0.62, 0.92, -0.12], max: [s > 0 ? 0.62 : -0.25, 1.28, 0.12],
          sdf: (x, y, z) => {
            if (x * s < 0) return 1;
            const a = armParam(J, x, y, z);
            if (a.d > 0.08) return 1;
            return Math.max(B(x, y, z) - 0.026, Math.max(0.62 - a.u, a.u - 0.9));
          },
        });
        const kn = J['kn' + S], an = J['an' + S], kcap = [kn[0] * s * s, kn[1] + 0.02, kn[2] - 0.05];
        out.push({
          key: 'greave' + S, mat: 'armor', h: 0.008, rigid: 'shin' + S,
          min: [s > 0 ? 0.0 : -0.22, 0.12, -0.16], max: [s > 0 ? 0.22 : 0.0, 0.6, 0.08],
          sdf: (x, y, z) => {
            if (x * s < 0) return 1;
            let d = B(x, y, z) - 0.03;
            const cz = lerp(kn[2], an[2], clamp((kn[1] - y) / (kn[1] - an[1]), 0, 1));
            d = Math.max(d, z - cz - 0.005);
            d = Math.max(d, Math.max(0.14 - y, y - 0.57));
            d = smin(d, Math.max(ell(x * s, y, z, kcap, _K73), -(y - 0.45)), 0.01);
            return d;
          },
        });
      }
    }

    // Мантия: верх с широкими рукавами и капюшоном за спиной (низ — ткань с физикой)
    if (robe) {
      out.push({
        key: 'robe', mat: 'outer', h: 0.013,
        min: _K74, max: _K75,
        sdf: (x, y, z) => {
          const X = Math.abs(x);
          const a = armParam(J, x, y, z), arm = a.d < 0.12 && a.u > 0.05 && X > 0.14;
          const flare = arm ? 0.035 * smooth01(0.45, 1.05, a.u) : 0;
          let d = B(x, y, z) - 0.034 - flare - wn(x, y, z, 26, 0.006);
          let reg;
          if (arm) reg = a.u - 1.04;
          else reg = Math.max(0.95 - y, y - (1.5 + 0.05 * smooth01(-0.02, 0.1, z)));
          const open = z < -0.02 ? X - (0.045 + (1.5 - y) * 0.22) : 1;
          reg = Math.max(reg, -open);
          return Math.max(d, reg);
        },
      });
      out.push({
        key: 'hood', mat: 'outer', h: 0.011, rigid: 'chest',
        min: _K76, max: _K77,
        sdf: (x, y, z) => {
          const X = Math.abs(x);
          let d = ell(X, y, z, _K78, _K79) - wn(x, y, z, 40, 0.008);
          d = smin(d, ell(X, y, z, _K80, _K81), 0.03);
          d = smax(d, -ell(X, y, z, _K82, _K83), 0.01);
          return Math.max(d, -B(x, y, z) + 0.03);
        },
      });
    }
    // Плащ: короткая пелерина на плечах (сам плащ — ткань с физикой)
    if (cape) {
      out.push({
        key: 'mantle', mat: 'outer', h: 0.011, rigid: 'chest',
        min: _K84, max: _K85,
        sdf: (x, y, z) => {
          const X = Math.abs(x);
          let d = B(x, y, z) - 0.04 - wn(x, y, z, 30, 0.004);
          d = Math.max(d, Math.hypot(X * 0.95, (y - 1.43) * 1.6, z * 0.9) - 0.235);
          d = Math.max(d, y - 1.5);
          d = Math.max(d, -(y - 1.3 - 0.06 * smooth01(0, 0.2, X)));
          return d;
        },
      });
    }
    return out;
  }

  // ---------- Сборка ----------
  function build(look) {
    const J = rigJoints(look);
    const B = bodySDF(J, look);
    const skin = hex(look.skin);
    const parts = [];
    const covered = (x, y, z) => {
      const a = armParam(J, x, y, z);
      if (a.d < 0.1 && a.u > 0.1 && Math.abs(x) > 0.13) return 0.9 - a.u;
      return Math.max(1.43 - y, Math.abs(x) - 0.12);
    };
    const T = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Видимое тело: шея и кисти
    const bodyVis = (x, y, z) => Math.max(B(x, y, z), covered(x, y, z));
    for (const box of [
      { min: _K86, max: _K87, h: 0.0065 },
      { min: [J.wrR[0] - 0.12, J.wrR[1] - 0.13, -0.08], max: [J.wrR[0] + 0.1, J.wrR[1] + 0.07, 0.08], h: 0.0042 },
      { min: [J.wrL[0] - 0.1, J.wrL[1] - 0.13, -0.08], max: [J.wrL[0] + 0.12, J.wrL[1] + 0.07, 0.08], h: 0.0042 },
    ]) {
      const g = SDF.mesh(bodyVis, box.min, box.max, box.h, (x, y, z, nx, ny, nz, o) => { o[0] = skin[0]; o[1] = skin[1]; o[2] = skin[2]; });
      parts.push({ key: 'body', mat: 'skin', geo: g, ...skinWeights(J, g.positions) });
    }

    // Голова (жёстко на кости головы)
    const H = headSDF(look);
    const hg = SDF.mesh(H, _K88, _K89, 0.0038, headColor(look));
    parts.push({ key: 'head', mat: 'skin', geo: hg, rigid: 'head', local: true, fpHide: true });
    const hs = hairSDF(look);
    if (hs) {
      const long = look.hair === 'long';
      const g = SDF.mesh(hs, [-0.11, long ? -0.16 : -0.02, -0.11], [0.11, 0.215, long ? 0.18 : 0.15], 0.0048);
      parts.push({ key: 'hair', mat: 'hair', geo: g, rigid: 'head', local: true, fpHide: true });
    }
    const bs = beardSDF(look, H);
    if (bs) {
      const g = SDF.mesh(bs, _K90, _K91, 0.0042);
      parts.push({ key: 'beard', mat: 'hair', geo: g, rigid: 'head', local: true, fpHide: true });
    }

    // Одежда
    for (const G of garments(J, look, B)) {
      const g = SDF.mesh(G.sdf, G.min, G.max, G.h);
      if (!g.positions.length) continue;
      const p = { key: G.key, mat: G.mat, geo: g, fpHide: G.key === 'hood' };
      if (G.rigid) p.rigid = G.rigid; else Object.assign(p, skinWeights(J, g.positions));
      parts.push(p);
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - T;
    return { J, parts, ms };
  }

  return { build, bodySDF, hex };
})();
