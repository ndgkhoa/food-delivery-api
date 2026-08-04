import sharp from 'sharp';

/**
 * Generates a REAL, viewable demo image instead of a 1x1 placeholder: a solid
 * coloured card with a centered label, rendered from an SVG via `sharp` (the
 * same image library the media service's thumbnailer uses). The uploaded object
 * is then actually visible in a browser or the MinIO console preview. Pixel
 * content is demo-only; what matters is that it's a valid `image/png` on the
 * media service's `ALLOWED_MIME` allowlist.
 */
export const DEMO_IMAGE_CONTENT_TYPE = 'image/png';

const PALETTE = ['#E4572E', '#F3A712', '#2E86AB', '#3B8C5A', '#8367C7', '#D7263D'];

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  );
}

export async function generateDemoImage(label: string, index = 0): Promise<Buffer> {
  const width = 640;
  const height = 420;
  const background = PALETTE[index % PALETTE.length];
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <rect width="100%" height="100%" fill="${background}"/>
       <text x="50%" y="46%" font-family="Helvetica, Arial, sans-serif" font-size="42"
             font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text>
       <text x="50%" y="58%" font-family="Helvetica, Arial, sans-serif" font-size="22"
             fill="#ffffff" fill-opacity="0.85" text-anchor="middle">food-delivery-api · demo</text>
     </svg>`,
  );
  return sharp(svg).png().toBuffer();
}
