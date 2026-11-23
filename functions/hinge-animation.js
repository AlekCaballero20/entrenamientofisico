const sharp = require("sharp");

const size = 384;

function hingeFrame(progress) {
  const angle = progress * Math.PI * 0.28;
  const ankle = { x: 190, y: 311 };
  const knee = { x: ankle.x + 7 * progress, y: ankle.y - Math.sqrt(60 ** 2 - (7 * progress) ** 2) };
  const hipX = 187 - 33 * progress;
  const hip = { x: hipX, y: knee.y - Math.sqrt(62 ** 2 - (knee.x - hipX) ** 2) };
  const shoulder = { x: hip.x + 69 * Math.sin(angle), y: hip.y - 69 * Math.cos(angle) };
  const head = { x: shoulder.x + 32 * Math.sin(angle) + 5, y: shoulder.y - 32 * Math.cos(angle) };

  const hand = { x: shoulder.x + 5, y: shoulder.y + 97 };
  const navy = "#18283b";
  const teal = "#26989a";
  const skin = "#f4d6be";
  const joint = (point, offset) => `${point.x + offset} ${point.y}`;
  const trace = (path, color, width) =>
    `<path d="${path}" fill="none" stroke="${navy}" stroke-width="${width + 4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const leg = offset => {
    const thigh = `M ${joint(hip, offset)} L ${joint(knee, offset)}`;
    const shin = `M ${joint(knee, offset)} L ${joint(ankle, offset)}`;
    const shorts = `M ${joint(hip, offset)} L ${(hip.x + knee.x) / 2 + offset} ${(hip.y + knee.y) / 2}`;
    return trace(thigh, skin, 16) + trace(shin, skin, 12) + trace(shorts, "#24787f", 24) +
      `<path d="M ${ankle.x + offset - 6} 308 h12 q5 7 16 9 q4 2 4 7 h-33 q-3 -6 1 -16Z" fill="${teal}" stroke="${navy}" stroke-width="2"/>`;
  };
  const arm = offset =>
    trace(`M ${joint(shoulder, offset)} L ${hand.x + offset - 2} ${(shoulder.y + hand.y) / 2} L ${joint(hand, offset)}`, skin, 12) +
    `<g transform="translate(${hand.x + offset} ${hand.y})" fill="#35465a" stroke="${navy}" stroke-width="2"><rect x="-17" y="-3" width="34" height="6" rx="3"/><rect x="-20" y="-10" width="9" height="20" rx="3"/><rect x="11" y="-10" width="9" height="20" rx="3"/></g>` +
    `<circle cx="${hand.x + offset}" cy="${hand.y - 2}" r="5" fill="${skin}" stroke="${navy}" stroke-width="1.5"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 384 384">
    <rect width="384" height="384" fill="#fff"/>
    <path d="M 104 325 H 279" stroke="#dce5eb" stroke-width="2"/>
    ${leg(9)}${arm(12)}${leg(-5)}
    ${trace(`M ${joint(shoulder, 0)} L ${joint(hip, 0)}`, teal, 32)}
    ${trace(`M ${joint(shoulder, 0)} L ${joint(head, 0)}`, skin, 11)}
    <g transform="translate(${head.x} ${head.y}) rotate(${angle * 180 / Math.PI})">
      <path d="M -12 -4 Q -13 -18 1 -18 Q 14 -17 14 -5 L 17 2 L 13 4 L 12 11 Q 6 16 -4 12 Q -13 8 -12 -4Z" fill="${skin}" stroke="${navy}" stroke-width="2.5"/>
      <path d="M -12 4 Q -18 -8 -10 -16 Q 2 -23 12 -15 L 13 -9 Q 5 -10 1 -5 L -4 1Z" fill="${navy}"/>
    </g>
    ${arm(0)}
  </svg>`);
}

async function romanianDeadliftGif() {
  const steps = 10;
  const forward = await Promise.all(Array.from({ length: steps + 1 }, (_, i) => {
    const progress = (1 - Math.cos(Math.PI * i / steps)) / 2;
    return sharp(hingeFrame(progress)).flatten({ background: "#fff" }).raw().toBuffer();
  }));
  const frames = [...forward, ...forward.slice(1, -1).reverse()];
  const delay = frames.map((_, index) => index === 0 || index === steps ? 600 : 95);
  return sharp(Buffer.concat(frames), {
    raw: { width: size, height: size * frames.length, channels: 3, pageHeight: size }
  }).gif({ loop: 0, delay }).toBuffer();
}

module.exports = { romanianDeadliftGif };
