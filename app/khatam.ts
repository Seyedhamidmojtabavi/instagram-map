/**
 * The eight-pointed star of Persian tilework (khatam): two squares, one turned
 * 45°. Used for the logo and for every pin on the map.
 */
export function khatamPoints(cx: number, cy: number, radius: number): [number, number][] {
  const inner = radius * (Math.cos(Math.PI / 4) / Math.cos(Math.PI / 8));
  const points: [number, number][] = [];
  for (let index = 0; index < 16; index += 1) {
    const r = index % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 8;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

export function khatamPath(cx: number, cy: number, radius: number) {
  return `${khatamPoints(cx, cy, radius)
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ")}Z`;
}

/** Rasterises a pin for the map's symbol layer. */
export function khatamImage(color: string, { size = 30, ring = "" }: { size?: number; ring?: string } = {}) {
  const ratio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);
  const center = size / 2;
  const trace = (radius: number) => {
    context.beginPath();
    khatamPoints(center, center, radius).forEach(([x, y], index) =>
      index === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
    );
    context.closePath();
  };
  if (ring) {
    trace(size / 2 - 0.5);
    context.fillStyle = ring;
    context.fill();
  }
  trace(size / 2 - (ring ? 4 : 2));
  context.fillStyle = color;
  context.shadowColor = "rgba(27, 42, 92, 0.35)";
  context.shadowBlur = ring ? 0 : 3;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.beginPath();
  context.arc(center, center, size * 0.09, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer),
  };
}
