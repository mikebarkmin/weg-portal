// EXIF stripping for photo uploads (plan.md "Files"): every photo is
// re-encoded through a canvas before it can be attached to a report, so
// EXIF metadata - including GPS coordinates - is removed. The browser's
// JPEG/PNG/WebP encoders never write EXIF segments.
//
// IMPORTANT INVARIANT: the original file NEVER leaves the browser. Only
// the re-encoded JPEG blob produced here is submitted; on any failure this
// module throws (and the photo is not attached/uploaded at all).

// Longest edge cap for re-encoded photos.
export const MAX_EDGE = 2000;

// JPEG re-encode quality (0-1). 0.9 is visually lossless for photos while
// keeping typical phone shots well under the server's 5 MB limit.
const JPEG_QUALITY = 0.9;

// Dimension math for downscaling: the longest edge is capped at maxEdge,
// the aspect ratio is preserved and photos already within the limit are
// left at their original size (no pointless re-scale rounding).
export function cappedDimensions(
    width: number,
    height: number,
    maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("invalid bitmap dimensions");
    }
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
    };
}

// Detects an Exif APP1 segment in a JPEG byte stream by walking the
// top-level JPEG segment structure (SOI .. SOS/EOI). Used by the unit
// tests to prove that EXIF markers exist in fixture input and are absent
// from re-encoded output.
export function hasExifApp1(bytes: Uint8Array): boolean {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return false; // not a JPEG
    }

    let offset = 2; // skip SOI
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            return false; // desynchronized: not a valid JPEG header area
        }
        const marker = bytes[offset + 1];
        if (marker === 0xd9 || marker === 0xda) {
            // EOI or start of scan: the segment header area has ended
            // (entropy-coded data may contain 0xff 0xe1 by chance and
            // must not be counted).
            return false;
        }
        if (marker === 0xd8 || marker === 0x01) {
            // standalone markers without a length field
            offset += 2;
            continue;
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (marker === 0xe1 && length >= 8 && offset + 4 + 6 <= bytes.length) {
            // "Exif\0\0" magic of an EXIF APP1 segment
            const data = bytes.subarray(offset + 4, offset + 4 + 6);
            if (
                data[0] === 0x45 &&
                data[1] === 0x78 &&
                data[2] === 0x69 &&
                data[3] === 0x66 &&
                data[4] === 0x00 &&
                data[5] === 0x00
            ) {
                return true;
            }
        }
        offset += 2 + length; // length includes the two length bytes
    }
    return false;
}

interface ReencodedPhoto {
    // re-encoded JPEG (no EXIF, dimensions capped at maxEdge)
    blob: Blob;
    width: number;
    height: number;
}

// Decodes the input honouring the EXIF orientation flag ("from-image")
// and re-encodes it as plain JPEG at capped dimensions. Throws on any
// decoding/encoding failure - the ORIGINAL FILE MUST NEVER LEAVE THE
// BROWSER, so there is no fallback that returns the input unchanged.
export async function reencodePhoto(file: Blob, maxEdge: number = MAX_EDGE): Promise<ReencodedPhoto> {
    const bitmap = await decodeBitmap(file);
    if (!bitmap) {
        throw new Error("photo could not be decoded");
    }

    try {
        const { width, height } = cappedDimensions(bitmap.width, bitmap.height, maxEdge);
        const blob = await drawToJpeg(bitmap, width, height);
        if (!blob || blob.size === 0) {
            throw new Error("photo re-encoding produced no data");
        }
        return { blob, width, height };
    } finally {
        bitmap.close();
    }
}

// createImageBitmap rejects files that cannot be decoded at all. The
// imageOrientation option is not supported everywhere in which case a
// plain decode is retried (those engines then bake the orientation into
// the bitmap themselves).
async function decodeBitmap(file: Blob): Promise<ImageBitmap | null> {
    try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        try {
            return await createImageBitmap(file);
        } catch {
            return null; // HEIC/unsupported/corrupt - never fall back to the original
        }
    }
}

async function drawToJpeg(
    bitmap: ImageBitmap | HTMLImageElement,
    width: number,
    height: number,
): Promise<Blob | null> {
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, width, height);
        return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}
