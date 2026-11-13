import { describe, expect, it, vi, afterEach } from "vitest";

import { cappedDimensions, hasExifApp1, MAX_EDGE, reencodePhoto } from "./exifStrip";

// --- JPEG fixture crafting ------------------------------------------------
//
// The unit test environment has no canvas, so the fixtures here are
// crafted as raw byte arrays: a minimal JPEG that walks the real segment
// structure (SOI + APP segments + SOF + SOS + payload + EOI), with and
// without an Exif APP1 segment, plus a PNG negative case.

function segment(marker: number, payload: number[] = []): number[] {
    const length = payload.length + 2; // length includes its own 2 bytes
    return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function text(value: string): number[] {
    return Array.from(value).map((c) => c.charCodeAt(0));
}

// Minimal TIFF header a real camera writes into APP1: "II*\0", offset of
// IFD0 = 8, then a zero-entry IFD0 with next-IFD offset 0. Enough bytes
// to be a plausible Exif payload; the scanner only needs the "Exif\0\0"
// magic of the segment though.
function minimalExifPayload(): number[] {
    return [
        ...text("Exif\0\0"),
        ...text("II"),
        0x2a, 0x00, // TIFF magic ("*")
        0x08, 0x00, 0x00, 0x00, // IFD0 at offset 8
        0x00, 0x00, // IFD0: 0 entries
        0x00, 0x00, 0x00, 0x00, // no next IFD
    ];
}

function jpeg(...segments: number[][]): Uint8Array {
    return new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);
}

