const LAB_PATTERN = /^lab\(\s*([-\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)\s*(?:\/\s*([-\d.]+%?))?\s*\)$/;
const EPSILON = 216 / 24_389;
const KAPPA = 24_389 / 27;
const D50 = [0.964_295_676_4, 1, 0.825_104_602_5] as const;

type Vector = readonly [number, number, number];
type Matrix = readonly [Vector, Vector, Vector];

const D50_TO_D65: Matrix = [
  [0.955_473_421_5, -0.023_098_454_9, 0.063_259_243_2],
  [-0.028_369_709_3, 1.009_995_398_1, 0.021_041_441_2],
  [0.012_314_014_9, -0.020_507_649_3, 1.330_365_926_2],
];

const XYZ_TO_LMS: Matrix = [
  [0.819_022_438, 0.361_906_260_1, -0.128_873_781_5],
  [0.032_983_653_9, 0.929_286_861_6, 0.036_144_666_4],
  [0.048_177_189_4, 0.264_239_531_8, 0.633_547_828_5],
];

const LMS_TO_OKLAB: Matrix = [
  [0.210_454_268_3, 0.793_617_774_7, -0.004_072_043],
  [1.977_998_532_4, -2.428_592_242, 0.450_593_709_6],
  [0.025_904_042_5, 0.782_771_712_5, -0.808_675_766],
];

function multiply(matrix: Matrix, [x, y, z]: Vector): Vector {
  const [r0, r1, r2] = matrix;
  return [
    r0[0] * x + r0[1] * y + r0[2] * z,
    r1[0] * x + r1[1] * y + r1[2] * z,
    r2[0] * x + r2[1] * y + r2[2] * z,
  ];
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function labToXyzD50(l: number, a: number, b: number): Vector {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xr = fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const yr = l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA;
  const zr = fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA;
  return [xr * D50[0], yr * D50[1], zr * D50[2]];
}

export function labToOklch(value: string) {
  const match = LAB_PATTERN.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  const [, l = "0", a = "0", b = "0", alpha] = match;
  const xyz = multiply(D50_TO_D65, labToXyzD50(Number(l), Number(a), Number(b)));
  const [lCone, mCone, sCone] = multiply(XYZ_TO_LMS, xyz);
  const [okL, okA, okB] = multiply(LMS_TO_OKLAB, [
    Math.cbrt(lCone),
    Math.cbrt(mCone),
    Math.cbrt(sCone),
  ]);
  const chroma = Math.hypot(okA, okB);
  const hue = chroma < 0.0005 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
  const body = `${round(okL, 3)} ${round(chroma, 3)} ${round(hue, 0)}`;
  return alpha ? `oklch(${body} / ${alpha})` : `oklch(${body})`;
}