// A JPEG WITHOUT any APP1 segment, shaped like a canvas re-encode result
// (SOI + JFIF APP0 + DQT + SOF0 + SOS + entropy data + EOI).
function encoderLikeJpeg(): Uint8Array {
    const sos = segment(0xda, [0x01, 0x00, 0x00, 0x3f, 0x00]); // 1 component, table
    const payload = [0x12, 0x34, 0xff, 0xe1, 0x56, 0x78]; // 0xff 0xe1 INSIDE entropy data
    return jpeg(
        segment(0xe0, [...text("JFIF\0"), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
        segment(0xdb, [0x00, 0x08, 0x08, 0x08, 0x09, 0x09, 0x09, 0x0a]),
        segment(0xc0, [0x08, 0x07, 0xd0, 0x0b, 0xb8, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
        sos,
        payload,
    );
}

function png(): Uint8Array {
    // PNG magic + IHDR chunk signature; enough to prove non-JPEG is rejected
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, ...text("IHDR"),
        0x00, 0x00, 0x07, 0xd0, 0x00, 0x00, 0x04, 0xb0,
    ]);
}

describe("hasExifApp1", () => {
    it("detects an EXIF APP1 segment in a crafted JPEG", () => {
        const withExif = jpeg(
            segment(0xe0, [...text("JFIF\0"), 0x01, 0x01, 0x00]),
            segment(0xe1, minimalExifPayload()),
            segment(0xc0, [0x08, 0x00, 0x64, 0x00, 0xc8, 0x01]),
        );
        expect(hasExifApp1(withExif)).toBe(true);
    });

    it("is false for a JPEG without APP1 (canvas-encoder shape)", () => {
        expect(hasExifApp1(encoderLikeJpeg())).toBe(false);
    });

    it("does not count 0xff 0xe1 bytes inside the entropy-coded data", () => {
        // the crafted encoder-like JPEG deliberately contains ffe1 in its
        // scan payload; the scanner must stop at SOS
        const bytes = encoderLikeJpeg();
        expect(bytes.includes(0xe1)).toBe(true);
        expect(hasExifApp1(bytes)).toBe(false);
    });

    it("is false for an APP1 segment that is not Exif (e.g. XMP)", () => {
        const xmp = jpeg(segment(0xe1, [...text("http://ns.adobe.com/xap/1.0/\0"), 0x3c, 0x78]));
        expect(hasExifApp1(xmp)).toBe(false);
    });

    it("is false for a PNG and for non-image bytes", () => {
        expect(hasExifApp1(png())).toBe(false);
        expect(hasExifApp1(new Uint8Array(0))).toBe(false);
        expect(hasExifApp1(new Uint8Array([0x12, 0x34, 0x56, 0x78]))).toBe(false);
    });
});

// --- dimension math --------------------------------------------------------

describe("cappedDimensions", () => {
    it("keeps photos within the cap on the longest edge", () => {
        expect(cappedDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500 });
        expect(cappedDimensions(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    });

    it("leaves small photos untouched", () => {
        expect(cappedDimensions(800, 600)).toEqual({ width: 800, height: 600 });
        expect(cappedDimensions(MAX_EDGE, MAX_EDGE)).toEqual({ width: 2000, height: 2000 });
    });

    it("rounds instead of exceeding the cap", () => {
        const { width, height } = cappedDimensions(3001, 1000);
        expect(width).toBeLessThanOrEqual(MAX_EDGE);
        expect(Math.round(width * 1000)).toBeLessThanOrEqual(MAX_EDGE * 1000);
        expect(height).toBeGreaterThan(0);
    });

    it("preserves the aspect ratio", () => {
        const { width, height } = cappedDimensions(5000, 3333);
        expect(Math.abs(width / height - 5000 / 3333)).toBeLessThan(0.002);
    });

    it("rejects invalid dimensions", () => {
        expect(() => cappedDimensions(0, 100)).toThrow();
        expect(() => cappedDimensions(NaN, 100)).toThrow();
        expect(() => cappedDimensions(100, Infinity)).toThrow();
    });
});

// --- reencodePhoto (with canvas APIs mocked) --------------------------------
//
// The actual canvas round-trip needs a real browser; the mocks here verify
// the wiring: capped dimensions reach the canvas, the ORIGINAL file is
// never returned, the bitmap is closed, and the canvas output (which real
// encoders ship without EXIF - see hasExifApp1) is what the caller gets.

class FakeBitmap {
    constructor(
        public width: number,
        public height: number,
    ) {}
    close = vi.fn();
}

const fakeCanvasOutput = encoderLikeJpeg();
const storedGlobals: Record<string, unknown> = {};

afterEach(() => {
    for (const [key, value] of Object.entries(storedGlobals)) {
        (globalThis as Record<string, unknown>)[key] = value;
        delete storedGlobals[key];
    }
});

function stash(key: string) {
    storedGlobals[key] = (globalThis as Record<string, unknown>)[key];
}

function blobOf(bytes: Uint8Array): Blob {
    return new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
}

describe("reencodePhoto", () => {
    it("re-encodes via the canvas at capped dimensions and never returns the original", async () => {
        stash("createImageBitmap");
        stash("OffscreenCanvas");
        const original = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
        const bitmap = new FakeBitmap(4032, 3024);
        const drawSpy = vi.fn();
        (globalThis as Record<string, unknown>).createImageBitmap = vi
            .fn()
            .mockResolvedValue(bitmap);
        class FakeOffscreenCanvas {
            width: number;
            height: number;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
            }
            getContext() {
                return { drawImage: drawSpy };
            }
            async convertToBlob() {
                return blobOf(fakeCanvasOutput);
            }
        }
        (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;

        const result = await reencodePhoto(original);

        // downscaled to the 2000px cap
        const [, , , w, h] = drawSpy.mock.calls[0] as unknown[];
        expect([w, h]).toEqual([cappedDimensions(4032, 3024).width, cappedDimensions(4032, 3024).height]);
        expect(w).toBeLessThanOrEqual(MAX_EDGE);
        expect(h).toBeLessThanOrEqual(MAX_EDGE);

        // the output is the re-encoded blob, without EXIF ...
        expect(result.blob).not.toBe(original);
        expect(result.blob.type).toBe("image/jpeg");
        expect(hasExifApp1(new Uint8Array(await result.blob.arrayBuffer()))).toBe(false);
        // ... and the decoded bitmap is released again
        expect(bitmap.close).toHaveBeenCalled();
    });

    it("throws (and never returns the original) when decoding fails", async () => {
        stash("createImageBitmap");
        (globalThis as Record<string, unknown>).createImageBitmap = vi
            .fn()
            .mockRejectedValue(new Error("could not decode"));
        const original = blobOf(png());

        await expect(reencodePhoto(original)).rejects.toThrow();
    });
});
